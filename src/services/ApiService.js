const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const EncryptionService = require('./EncryptionService');
const RedisService = require('./RedisService');
const RabbitService = require('./RabbitService');
const DateHelper = require('../utils/DateHelper');

class ApiService {
    constructor(models) {
        this.ApiClient = models.ApiClient;
        this.ApiToken = models.ApiToken;
        this.User = models.User;
        this.Transactions = models.Transactions;
        this.Cards = models.Cards;

        this.date = new DateHelper(); 
    }

    /**
     * CREDENTIAL VALIDATION & IP CHECK
     */
    async validateCredentials(clientId, clientSecret, requestIp) {
        const client = await this.ApiClient.getByClientId(clientId);
        
        if (!client) return { status: false, error: 'invalid_client' };
        if (!client.is_active) return { status: false, error: 'client_revoked' };

        // A. Timing Attack Resistant Comparison

        const match = EncryptionService.verify_hash(clientSecret, client. secret_hash);

        if (!match) return { status: false, error: 'invalid_secret' };

        // Secure IP Validation (CIDR Support)
        if (client.policies?.allowed_ips?.length > 0) {
            const isAllowed = this.verifyIp(requestIp, client.policies.allowed_ips);
            if (!isAllowed) {
                console.warn(`[Security] Blocked unauthorized IP: ${requestIp} for Client: ${clientId}`);
                return { status: false, error: 'ip_not_whitelisted' };
            }
        }

        return { status: true, client };
    }

