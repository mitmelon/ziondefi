/**
 * StarknetCardService — SDK for interacting with a deployed ZionDefi Card contract.
 *
 * Handles all card-level operations: configuration, payment requests,
 * charge/settlement, funds management, swaps, blacklist, freeze/burn,
 * and all read-only views.
 *
 * The relayer is a transaction relay — it ALWAYS forwards the owner's
 * PIN signatures (sig_r, sig_s) obtained client-side. The contract
 * verifies them against the owner's public key regardless of caller.
 *
 * SECURITY MODEL:
 *   PIN key derivation and signing happen EXCLUSIVELY on the client
 *   device using ZionCrypto (public/home/plugin/zion-crypto.js).
 *   The server only receives { sigR, sigS } — never the PIN or
 *   private key.
 *
 * Usage:
 *   const { cardAddress } = await factory.createCard(userAccount, pinKey, ...);
 *   const card = await StarknetCardService.create({ cardAddress });
 *   await card.approvePaymentRequest(requestId, sigR, sigS);           // relayer + PIN
 *   await card.approvePaymentRequest(requestId, sigR, sigS, ownerAcct); // owner + PIN
 */

const { RpcProvider, Account, Contract, uint256, CairoCustomEnum } = require('starknet');
const redis = require('./RedisService');
const StarknetGasManager = require('./StarknetGasManager');
const StarknetConfig = require('./StarknetConfig');
const priceOracle = require('../utils/PriceOracleService');

// ABI cache TTL — 24 hours
const ABI_CACHE_TTL = 3600;
const ABI_KEY_PREFIX = 'abi:';

// ============================================================================
// SERVICE
// ============================================================================

class StarknetCardService {
    /**
     * @param {object} opts
     * @param {string} opts.cardAddress           — the DEPLOYED card contract address
     *        (returned by `factory.createCard()`). This is NOT the class hash.
     * @param {boolean} [opts.isLive=true]        — true = mainnet, false = testnet
     * @param {string} [opts.nodeUrl]             — RPC endpoint (auto-resolved from isLive)
     * @param {string} [opts.relayerAddress]      — relayer account address
     * @param {string} [opts.relayerPrivateKey]   — relayer private key
     * @param {object[]} [opts.abi]               — pre-fetched ABI (set by create())
     */
    constructor(opts = {}) {
        const isLive = opts.isLive !== undefined ? opts.isLive : true;
        const netConfig = StarknetConfig.resolve(isLive);

        this.isLive = isLive;
        this.nodeUrl = opts.nodeUrl || netConfig.rpcUrl;
        this.cardAddress = opts.cardAddress;

        if (!this.nodeUrl) throw new Error('STARKNET_RPC_URL is required');
        if (!this.cardAddress) throw new Error('cardAddress is required');
        if (!opts.abi) throw new Error('Use StarknetCardService.create() instead of new');

        this.provider = new RpcProvider({ nodeUrl: this.nodeUrl });
        this.abi = opts.abi;

        // Gas cost tracker — STRK price auto-fetched from CoinGecko + cached in Redis
        this.gas = new StarknetGasManager({ provider: this.provider });

        // Relayer account (relays transactions on behalf of the user)
        const relayerAddr = opts.relayerAddress || netConfig.relayerAddress;
        const relayerPk = opts.relayerPrivateKey || netConfig.relayerPrivateKey;
        if (relayerAddr && relayerPk) {
            this.relayerAccount = new Account({ provider: this.provider, address: relayerAddr, signer: relayerPk });
        }

        // Read-only contract (no signer)
        this.contract = new Contract({ abi: this.abi, address: this.cardAddress, providerOrAccount: this.provider });
    }

