/**
 * ZionDefi SDK — Usage Example
 *
 * Demonstrates:
 *   1. Deploying a new card via the factory
 *   2. Setting protocol fees (owner-only)
 *   3. Registering a merchant (relayer-only)
 *   4. Interacting with the deployed card
 *
 * -----------------------------------------------------------------
 * Required env vars (set in .env or export before running):
 *
 *   STARKNET_RPC_URL            — e.g. https://starknet-mainnet.public.blastapi.io
 *   FACTORY_CONTRACT_ADDRESS    — deployed ZionDefiFactory address
 *   OWNER_ACCOUNT_ADDRESS       — protocol owner's starknet address
 *   OWNER_PRIVATE_KEY           — protocol owner's private key
 *   RELAYER_ACCOUNT_ADDRESS     — authorized relayer address
 *   RELAYER_PRIVATE_KEY         — relayer private key
 *   REDIS_URI                   — (optional) default redis://localhost:6379
 *
 * -----------------------------------------------------------------
 * Fee format:
 *
 *   All USD fees in the contract use Pragma's 8-decimal fixed-point.
 *   The `usd()` helper converts human-readable dollars:
 *
 *     usd(2)       → 200000000n    ($2.00)
 *     usd(0.5)     → 50000000n     ($0.50)
 *     usd(10.25)   → 1025000000n   ($10.25)
 *
 *   Transaction fee percent is in basis points (u16):
 *     40  = 0.40%
 *     100 = 1.00%
 *
 *   Cashback percent is a simple integer (u8):
 *     10 = 10% of the transaction fee goes back to the user
 *
 * -----------------------------------------------------------------
 * Card deployment flow:
 *
 *   The factory holds the ZionDefiCard class hash (set at factory deploy).
 *   When you call `factory.createCard(...)`, the factory internally calls
 *   `deploy_syscall` with that class hash plus all constructor args:
 *
 *     constructor(owner, admin, authorized_relayer, pin_public_key,
 *                 accepted_currencies, payment_mode, initial_config,
 *                 deployment_fee_usd)
 *
 *   You do NOT pass these constructor args directly — the factory builds
 *   them from the protocol state (admin, relayer, deployment fee) and your
 *   inputs (pin key, currencies, mode, config).
 *
 *   The returned `cardAddress` is the deployed card's contract address.
 *   You never need the card class hash in the SDK.
 * -----------------------------------------------------------------
 */

require('dotenv').config();

const { Account, RpcProvider } = require('starknet');
const { StarknetFactoryService, usd } = require('./src/services/StarknetFactoryService');
const StarknetCardService = require('./src/services/StarknetCardService');

// ---- Token addresses (Starknet mainnet examples) ----
const USDC  = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8';
const USDT  = '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8';
const ETH   = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