    /**
     * GENERATE TOKEN PAIR (With Deduplication)
     */
    async generateTokens(client, existingFamilyId = null, forceNew = false) {
        
        // CACHE CHECK (The Optimization)
        // Check if a valid access token already exists for this client
        const cacheKey = `access_token:${client.client_id}`;
        if (!forceNew) {
            const cachedToken = await RedisService.get(cacheKey);
            if (cachedToken) {
                return {
                    access_token: cachedToken,
                    expires_in: await RedisService.ttl(cacheKey), 
                    token_type: 'Bearer'
                };
            }
        }

        // Access Token (JWT) - 1 Hour
        const accessToken = jwt.sign(
            { 
                cid: client.client_id, 
                uid: client.user_id,
                role: 'api_client',
                is_live: client.is_live, 
                scope: client.policies.scopes || []
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRY || '3600s', issuer: process.env.APP_DOMAIN, audience: 'api.ziondefi' }
        );

        const refreshToken = crypto.randomBytes(64).toString('hex');
        const refreshExpires = this.date.addDaysTimestamp(365);
        const familyId = existingFamilyId || crypto.randomBytes(16).toString('hex');

        await this.ApiToken.saveRefreshToken(client.client_id, refreshToken, familyId, refreshExpires);

        await RedisService.set(cacheKey, accessToken, 3540); 

        return { 
            access_token: accessToken, 
            refresh_token: refreshToken, 
            expires_in: parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRY_SECONDS) || 3600, 
            token_type: 'Bearer' 
        };
    }

    /**
     * TOKEN ROTATION & REUSE DETECTION
     */
    async refreshAccessToken(incomingToken, requestIp) {
        const tokenDoc = await this.ApiToken.findRefreshToken(incomingToken);

        // Invalid Token
        if (!tokenDoc) return { status: false, error: 'invalid_grant' };

        // REUSE DETECTION (Theft Scenario)
        // If 'is_used' is true, someone is trying to replay an old token. 
        // We assume the user is compromised and revoke everything.
        if (tokenDoc.is_used || tokenDoc.revoked) {
            console.error(`[Security] Token Reuse Detected! Family: ${tokenDoc.family_id}`);
            await this.ApiToken.revokeFamily(tokenDoc.family_id);
            return { status: false, error: 'token_reuse_detected' };
        }

        // Validate Client & IP again
        const client = await this.ApiClient.getByClientId(tokenDoc.client_id);
        if (!client || !client.is_active) return { status: false, error: 'client_inactive' };

        if (client.policies?.allowed_ips?.length > 0) {
             if (!this.verifyIp(requestIp, client.policies.allowed_ips)) {
                 return { status: false, error: 'ip_not_whitelisted' };
             }
        }

        // Success: Mark old token used, issue new one
        await this.ApiToken.markAsUsed(tokenDoc._id);
        
        return await this.generateTokens(client, tokenDoc.family_id, true);
    }

    /**
     * RATE LIMITER INTERFACE
     */
    async checkRateLimit(client) {
        const limit = client.policies?.rate_limit_rpm || 60; 
        return await RedisService.checkRateLimit(client.client_id, limit, 60);
    }


    verifyIp(requestIp, allowedIps) {
        if (!allowedIps || allowedIps.length === 0) return true;
        try {
            
            const parsedReq = ipaddr.process(requestIp); 
            
            return allowedIps.some(allowed => {
                try {
                    // Check if allowed entry is CIDR (e.g., 10.0.0.0/24)
                    if (allowed.includes('/')) {
                        const parsedAllowed = ipaddr.parseCIDR(allowed);
                        return parsedReq.match(parsedAllowed);
                    } else {
                        // Single IP Comparison
                        return parsedReq.toString() === ipaddr.process(allowed).toString();
                    }
                } catch (e) { return false; }
            });
        } catch (e) { 
            console.error(`[Security] Invalid IP Format: ${requestIp}`);
            return false; 
        }
    }

    async getStats(userId) {
        const cards = await this.Cards.getCardStats(userId);
        const transactions = await this.Transactions.getVolumeStats(userId);

        if (!cards || !transactions) {
            throw new Error('Failed to fetch stats');
        }

        return { cards: cards, transactions: transactions };
     }

    /**
     * GET RECENT CARDS (With Auto-Creation for New Users)
     */
    async getRecentCards(userId, username, limit = 5, isLiveContext = true) {
        limit = parseInt(limit);
        const limitInt = limit > 0 ? limit : 5;

        // 1. Transaction-based Usage Scan
        // Returns Array directly
        const recentTxns = await this.Transactions.aggregate([
            { $match: { user_id: userId } },
            { $sort: { created_at: -1 } },
            { $limit: 100 }, 
            { $group: { _id: "$contract_address" } }, 
            { $limit: limitInt }
        ]);

        const usedAddresses = recentTxns.map(t => t._id).filter(a => a);

        // 2. Fetch Active Cards matching usage
        let cards = [];
        if (usedAddresses.length > 0) {
            // Returns Array directly
            cards = await this.Cards.find({
                user_id: userId,
                address: { $in: usedAddresses },
                status: { $in: ['active', 'frozen', 'deploying', 'failed'] }
            });
            
            // Sort by usage recency
            cards.sort((a, b) => usedAddresses.indexOf(a.address) - usedAddresses.indexOf(b.address));
        }

        // 3. Backfill with ANY other cards (Active OR Pending)
        if (cards.length < limitInt) {
            const needed = limitInt - cards.length;
            const existingIds = cards.map(c => c.card_id);

            // Fetch remaining cards regardless of status (so we find pending ones too)
            const otherCards = await this.Cards.find(
                { 
                    user_id: userId, 
                    card_id: { $nin: existingIds }
                },
                { 
                    limit: needed, 
                    sort: { created_at: -1 } 
                }
            );

            cards = [...cards, ...otherCards];
        }

        // 4. AUTO-CREATE CHECK (The "Safety Valve")
        if (cards.length === 0) {
            
            // CRITICAL: Check if ANY card exists before creating.
            // This prevents creating duplicates if the query logic above missed something.
            const existingCard = await this.Cards.findOne({ user_id: userId });

            if (existingCard) {
                // Found one! Use it.
                cards.push(existingCard);
            } else {
                // Truly zero cards. Create the Default.
                const crypto = require('crypto');
                const placeholderAddr = `0x${crypto.randomBytes(20).toString('hex')}`;
                
                const defaultCard = await this.Cards.create({
                    user_id: userId,
                    status: 'pending_deployment',
                    name: username || 'Default Card',
                    address: placeholderAddr, 
                    color: 'gray',
                    is_primary: true
                });
                
                cards.push(defaultCard);
            }
        }

        // 5. Format Output
        return cards.map(card => ({
            ...card,
            is_live: isLiveContext,
            is_pending: card.status === 'pending_deployment'
        }));
    }

    // ─── Card Operations ────────────────────────────────────────────

    async createCard(params) {
        const {
            userId, userName, wallet, walletChoice, pinPublicKey,
            currencies, paymentMode,
            maxTxAmount, dailySpendLimit, dailyTxLimit, slippageBps,
            transferDelay, settlementDelay,
            isLive, device
        } = params;

        if (!wallet || !pinPublicKey) {
            throw ApiService.error(400, 'Wallet address and PIN key are required');
        }

        if (!Array.isArray(currencies) || currencies.length === 0) {
            throw ApiService.error(400, 'Select at least one currency');
        }

        const validPaymentModes = ['MerchantTokenOnly', 'AnyAcceptedToken'];
        if (!validPaymentModes.includes(paymentMode)) {
            throw ApiService.error(400, 'Invalid payment mode');
        }

        const validSettlementDelays = ['0', '1800'];
        if (settlementDelay && !validSettlementDelays.includes(settlementDelay)) {
            throw ApiService.error(400, 'Invalid settlement delay');
        }

        const txLimit = Number.isFinite(dailyTxLimit) ? dailyTxLimit : 50;
        const slippage = Number.isFinite(slippageBps) ? slippageBps : 50;
        const xferDelay = Number.isFinite(transferDelay) ? transferDelay : 86400;
        const settleDelay = Number.isFinite(settlementDelay) ? settlementDelay : 1800;

        // ── Persist ─────────────────────────────────────────────────
        const card = await this.Cards.create({
            user_id: userId,
            name: userName || 'ZionDefi Card',
            wallet: wallet,
            wallet_choice: walletChoice || 'existing',
            pin_public_key: pinPublicKey,
            currencies,
            payment_mode: paymentMode,
            settlement_delay: settleDelay,
            max_transaction_amount: maxTxAmount || '0',
            daily_spend_limit: dailySpendLimit || '0',
            daily_transaction_limit: txLimit,
            slippage_tolerance_bps: slippage,
            transfer_delay: xferDelay,
            address: null,
            is_primary: false
        }, {
            ip: device?.ip || 'unknown',
            ua: device?.ua || 'unknown'
        });

        // ── Enqueue deployment ──────────────────────────────────────
        await this._publishDeploy('ziondefi.card.deploy', 'card.deploy', {
            card_id: card.card_id,
            user_id: userId,
            wallet: wallet,
            pin_public_key: pinPublicKey,
            currencies,
            payment_mode: paymentMode,
            settlement_delay: settleDelay,
            max_transaction_amount: maxTxAmount || '0',
            daily_spend_limit: dailySpendLimit || '0',
            daily_transaction_limit: txLimit,
            slippage_tolerance_bps: slippage,
            transfer_delay: xferDelay,
            is_live: isLive !== false
        });

        return { card_id: card.card_id };
    }

    /**
     * REDEPLOY CARD
     * Resets a failed/pending card and re-queues for deployment.
     *
     * @param {Object} params
     * @param {string} params.userId  — Authenticated user ID (ownership check)
     * @param {string} params.cardId  — Card to redeploy
     * @param {boolean} params.isLive — Network flag
     * @returns {{ card_id: string }}
     */
    async redeployCard(params) {
        const { userId, cardId, isLive } = params;

        if (!cardId) {
            throw ApiService.error(400, 'card_id is required');
        }

        const card = await this.Cards.findOne({ card_id: cardId, user_id: userId });

        if (!card) {
            throw ApiService.error(404, 'Card not found');
        }

        const redeployable = ['failed', 'pending_deployment'];
        if (!redeployable.includes(card.status)) {
            throw ApiService.error(400, 'Card is not in a redeployable state');
        }

        await this.Cards.resetToPending(cardId);

        await this._publishDeploy('ziondefi.card.redeploy', 'card.redeploy', {
            card_id: card.card_id,
            user_id: card.user_id,
            wallet: card.wallet,
            pin_public_key: card.pin_public_key,
            currencies: card.currencies,
            payment_mode: card.payment_mode,
            settlement_delay: card.settlement_delay || 1800,
            max_transaction_amount: card.max_transaction_amount,
            daily_spend_limit: card.daily_spend_limit,
            daily_transaction_limit: card.daily_transaction_limit,
            slippage_tolerance_bps: card.slippage_tolerance_bps,
            transfer_delay: card.transfer_delay || 86400,
            is_live: isLive !== false
        });

        return { card_id: cardId };
    }

    // ── Internals ───────────────────────────────────────────────────

    /**
     * Publish deploy job to RabbitMQ.
     * Swallows queue errors — the card is persisted and can be retried.
     */
    async _publishDeploy(queueName, routeKey, payload) {
        try {
            await RabbitService.publish(queueName, routeKey, payload);
        } catch (err) {
            console.error('[ApiService] Queue publish failed:', err.message);
        }
    }

    async getCard(userId, cardId){
        try {
            const card = await this.Cards.retrieveByUserId(userId, cardId);
            if (!card) {
                throw ApiService.error(404, 'Card not found');
            }
            return card;
        } catch (err) {
            throw err;
        }
    }

    /**
     * Create a structured error with HTTP status code.
     */
    static error(code, message) {
        const err = new Error(message);
        err.statusCode = code;
        return err;
    }
}


module.exports = ApiService;