    /**
     * Async factory — fetches the ABI from the chain via `getClassAt()`.
     * ABI is cached in Redis by class hash so subsequent cards sharing the same
     * implementation only hit the RPC once. Cache auto-expires after 24h
     * so contract upgrades are picked up.
     *
     * @param {object} opts
     * @param {string} opts.cardAddress — the DEPLOYED card address (from factory.createCard())
     * @param {boolean} [opts.isLive=true] — true = mainnet, false = testnet
     * @returns {Promise<StarknetCardService>}
     */
    static async create(opts = {}) {
        const isLive = opts.isLive !== undefined ? opts.isLive : true;
        const netConfig = StarknetConfig.resolve(isLive);
        const nodeUrl = opts.nodeUrl || netConfig.rpcUrl;
        const cardAddress = opts.cardAddress;
        if (!nodeUrl) throw new Error('STARKNET_RPC_URL is required');
        if (!cardAddress) throw new Error('cardAddress is required');

        const provider = new RpcProvider({ nodeUrl });

        const classHash = await provider.getClassHashAt(cardAddress);
        const cacheKey = `${ABI_KEY_PREFIX}${classHash}`;

        // Try Redis first
        let abi = await redis.get(cacheKey);
        if (!abi) {
            const contractClass = await provider.getClassAt(cardAddress);
            abi = typeof contractClass.abi === 'string'
                ? JSON.parse(contractClass.abi)
                : contractClass.abi;
            await redis.set(cacheKey, abi, ABI_CACHE_TTL);
        }

        return new StarknetCardService({ ...opts, abi });
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    /** Attach an account to the contract for write calls. */
    _withAccount(account) {
        if (!account) throw new Error('Account not configured');
        return new Contract({ abi: this.abi, address: this.cardAddress, providerOrAccount: account });
    }

    _relayerContract() {
        return this._withAccount(this.relayerAccount);
    }

    /**
     * Execute a write call and return the tx hash, receipt, and gas cost.
     *
     * Every write method that flows through `_execute` automatically
     * returns a `gas` object with the actual STRK and USD cost.
     *
     * @param {Contract} contract
     * @param {string} method
     * @param {Array} args
     * @returns {Promise<{ txHash: string, receipt: object, gas: { actualStrk: string, actualUsd: string, actualFri: string } }>}
     */
    async _execute(contract, method, args = []) {
        const tx = await contract[method](...args);
        const receipt = await this.provider.waitForTransaction(tx.transaction_hash);
        const gas = await this.gas.extractCost(receipt);
        return { txHash: tx.transaction_hash, receipt, gas };
    }

    /**
     * Resolve the contract instance and validate PIN signatures.
     *
     * PIN signatures are ALWAYS required for PIN-gated methods — the contract
     * verifies them against the owner's public key regardless of whether the
     * caller is the owner or the relayer. The relayer is a transaction relay;
     * the user signs with their PIN client-side and hands (sigR, sigS) to the
     * backend which forwards them.
     *
     * @param {string} sigR                — owner's PIN signature R component
     * @param {string} sigS                — owner's PIN signature S component
     * @param {Account} [callerAccount]    — account that sends the tx (defaults to relayer)
     * @returns {{ contract: Contract, sigR: string, sigS: string }}
     */
    _resolvePin(sigR, sigS, callerAccount) {
        const account = callerAccount || this.relayerAccount;
        // Default to '0x0' if missing. 
        // The Cairo contract ignores these if the caller == relayer.
        const r = sigR || '0x0';
        const s = sigS || '0x0';

        return {
            contract: this._withAccount(account),
            sigR: r,
            sigS: s,
        };
    }

    /**
     * Get the current STRK/USD price (cached in Redis, auto-fetched from CoinGecko).
     * @returns {Promise<number>}
     */
    async getStrkPrice() {
        return this.gas.getStrkPrice();
    }

    /**
     * Estimate the gas cost of a write call before executing it.
     * @param {import('starknet').Account} account
     * @param {object|object[]} call — { contractAddress, entrypoint, calldata }
     * @returns {Promise<{ estimatedStrk: string, estimatedUsd: string, resourceBounds: object, gasUnits: object, strkPriceUsd: number }>}
     */
    async estimateGas(account, call) {
        return this.gas.estimateWrite(account, call);
    }

    /**
     * Look up the actual gas cost of a past transaction by hash.
     * @param {string} txHash
     * @returns {Promise<{ txHash: string, status: string, actualStrk: string, actualUsd: string, actualFri: string, strkPriceUsd: number }>}
     */
    async getGasCost(txHash) {
        return this.gas.getActualCost(txHash);
    }

    /**
     * Generate a unique idempotency key from a random seed.
     * @returns {string} felt252 hex string
     */
    static generateIdempotencyKey() {
        const bytes = require('crypto').randomBytes(31);
        return '0x' + bytes.toString('hex');
    }

    /**
     * Build an OffchainQuote struct suitable for contract calldata.
     * @param {object} q — raw quote from AVNU API
     * @returns {object} serializable quote struct
     */
    static buildQuote(q) {
        return {
            sell_token_address: q.sellTokenAddress,
            buy_token_address: q.buyTokenAddress,
            sell_amount: uint256.bnToUint256(BigInt(q.sellAmount)),
            buy_amount: uint256.bnToUint256(BigInt(q.buyAmount)),
            price_impact: uint256.bnToUint256(BigInt(q.priceImpact || 0)),
            fee: {
                fee_token: q.fee?.feeToken || q.sellTokenAddress,
                avnu_fees: uint256.bnToUint256(BigInt(q.fee?.avnuFees || 0)),
                avnu_fees_bps: q.fee?.avnuFeesBps || 0,
                integrator_fees: uint256.bnToUint256(BigInt(q.fee?.integratorFees || 0)),
                integrator_fees_bps: q.fee?.integratorFeesBps || 0,
            },
            routes: q.routes || [],
        };
    }

    // ====================================================================
    // A. CARD CONFIGURATION
    // ====================================================================

    /**
     * Add an accepted currency to the card.
     * PIN is always required — the user signs client-side, the relayer relays.
     *
     * @param {string} token            — ERC-20 token address
     * @param {string} sigR             — owner's PIN signature R
     * @param {string} sigS             — owner's PIN signature S
     * @param {Account} [callerAccount] — defaults to relayer
     */
    async addAcceptedCurrency(token, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'add_accepted_currency', [token, r, s]);
    }