async function main() {
    // ================================================================
    // 1. INITIALIZE THE FACTORY SERVICE
    // ================================================================

    const factory = await StarknetFactoryService.create();
    console.log('Factory service ready');

    // ================================================================
    // 2. SET PROTOCOL FEES (owner-only)
    //
    //    Use the `usd()` helper for dollar amounts.
    //    Transaction fee percent is in basis points (40 = 0.4%).
    //    Cashback percent is plain integer (10 = 10%).
    // ================================================================

    // Deployment fee: $2.00
    await factory.setDeploymentFee(usd(2));
    console.log('Deployment fee set to $2.00');

    // Transaction fee: 0.4% with a $10 cap
    await factory.setTransactionFeePercent(40);
    await factory.setTransactionFeeCap(usd(10));
    console.log('Transaction fee: 0.4%, capped at $10');

    // User cashback: 10% of the transaction fee
    await factory.setUserCashbackPercent(10);
    console.log('Cashback: 10% of fee');

    // Card burn fee: $1.00
    await factory.setBurnFee(usd(1));
    console.log('Burn fee: $1.00');

    // ================================================================
    // 3. REGISTER A MERCHANT (relayer-only)
    // ================================================================

    const MERCHANT_ADDR  = '0x0123...';  // merchant's Starknet address
    const PAYOUT_WALLET  = '0x0456...';  // where settlements go

    await factory.registerMerchant(
        MERCHANT_ADDR,
        PAYOUT_WALLET,
        'Acme Coffee',
        'billing@acmecoffee.com',
        true,  // KYC verified
    );
    console.log('Merchant registered');

    // Give them a 5% fee discount and instant settlement
    await factory.setMerchantDiscount(MERCHANT_ADDR, 500); // 500 bps = 5%
    await factory.setMerchantInstantSettlement(MERCHANT_ADDR, true);
    console.log('Merchant discount & instant settlement configured');

    // ================================================================
    // 4. DEPLOY A CARD FOR A USER
    //
    //    The user signs this from their own account.
    //    The factory deploys the card via deploy_syscall using the
    //    stored ZionDefiCard class hash. All card constructor args
    //    (owner, admin, relayer, deployment_fee_usd, etc.) are built
    //    automatically by the factory.
    // ================================================================

    const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });

    // In production this comes from the user's wallet (e.g. ArgentX / Braavos).
    const userAccount = new Account(
        provider,
        '0xUSER_ADDRESS',
        '0xUSER_PRIVATE_KEY',
    );

    // PIN public key — derived CLIENT-SIDE using ZionCrypto.Pin.deriveKeys()
    // The PIN and private key NEVER leave the user's device.
    //
    // Client-side code:
    //   const { publicKey } = ZionCrypto.Pin.deriveKeys(pin, address);
    //   await vault.storeKey(`pin:${address}`, privateKey);
    //   // Send only publicKey to server
    //
    const pinPublicKey = '0x...'; // ← received from client

    const { cardAddress, txHash } = await factory.createCard(
        userAccount,
        pinPublicKey,
        [USDC, ETH],                   // accepted currencies on this card
        'AnyAcceptedToken',             // or 'MerchantTokenOnly'
        {
            maxTransactionAmount: usd(1000),    // $1,000 per tx
            dailyTransactionLimit: 20,          // max 20 txs/day
            dailySpendLimit: usd(5000),         // $5,000/day
            slippageToleranceBps: 100,          // 1% max slippage
        },
    );
    console.log(`Card deployed at ${cardAddress} (tx: ${txHash})`);

    // ================================================================
    // 5. INTERACT WITH THE DEPLOYED CARD
    //
    //    `cardAddress` is the deployed contract address from step 4.
    //    The SDK fetches the ABI from the chain automatically.
    // ================================================================

    const card = await StarknetCardService.create({ cardAddress });
    console.log('Card service ready');

    // -- Read-only views (no signer, no PIN) --
    const status = await card.getCardStatus();
    console.log('Card status:', status);

    const info = await card.getCardInfo();
    console.log('Card info:', info);

    // -- PIN-gated write via relayer --
    // PIN signatures are generated CLIENT-SIDE using ZionCrypto:
    //
    //   const nonce = await fetch('/api/card/pin-nonce'); // server calls card.getPinNonce()
    //   const { sigR, sigS } = ZionCrypto.Pin.signVerify(privateKey, nonce);
    //   // Send sigR, sigS to server
    //
    const sigR = '0x...'; // ← received from client
    const sigS = '0x...'; // ← received from client

    await card.addAcceptedCurrency(USDT, sigR, sigS);
    console.log('USDT added to card');

    await card.setSlippageTolerance(150, sigR, sigS);  // 1.5%
    console.log('Slippage updated');

    // -- Freeze/unfreeze (freeze via relayer, unfreeze owner-only) --
    await card.freezeCard(sigR, sigS);
    console.log('Card frozen');

    await card.unfreezeCard(sigR, sigS, userAccount);
    console.log('Card unfrozen (owner-only)');

    // -- PIN rotation (owner-only) --
    // Client-side:
    //   const oldKeys = ZionCrypto.Pin.deriveKeys(oldPin, address);
    //   const newKeys = ZionCrypto.Pin.deriveKeys(newPin, address);
    //   const { sigR, sigS } = ZionCrypto.Pin.signRotation(
    //       oldKeys.privateKey, newKeys.publicKey, nonce
    //   );
    //   // Send { newPublicKey, sigR, sigS } to server
    //
    const newPublicKey = '0x...';  // ← from client
    const rotSigR = '0x...';       // ← from client
    const rotSigS = '0x...';       // ← from client
    await card.rotatePin(newPublicKey, rotSigR, rotSigS, userAccount);
    console.log('PIN rotated, new public key:', newPublicKey);

    // Future VERIFY signatures use the new key (client-side)
    const newSigR = '0x...'; // ← from client
    const newSigS = '0x...'; // ← from client

    // -- PIN-protected views via relayer --
    const summary = await card.getBalanceSummary(newSigR, newSigS);
    console.log('Balance summary:', summary);

    // ================================================================
    // 6. PREPARE & EXECUTE A CHARGE (with AVNU quote if swap needed)
    //
    //    prepareCharge() tells you:
    //      - merchantToken: what the merchant wants (AVNU buyToken)
    //      - sourceToken:   what the card will pay with (AVNU sellToken)
    //      - swapNeeded:    whether you need an AVNU quote
    //      - sourceBalance: how much of sourceToken the card holds
    // ================================================================

    // Assume a payment request was submitted earlier and approved
    const REQUEST_ID = 1;

    // Need fresh PIN sigs (nonce increments after each use — generated client-side)
    const chargeSigR = '0x...'; // ← from client
    const chargeSigS = '0x...'; // ← from client

    const prep = await card.prepareCharge(REQUEST_ID, chargeSigR, chargeSigS);
    console.log('Charge preparation:', {
        merchantToken: prep.merchantToken,
        sourceToken: prep.sourceToken,
        swapNeeded: prep.swapNeeded,
        sourceBalance: prep.sourceBalance.toString(),
    });

    let avnuQuote = undefined;
    if (prep.swapNeeded) {
        // Fetch a quote from AVNU for sourceToken → merchantToken
        // (Replace with your actual AVNU API call)
        avnuQuote = await fetchAvnuQuote({
            sellTokenAddress: prep.sourceToken,
            buyTokenAddress:  prep.merchantToken,
            sellAmount:       prep.sourceBalance.toString(), // or calculate exact amount needed
        });
        console.log('AVNU quote fetched:', avnuQuote);
    }

    await card.chargeCard(REQUEST_ID, {
        quote: avnuQuote,       // undefined if no swap needed
        slippageBps: 100,       // 1%
        deadlineSeconds: 300,   // 5 minutes
    });
    console.log('Charge executed!');

    console.log('\nDone!');
}

// Placeholder — replace with your actual AVNU API integration
async function fetchAvnuQuote({ sellTokenAddress, buyTokenAddress, sellAmount }) {
    // https://docs.avnu.fi/avnu-paymaster/integration-guide
    // const res = await fetch('https://starknet.api.avnu.fi/swap/v2/quotes', { ... });
    return {
        sellTokenAddress,
        buyTokenAddress,
        sellAmount,
        buyAmount: sellAmount,  // placeholder
        priceImpact: '0',
        fee: { feeToken: sellTokenAddress, avnuFees: '0', avnuFeesBps: 0, integratorFees: '0', integratorFeesBps: 0 },
        routes: [],
    };
}

main().catch(console.error);