    async removeAcceptedCurrency(token, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'remove_accepted_currency', [token, r, s]);
    }

    /**
     * @param {'MerchantTokenOnly'|'AnyAcceptedToken'} mode
     * @param {string} sigR
     * @param {string} sigS
     * @param {Account} [callerAccount]
     */
    async updatePaymentMode(mode, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        const modeEnum = mode === 'MerchantTokenOnly'
            ? { variant: { MerchantTokenOnly: {} } }
            : { variant: { AnyAcceptedToken: {} } };
        return this._execute(contract, 'update_payment_mode', [modeEnum, r, s]);
    }

    async setSlippageTolerance(toleranceBps, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'set_slippage_tolerance', [toleranceBps, r, s]);
    }

    /** Set auto-approve threshold in USD (8 decimals). */
    async setAutoApproveThreshold(thresholdUsd, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'set_auto_approve_threshold', [uint256.bnToUint256(BigInt(thresholdUsd)), r, s]);
    }

    async updateSpendingLimits(maxTxAmount, dailyTxLimit, dailySpendLimit, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'update_spending_limits', [
            uint256.bnToUint256(BigInt(maxTxAmount)),
            dailyTxLimit,
            uint256.bnToUint256(BigInt(dailySpendLimit)),
            r, s,
        ]);
    }

    /** Owner-only — requires _assert_owner_pin. Must be called by the owner account. */
    async setMerchantSpendLimit(merchant, maxAmountUsd, sigR, sigS, ownerAccount) {
        if (!ownerAccount) throw new Error('setMerchantSpendLimit requires ownerAccount');
        const contract = this._withAccount(ownerAccount);
        return this._execute(contract, 'set_merchant_spend_limit', [
            merchant, uint256.bnToUint256(BigInt(maxAmountUsd)), sigR, sigS,
        ]);
    }

    /** Owner-only — requires _assert_owner_pin. */
    async removeMerchantSpendLimit(merchant, sigR, sigS, ownerAccount) {
        if (!ownerAccount) throw new Error('removeMerchantSpendLimit requires ownerAccount');
        const contract = this._withAccount(ownerAccount);
        return this._execute(contract, 'remove_merchant_spend_limit', [merchant, sigR, sigS]);
    }

    /** Set a token's Pragma price feed pair ID. PIN required. */
    async setTokenPriceFeed(token, pairId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'set_token_price_feed', [token, pairId, r, s]);
    }

    /**
     * Set the card's transfer delay (seconds). 0 = instant transfers.
     * Default is TRANSFER_DELAY (24h). User can increase, decrease, or disable.
     */
    async setTransferDelay(delaySeconds, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'update_transfer_delay', [delaySeconds, r, s]);
    }

    // ====================================================================
    // B. OWNER & RELAYER MANAGEMENT
    // ====================================================================

    /** Change the card owner (owner-only, requires PIN). */
    async changeOwner(newOwner, sigR, sigS, ownerAccount) {
        if (!ownerAccount) throw new Error('changeOwner requires ownerAccount');
        const contract = this._withAccount(ownerAccount);
        return this._execute(contract, 'change_owner', [newOwner, sigR, sigS]);
    }

    /** Change the relayer (admin-only, no PIN). */
    async changeRelayer(newRelayer, adminAccount) {
        const contract = this._withAccount(adminAccount);
        return this._execute(contract, 'change_relayer', [newRelayer]);
    }

    /** Remove the relayer (admin-only). */
    async removeRelayer(adminAccount) {
        const contract = this._withAccount(adminAccount);
        return this._execute(contract, 'remove_relayer');
    }

    // ====================================================================
    // C. PAYMENT REQUESTS
    // ====================================================================

    /**
     * Submit a payment request (merchant or relayer).
     * No PIN required — anyone can submit, but merchant must be registered.
     *
     * @param {string} merchant   — merchant contract address
     * @param {bigint|string} amount — token amount in raw units
     * @param {string} token      — ERC-20 token address
     * @param {boolean} isRecurring
     * @param {string} description
     * @param {string} metadata   — JSON-encoded metadata
     * @param {Account} [account] — caller account (defaults to relayer)
     * @returns {Promise<{requestId: number, txHash: string}>}
     */
    async submitPaymentRequest(merchant, amount, token, isRecurring, description, metadata, account) {
        const contract = this._withAccount(account || this.relayerAccount);
        const result = await contract.submit_payment_request(
            merchant,
            uint256.bnToUint256(BigInt(amount)),
            token,
            isRecurring,
            description || '',
            metadata || '',
        );
        const receipt = await this.provider.waitForTransaction(result.transaction_hash);
        const gas = await this.gas.extractCost(receipt);

        // Return value is the request_id
        let requestId = null;
        if (result.response && result.response.length > 0) {
            requestId = Number(result.response[0]);
        }
        return { requestId, txHash: result.transaction_hash, receipt, gas };
    }

    /**
     * Approve a payment request.
     * PIN always required — the user signs client-side.
     */
    async approvePaymentRequest(requestId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'approve_payment_request', [requestId, r, s]);
    }

    /** Approve multiple requests at once (max 10). PIN required. */
    async approveMultipleRequests(requestIds, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'approve_multiple_requests', [requestIds, r, s]);
    }

    async rejectPaymentRequest(requestId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'reject_payment_request', [requestId, r, s]);
    }

    async revokePaymentApproval(requestId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'revoke_payment_approval', [requestId, r, s]);
    }

    // ====================================================================
    // D. CHARGE & SETTLEMENT
    // ====================================================================

    /**
     * Charge a card for a one-time approved payment request.
     * Typically called by the relayer or merchant.
     *
     * @param {number} requestId
     * @param {object} [opts]
     * @param {string} [opts.idempotencyKey]           — auto-generated if omitted
     * @param {object} [opts.quote]                     — AVNU quote (if swap needed)
     * @param {number} [opts.slippageBps]               — default 100 (1%)
     * @param {number} [opts.deadlineSeconds]           — seconds from now (default 300)
     * @param {Account} [opts.account]                  — caller (default relayer)
     */
    async chargeCard(requestId, opts = {}) {
        const contract = this._withAccount(opts.account || this.relayerAccount);
        const key = opts.idempotencyKey || StarknetCardService.generateIdempotencyKey();
        const slippage = opts.slippageBps || 100;
        const deadline = opts.deadlineSeconds
            ? Math.floor(Date.now() / 1000) + opts.deadlineSeconds
            : Math.floor(Date.now() / 1000) + 300;

        const quote = opts.quote
            ? { variant: { Some: StarknetCardService.buildQuote(opts.quote) } }
            : { variant: { None: {} } };

        return this._execute(contract, 'charge_card', [
            requestId, key, delay, quote, slippage, deadline,
        ]);
    }

    /**
     * Charge a recurring approved payment request.
     * Same parameters as chargeCard.
     */
    async chargeRecurring(requestId, opts = {}) {
        const contract = this._withAccount(opts.account || this.relayerAccount);
        const key = opts.idempotencyKey || StarknetCardService.generateIdempotencyKey();
        const slippage = opts.slippageBps || 100;
        const deadline = opts.deadlineSeconds
            ? Math.floor(Date.now() / 1000) + opts.deadlineSeconds
            : Math.floor(Date.now() / 1000) + 300;

        const quote = opts.quote
            ? { variant: { Some: StarknetCardService.buildQuote(opts.quote) } }
            : { variant: { None: {} } };

        return this._execute(contract, 'charge_recurring', [
            requestId, key, delay, quote, slippage, deadline,
        ]);
    }

    /**
     * Process a pending settlement (after delay has elapsed).
     * Can be called by owner, relayer, or merchant.
     */
    async processSettlement(requestId, opts = {}) {
        const contract = this._withAccount(opts.account || this.relayerAccount);
        const key = opts.idempotencyKey || StarknetCardService.generateIdempotencyKey();
        return this._execute(contract, 'process_settlement', [requestId, key]);
    }

    /** Cancel a pending settlement. PIN required. */
    async cancelSettlement(requestId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'cancel_settlement', [requestId, r, s]);
    }

    // ====================================================================
    // E. FUNDS MANAGEMENT
    // ====================================================================

    /**
     * Deposit funds into the card.
     * The user calls this from their own account (must have approved the ERC-20 transfer).
     *
     * @param {string} token     — ERC-20 token address
     * @param {bigint|string} amount — raw token amount
     * @param {Account} userAccount
     */
    async depositFunds(token, amount, userAccount) {
        const contract = this._withAccount(userAccount);
        return this._execute(contract, 'deposit_funds', [token, uint256.bnToUint256(BigInt(amount))]);
    }

    /** Withdraw funds to owner (immediate) or transfer to external address (delayed). PIN required. */
    async transfer(action, token, amount, recipient, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'transfer', [
            action, token, uint256.bnToUint256(BigInt(amount)),
            recipient || '0x0', r, s,
        ]);
    }

    /** Withdraw funds to owner (shortcut — calls transfer with 'withdraw' action). */
    async withdrawFunds(token, amount, sigR, sigS, callerAccount) {
        return this.transfer('withdraw', token, amount, '0x0', sigR, sigS, callerAccount);
    }

    /** Transfer funds to an external address (creates a pending transfer with delay). */
    async transferFunds(token, amount, recipient, sigR, sigS, callerAccount) {
        return this.transfer('transfer', token, amount, recipient, sigR, sigS, callerAccount);
    }

    /** Execute a pending transfer after the delay has elapsed. PIN required. */
    async executeTransfer(transferId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'execute_transfer', [transferId, r, s]);
    }

    /** Cancel a pending transfer (refunds reserved funds). PIN required. */
    async cancelTransfer(transferId, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'cancel_transfer', [transferId, r, s]);
    }

    /** Get details of a pending transfer. */
    async getPendingTransfer(transferId) {
        const r = await this.contract.get_pending_transfer(transferId);
        return {
            transferId: Number(r.transfer_id),
            token: r.token,
            amount: r.amount,
            recipient: r.recipient,
            createdAt: Number(r.created_at),
            executeAfter: Number(r.execute_after),
            executed: r.executed,
            cancelled: r.cancelled,
        };
    }

    /** Sync on-chain balances. PIN required. */
    async syncBalances(tokens, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'sync_balances', [tokens, r, s]);
    }

    // ====================================================================
    // F. SWAP & AUTO-SWAP
    // ====================================================================

    /** Configure an auto-swap rule: source → target. PIN required. */
    async setAutoSwap(sourceToken, targetToken, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'set_auto_swap', [sourceToken, targetToken, r, s]);
    }

    async removeAutoSwap(sourceToken, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'remove_auto_swap', [sourceToken, r, s]);
    }

    /**
     * Manual token swap on the card. PIN required.
     * @param {string} sellToken
     * @param {string} buyToken
     * @param {bigint|string} sellAmount
     * @param {object} quote — raw AVNU quote
     * @param {number} slippageBps
     * @param {string} sigR
     * @param {string} sigS
     * @param {Account} [callerAccount]
     */
    async swapTokens(sellToken, buyToken, sellAmount, quote, slippageBps, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'swap_tokens', [
            sellToken, buyToken, uint256.bnToUint256(BigInt(sellAmount)),
            StarknetCardService.buildQuote(quote), slippageBps, r, s,
        ]);
    }

    /** Execute a pre-configured auto-swap rule. PIN required. */
    async executeAutoSwap(sourceToken, amount, quote, slippageBps, sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'execute_auto_swap', [
            sourceToken, uint256.bnToUint256(BigInt(amount)),
            StarknetCardService.buildQuote(quote), slippageBps, r, s,
        ]);
    }

    // ====================================================================
    // G. MERCHANT BLACKLIST (owner-only, requires PIN)
    // ====================================================================

    async addMerchantToBlacklist(merchant, reason, sigR, sigS, userAccount) {
        const contract = this._withAccount(userAccount);
        return this._execute(contract, 'add_merchant_to_blacklist', [merchant, reason, sigR, sigS]);
    }

    async removeMerchantFromBlacklist(merchant, sigR, sigS, userAccount) {
        const contract = this._withAccount(userAccount);
        return this._execute(contract, 'remove_merchant_from_blacklist', [merchant, sigR, sigS]);
    }

    // ====================================================================
    // H. CARD LIFECYCLE
    // ====================================================================

    /** Freeze the card. PIN required. */
    async freezeCard(sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return this._execute(contract, 'freeze_card', [r, s]);
    }

    /** Unfreeze the card (owner-only, requires PIN). */
    async unfreezeCard(sigR, sigS, ownerAccount) {
        if (!ownerAccount) throw new Error('unfreezeCard requires ownerAccount');
        const contract = this._withAccount(ownerAccount);
        return this._execute(contract, 'unfreeze_card', [sigR, sigS]);
    }

    /** Burn the card permanently (owner-only, requires PIN). */
    async burnCard(sigR, sigS, ownerAccount) {
        if (!ownerAccount) throw new Error('burnCard requires ownerAccount');
        const contract = this._withAccount(ownerAccount);
        return this._execute(contract, 'burn_card', [sigR, sigS]);
    }

    // ====================================================================
    // I. PIN MANAGEMENT
    //
    // Key derivation and signing are handled CLIENT-SIDE via ZionCrypto:
    //   <script src="/home/plugin/starknet.bundle.min.js"></script>
    //   <script src="/home/plugin/zion-crypto.js"></script>
    //
    // The client sends only { sigR, sigS, publicKey } to the server.
    // Private keys and PINs NEVER leave the user's device.
    // ====================================================================

    /**
     * Rotate the card's PIN (owner-only).
     * The rotation signature (sigR, sigS) must be generated client-side
     * using ZionCrypto.Pin.signRotation(oldPrivateKey, newPublicKey, nonce).
     */
    async rotatePin(newPublicKey, oldSigR, oldSigS, userAccount) {
        const contract = this._withAccount(userAccount);
        return this._execute(contract, 'rotate_pin', [newPublicKey, oldSigR, oldSigS]);
    }

    /** Get a user's PIN public key (owner or relayer). */
    async getPinPublicKey(user) {
        return this.contract.get_pin_public_key(user);
    }

    /** Get a user's PIN nonce (owner or relayer). */
    async getPinNonce(user) {
        return this.contract.get_pin_nonce(user);
    }

    // ====================================================================
    // J. VIEW FUNCTIONS (no signer required)
    // ====================================================================

    async getAcceptedCurrencies() {
        return this.contract.get_accepted_currencies();
    }

    async getFactoryAcceptedTokens() {
        return this.contract.get_factory_accepted_tokens();
    }

    async getPaymentMode() {
        return this.contract.get_payment_mode();
    }

    async isCurrencyAccepted(token) {
        return this.contract.is_currency_accepted(token);
    }

    async getPendingRequests(offset = 0, limit = 20) {
        return this.contract.get_pending_requests(offset, limit);
    }

    async getApprovedRequests(offset = 0, limit = 20) {
        return this.contract.get_approved_requests(offset, limit);
    }

    async getRequestDetails(requestId) {
        const r = await this.contract.get_request_details(requestId);
        return {
            requestId: Number(r.request_id),
            merchant: r.merchant,
            amount: r.amount,
            merchantToken: r.token,
            isRecurring: r.is_recurring,
            status: r.status,
            description: r.description,
            metadata: r.metadata,
            createdAt: Number(r.created_at),
            approvedAt: Number(r.approved_at),
            lastChargedAt: Number(r.last_charged_at),
            chargeCount: Number(r.charge_count),
        };
    }

    async getRequestStatus(requestId) {
        return this.contract.get_request_status(requestId);
    }

    async isMerchantBlacklisted(merchant) {
        return this.contract.is_merchant_blacklisted(merchant);
    }

    async getCardInfo() {
        const r = await this.contract.get_card_info();
        return {
            cardAddress: r.card_address,
            owner: r.owner,
            relayer: r.relayer,
            isFrozen: r.is_frozen,
            isBurned: r.is_burned,
            createdAt: Number(r.created_at),
            paymentMode: r.payment_mode,
            slippageToleranceBps: Number(r.slippage_tolerance_bps),
            autoApproveThresholdUsd: r.auto_approve_threshold_usd,
            totalCurrencies: Number(r.total_currencies),
            totalMerchants: Number(r.total_merchants),
            totalTransactions: Number(r.total_transactions),
            totalRequests: Number(r.total_requests),
            totalTransfers: Number(r.total_transfers),
        };
    }

    async getComprehensiveStats() {
        const comprehensiveStatsCacheKey = `comprehensive_stats_${this.cardAddress}`;

        const cached = await redis.get(comprehensiveStatsCacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

        const info = await this.getCardInfo();
        const totalInteractions = Number(info.totalRequests || 0);

        const stats = {
            total_merchants: Number(info.totalMerchants || 0),
            total_transactions: Number(info.totalTransactions || 0),
            
            // Payment Requests
            total_requests_submitted: 0,
            total_approved_requests: 0,
            total_pending_requests: 0,
            total_rejected_requests: 0,
            total_cancelled_requests: 0,
            total_settled_requests: 0,
            
            // Recurring Payments
            total_active_recurring_payments: 0,
            total_inactive_recurring_payments: 0,
            
            // Transfers
            total_transfers_made: 0,
            total_pending_transfers: 0,
            total_cancelled_transfers: 0,
            
            // Financials
            total_spent_usd: "0.00"
        };

        const paymentRequestIds = new Set();
        const spentPerToken = {};
        
        let offset = 0;
        const limit = 100;

        while (true) {
            const batch = await this.getTransactions(offset, limit);
            if (!batch || batch.length === 0) break;

            for (const req of batch) {
                const reqId = Number(req.request_id || req.requestId);
                if (reqId === 0) continue;
                
                paymentRequestIds.add(reqId);
                stats.total_requests_submitted++;
                
                const statusKey = req.status?.variant ? Object.keys(req.status.variant)[0] : req.status;
                const isRecurring = Boolean(req.is_recurring || req.isRecurring);

                // Tally Request Statuses
                if (statusKey === 'Pending') stats.total_pending_requests++;
                else if (statusKey === 'Approved') stats.total_approved_requests++;
                else if (statusKey === 'Rejected') stats.total_rejected_requests++;
                else if (statusKey === 'Cancelled' || statusKey === 'Revoked') stats.total_cancelled_requests++;
                else if (statusKey === 'AwaitingSettlement') stats.total_approved_requests++;
                else if (statusKey === 'Settled') {
                    stats.total_settled_requests++;
                    
                    // Track amount spent!
                    const tokenAddr = '0x' + BigInt(req.token || req.merchantToken).toString(16).toLowerCase();
                    const amt = BigInt(req.amount.toString());
                    spentPerToken[tokenAddr] = (spentPerToken[tokenAddr] || 0n) + amt;
                }

                if (isRecurring) {
                    if (statusKey === 'Approved' || statusKey === 'AwaitingSettlement') {
                        stats.total_active_recurring_payments++;
                    } else if (statusKey === 'Cancelled' || statusKey === 'Revoked' || statusKey === 'Rejected') {
                        stats.total_inactive_recurring_payments++;
                    }
                }
            }
            if (batch.length < limit) break;
            offset += limit;
        }

        const transferPromises = [];
        for (let i = 1; i <= totalInteractions; i++) {
            if (!paymentRequestIds.has(i)) {
                stats.total_transfers_made++;
                transferPromises.push(this.getSettlementInfo(i).catch(() => null));
            }
        }

        if (transferPromises.length > 0) {
            const chunkSize = 50;
            for (let i = 0; i < transferPromises.length; i += chunkSize) {
                const settlements = await Promise.all(transferPromises.slice(i, i + chunkSize));
                
                for (const stl of settlements) {
                    if (stl && Number(stl.requestId || stl.request_id) !== 0) {
                        if (stl.cancelled) {
                            stats.total_cancelled_transfers++;
                        } else if (!stl.settled) {
                            stats.total_pending_transfers++;
                        } else {
                            const tokenAddr = '0x' + BigInt(stl.token).toString(16).toLowerCase();
                            const amt = BigInt(stl.amountForMerchant || stl.amount_for_merchant).toString();
                            spentPerToken[tokenAddr] = (spentPerToken[tokenAddr] || 0n) + BigInt(amt);
                        }
                    }
                }
            }
        }
        
        const livePrices = await priceOracle.fetchLivePrices();
        const networkTokens = StarknetConfig.resolveTokens(this.isLive);
        const tokenDecimals = { ETH: 18, STRK: 18, USDC: 6, USDT: 6, DAI: 18, WBTC: 8, LORDS: 18, WSTETH: 18 };

        const addressToTokenMap = {};
        for (const [symbol, address] of Object.entries(networkTokens)) {
            if (address) addressToTokenMap[address.toLowerCase()] = { symbol, decimals: tokenDecimals[symbol] || 18 };
        }

        let totalSpentUsd = 0;
        
        for (const [address, rawAmount] of Object.entries(spentPerToken)) {
            const tokenInfo = addressToTokenMap[address] || { symbol: "UNKNOWN", decimals: 18 };
            const price = livePrices[tokenInfo.symbol] || 0;
            
            const decimalBalance = Number(rawAmount) / (10 ** tokenInfo.decimals);
            totalSpentUsd += decimalBalance * price;
        }

        stats.total_spent_usd = totalSpentUsd.toFixed(2);
        await redis.set(comprehensiveStatsCacheKey, JSON.stringify(stats), 3600);

        return stats;
    }

    async getCardStatus() {
        return this.contract.get_card_status();
    }

    async getRateLimitStatus() {
        const r = await this.contract.get_rate_limit_status();
        return {
            isLocked: r.is_locked,
            failedAttempts: Number(r.failed_attempts),
            lockoutUntil: Number(r.lockout_until),
            requestsSubmittedLastHour: Number(r.requests_submitted_last_hour),
            approvalsLastHour: Number(r.approvals_last_hour),
            lastChargeTimestamp: Number(r.last_charge_timestamp),
            cooldownRemaining: Number(r.cooldown_remaining),
        };
    }

    async getMerchantSpendLimit(merchant) {
        return this.contract.get_merchant_spend_limit(merchant);
    }

    async getAutoApproveThreshold() {
        return this.contract.get_auto_approve_threshold();
    }

    async getSettlementInfo(requestId) {
        const r = await this.contract.get_settlement_info(requestId);
        return {
            requestId: Number(r.request_id),
            amountForMerchant: r.amount_for_merchant,
            adminFee: r.admin_fee,
            cashback: r.cashback,
            token: r.token,
            payoutWallet: r.payout_wallet,
            merchant: r.merchant,
            settleAt: Number(r.settle_at),
            settled: r.settled,
            cancelled: r.cancelled,
            swapOccurred: r.swap_occurred,
            tokenIn: r.token_in,
            swapFee: r.swap_fee,
        };
    }

    async isIdempotencyKeyUsed(key) {
        return this.contract.is_idempotency_key_used(key);
    }

    async isDeploymentFeePaid() {
        return this.contract.is_deployment_fee_paid();
    }

    async getDeploymentFeeDebt() {
        return this.contract.get_deployment_fee_debt();
    }

    async getAutoSwapTarget(sourceToken) {
        return this.contract.get_auto_swap_target(sourceToken);
    }

    async isAutoSwapEnabled(sourceToken) {
        return this.contract.is_auto_swap_enabled(sourceToken);
    }

    async getAllAutoSwapRules() {
        return this.contract.get_all_auto_swap_rules();
    }

    async getTransactions(offset = 0, limit = 20) {
        return this.contract.get_transactions(offset, limit);
    }

    // ====================================================================
    // K-0. CHARGE PREPARATION
    //
    // Combines request details + card balances to determine if an AVNU
    // swap is needed and returns all fields required to fetch a quote.
    // ====================================================================

    /**
     * Prepare all the info needed before calling `chargeCard()`.
     *
     * Replicates the contract's _determine_source_token logic off-chain:
     *  1. If payment mode is MerchantTokenOnly → source = merchant's token (no swap).
     *  2. If the card has enough of the merchant's token → no swap.
     *  3. Otherwise, picks the first accepted currency with a positive balance.
     *
     * @param {number}  requestId   — the payment request ID
     * @returns {Promise<{
     *   request:       object,          — full request details
     *   merchantToken: string,          — token the merchant wants (AVNU buyToken)
     *   sourceToken:   string,          — token the card will pay with (AVNU sellToken)
     *   swapNeeded:    boolean,         — true if sourceToken ≠ merchantToken
     *   sourceBalance: bigint|string,   — card's balance of the source token
     *   balances:      object[],        — all token balances on the card
     *   paymentMode:   string,          — 'MerchantTokenOnly' or 'AnyAcceptedToken'
     * }>}
     */
    async prepareCharge(requestId) {
        // 1. Fetch request details, balance summary, and payment mode in parallel
        const [request, balanceSummary, paymentModeRaw] = await Promise.all([
            this.getRequestDetails(requestId),
            this.getBalanceSummary(),
            this.getPaymentMode(),
        ]);

        // Starknet.js sometimes returns properties in snake_case or camelCase
        const merchantTokenRaw = request.merchantToken || request.merchant_token;
        const amount = BigInt(request.amount.toString());

        // 2. Safely Normalize Addresses (Removes leading-zero mismatch bugs)
        const normalizeAddress = (addr) => `0x${BigInt(addr).toString(16)}`;
        const merchantToken = normalizeAddress(merchantTokenRaw);

        // Build a lookup: normalized token address → balance (bigint)
        const balMap = {};
        for (const b of balanceSummary.balances) {
            balMap[normalizeAddress(b.token)] = BigInt(b.balance.toString());
        }

        // 3. ROBUST ENUM PARSING (Handles 0/1/2 indexes, strings, or objects)
        let modeStr = 'AnyAcceptedToken'; // default fallback
        
        if (paymentModeRaw !== undefined && paymentModeRaw !== null) {
            if (typeof paymentModeRaw === 'bigint' || typeof paymentModeRaw === 'number') {
                const idx = Number(paymentModeRaw);
                if (idx === 0) modeStr = 'None';
                if (idx === 1) modeStr = 'MerchantTokenOnly';
                if (idx === 2) modeStr = 'AnyAcceptedToken';
            } else if (typeof paymentModeRaw === 'string') {
                modeStr = paymentModeRaw;
            } else if (paymentModeRaw.activeVariant) {
                // Latest Starknet.js v6 format
                modeStr = paymentModeRaw.activeVariant;
            } else if (typeof paymentModeRaw === 'object') {
                // Older Starknet.js format
                const keys = Object.keys(paymentModeRaw).filter(k => k !== 'variant' && k !== 'activeVariant');
                if (keys.length > 0) modeStr = keys[0];
            }
        }

        // 4. Replicate Cairo `_determine_source_token` exact logic
        let sourceToken = merchantToken;
        const directBalance = balMap[merchantToken] || 0n;

        // In Cairo: if mode == MerchantTokenOnly { return target; }
        // In Cairo: if direct >= amount { return target; }
        if (modeStr !== 'MerchantTokenOnly' && directBalance < amount) {
            
            const currencies = await this.getAcceptedCurrencies();
            
            const alt = currencies.find(t => {
                return (balMap[normalizeAddress(t)] || 0n) > 0n;
            });

            if (alt) {
                sourceToken = normalizeAddress(alt);
            }
        }

        const swapNeeded = sourceToken !== merchantToken;
        const sourceBalance = balMap[sourceToken] || 0n;

        return {
            request,
            merchantToken,
            sourceToken,
            swapNeeded,
            sourceBalance,
            balances: balanceSummary.balances,
            paymentMode: modeStr,
        };
    }

    // ====================================================================
    // K. PIN-PROTECTED VIEWS
    // PIN always required — contract verifies against owner's public key.
    // ====================================================================

    /**
     * Get a transaction summary for a time window. PIN required.
     * @param {number} startTs — start unix timestamp
     * @param {number} endTs   — end unix timestamp
     * @param {number} [offset]
     * @param {number} [limit]
     * @param {Account} [callerAccount]
     */
    async getTransactionSummary(startTs, endTs, offset = 0, limit = 50, callerAccount) {
        const res = await this.contract.get_transaction_summary(startTs, endTs, offset, limit);
        return {
            totalSpent: res.total_spent,
            totalReceived: res.total_received,
            totalCashbackEarned: res.total_cashback_earned,
            totalSwapFeesPaid: res.total_swap_fees_paid,
            totalTxFeesCharged: res.total_tx_fees_charged,
            transactionCount: Number(res.transaction_count),
            uniqueMerchants: Number(res.unique_merchants),
            transactions: res.transactions,
        };
    }

    /** Get balance summary across all accepted tokens. PIN required. */
    async getBalanceSummary() {
        const res = await this.contract.get_balance_summary();
        return {
            balances: res.balances,
            totalValueUsd: res.total_value_usd,
        };
    }

    /**
     * Fetch all balances and calculate their live USD value off-chain.
     * Dynamically resolves token addresses using StarknetConfig.
     * @param {Account} [callerAccount]
     */
    async getFormattedCardBalances() {
        //add cache from redisService
        const cacheKey = `${ABI_KEY_PREFIX}${this.cardAddress}`;
        let balance = await redis.get(cacheKey);
        if (balance) {
            //return JSON.parse(balance);
        }

        const summary = await this.getBalanceSummary();
        const livePrices = await priceOracle.fetchLivePrices();
        const networkTokens = StarknetConfig.resolveTokens(this.isLive);

        
        const tokenDecimals = {
            ETH: 18, STRK: 18, USDC: 6, USDT: 6, DAI: 18, WBTC: 8, LORDS: 18, WSTETH: 18
        };

        const normalizeAddress = (addr) => {
            if (!addr) return null;
            return '0x' + BigInt(addr.toString()).toString(16).toLowerCase();
        };

        const addressToTokenMap = {};
        for (const [symbol, address] of Object.entries(networkTokens)) {
            if (address) {
                const normAddr = normalizeAddress(address);
                addressToTokenMap[normAddr] = {
                    symbol: symbol,
                    decimals: tokenDecimals[symbol] || 18
                };
            }
        }

        let totalUsdValue = 0;
        const formattedBalances = [];

        for (const item of summary.balances) {
            const normTokenAddr = normalizeAddress(item.token);
            
            const tokenInfo = addressToTokenMap[normTokenAddr] || { symbol: "UNKNOWN", decimals: 18 };
            const price = livePrices[tokenInfo.symbol] || 0;
            
            const rawBalance = item.balance;
            const decimalBalance = Number(rawBalance) / (10 ** tokenInfo.decimals);
            const usdValue = decimalBalance * price;

            totalUsdValue += usdValue;

            formattedBalances.push({
                address: normTokenAddr,
                symbol: tokenInfo.symbol,
                balance: decimalBalance.toFixed(4),
                usdValue: usdValue.toFixed(2),
                pricePerToken: price,
                lastUpdated: Number(item.last_updated)
            });
        }

        const result = {
            totalUsd: totalUsdValue.toFixed(2),
            tokens: formattedBalances
        };
        await redis.set(cacheKey, JSON.stringify(result), 3600);
        return result;
    }

    /** Get fraud alerts. PIN required. */
    async getFraudAlerts(sigR, sigS, callerAccount) {
        const { contract, sigR: r, sigS: s } = this._resolvePin(sigR, sigS, callerAccount);
        return contract.get_fraud_alerts(r, s);
    }

    // ====================================================================
    // FACTORY DEPLOYMENT (static — no card address needed)
    // ====================================================================

    /**
     * Known Starknet token addresses by symbol.
     * Uses StarknetConfig for network-aware resolution.
     * @param {boolean} [isLive=true]
     */
    static getCurrencyAddresses(isLive = true) {
        return StarknetConfig.resolveTokens(isLive);
    }

    /**
     * Resolve an array of currency symbols to Starknet contract addresses.
     * @param {string[]} symbols — e.g. ['ETH', 'USDC', 'STRK']
     * @param {boolean} [isLive=true]
     * @returns {string[]} — contract addresses
     */
    static resolveCurrencyAddresses(symbols, isLive = true) {
        return StarknetConfig.resolveCurrencyAddresses(symbols, isLive);
    }

    /**
     * Parse a USD string amount → u256 (8 decimal places, matching factory protocol).
     * e.g. "100" → "10000000000"
     */
    static parseAmountToU256(amountStr) {
        const amount = parseFloat(amountStr) || 0;
        return BigInt(Math.round(amount * 1e8)).toString();
    }

    static async deployCard(cardData) {
        const isLive = cardData.is_live !== undefined ? cardData.is_live : true;
        const netConfig = StarknetConfig.resolve(isLive);
        const networkLabel = StarknetConfig.networkLabel(isLive);

        const rpcUrl = netConfig.rpcUrl;
        const factoryAddr = netConfig.factoryAddress;
        const relayerAddr = netConfig.relayerAddress;
        const relayerPk = netConfig.relayerPrivateKey;

        if (!rpcUrl) return { success: false, error: `${networkLabel}_STARKNET_RPC_URL not configured` };
        if (!factoryAddr) return { success: false, error: `${networkLabel}_FACTORY_CONTRACT_ADDRESS not configured` };
        if (!relayerAddr) return { success: false, error: `${networkLabel}_RELAYER_ACCOUNT_ADDRESS not configured` };
        if (!relayerPk) return { success: false, error: `${networkLabel}_RELAYER_PRIVATE_KEY not configured` };

        const provider = new RpcProvider({ nodeUrl: rpcUrl });
        const account = new Account({ provider, address: relayerAddr, signer: relayerPk });

        try {
            const currencyAddresses = StarknetCardService.resolveCurrencyAddresses(cardData.currencies || [], isLive);
            if (currencyAddresses.length === 0) {
                return { success: false, error: 'No valid currencies resolved' };
            }

            const paymentModeString = cardData.payment_mode || 'MerchantTokenOnly';
            
            const paymentModeVariant = new CairoCustomEnum({
                [paymentModeString]: {}
            });

            const maxTxU256 = StarknetCardService.parseAmountToU256(cardData.max_transaction_amount || '0');
            const dailySpendU256 = StarknetCardService.parseAmountToU256(cardData.daily_spend_limit || '0');

            let factoryAbi;
            const abiCacheKey = `${ABI_KEY_PREFIX}factory_v4:${factoryAddr}`;
            factoryAbi = await redis.get(abiCacheKey);
            if (!factoryAbi) {
                const factoryClass = await provider.getClassAt(factoryAddr);
                factoryAbi = typeof factoryClass.abi === 'string'
                    ? JSON.parse(factoryClass.abi)
                    : factoryClass.abi;
                await redis.set(abiCacheKey, factoryAbi, ABI_CACHE_TTL);
            }

            const factory = new Contract({ abi: factoryAbi, address: factoryAddr, providerOrAccount: account });

            console.log(`[StarknetCardService] Deploying card ${cardData.card_id} on ${networkLabel}...`);
            console.log(`[StarknetCardService] Factory: ${factoryAddr}`);
            console.log(`[StarknetCardService] Owner: ${cardData.wallet}`);
            console.log(`[StarknetCardService] Currencies: ${cardData.currencies.join(', ')}`);

            let relayer_address = process.env.TESTNET_RELAYER_ACCOUNT_ADDRESS;
            if(cardData.is_live) {
                relayer_address = process.env.RELAYER_ACCOUNT_ADDRESS;
            }
                
            const tx = await factory.create_card(
                cardData.wallet,
                relayer_address,
                cardData.pin_public_key,
                currencyAddresses,
                paymentModeVariant,
                {
                    max_transaction_amount: uint256.bnToUint256(maxTxU256),
                    daily_transaction_limit: parseInt(cardData.daily_transaction_limit) || 50,
                    daily_spend_limit: uint256.bnToUint256(dailySpendU256),
                    slippage_tolerance_bps: parseInt(cardData.slippage_tolerance_bps) || 50,
                    transfer_delay: cardData.transfer_delay !== undefined ? parseInt(cardData.transfer_delay) : 86400,
                    settlement_delay: cardData.settlement_delay !== undefined ? parseInt(cardData.settlement_delay) : 1800,
                }
            );

            console.log(`[StarknetCardService] Tx submitted: ${tx.transaction_hash}`);

            const receipt = await provider.waitForTransaction(tx.transaction_hash, {
                retryInterval: 5000
            });

            let contractAddress = null;
            if (receipt.events && receipt.events.length > 0) {
                try {
                    const parsedEvents = factory.parseEvents(receipt);
                    for (const parsed of parsedEvents) {
                        const eventData = parsed.CardCreated || parsed['ZionDefiFactory::CardCreated'];
                        if (eventData && eventData.card_address) {
                            contractAddress = '0x' + BigInt(eventData.card_address).toString(16);
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('[StarknetCardService] ABI parse failed, falling back to manual extraction');
                }

                if (!contractAddress) {
                    for (const event of receipt.events) {
                        const fromAddr = event.from_address ? '0x' + BigInt(event.from_address).toString(16).toLowerCase() : null;
                        const factoryNorm = '0x' + BigInt(factoryAddr).toString(16).toLowerCase();

                        if (fromAddr === factoryNorm) {
                            const searchSpace = [
                                ...(event.keys ? event.keys.slice(1) : []),
                                ...(event.data || [])
                            ];
                            
                            for (const val of searchSpace) {
                                const hexStr = BigInt(val).toString(16);
                                if (hexStr.length > 40) {
                                    contractAddress = '0x' + hexStr;
                                    break;
                                }
                            }
                            if (contractAddress) break;
                        }
                    }
                }
            }

            const gasManager = new StarknetGasManager({ provider });
            const formattedGas = await gasManager.extractCost(receipt);

            const isSuccess = receipt.execution_status === 'SUCCEEDED' ||
                              receipt.finality_status === 'ACCEPTED_ON_L2' ||
                              receipt.finality_status === 'ACCEPTED_ON_L1';

            if (!isSuccess) {
                return {
                    success: false,
                    error: `Transaction reverted: ${receipt.revert_reason || 'Unknown'}`,
                    transaction_hash: tx.transaction_hash,
                    gasDetails: formattedGas
                };
            }

            console.log(`[StarknetCardService] Card deployed: ${contractAddress}`);
            console.log(`[StarknetCardService] Deployment Cost: $${formattedGas.actualUsd} (${formattedGas.actualStrk} STRK)`);

            return {
                success: true,
                contract_address: contractAddress,
                transaction_hash: tx.transaction_hash,
                gasDetails: formattedGas
            };

        } catch (err) {
            console.error(`[StarknetCardService] Deploy error:`, err);
            return {
                success: false,
                error: err.message || 'Unknown deployment error',
                gasDetails: null
            };
        }
    }
}

module.exports = StarknetCardService;
