const FileLoader = require('../utils/FileLoader');
const DateHelper = require('../utils/DateHelper');
const Formatter = require('../utils/Format');
const CreditScoreCalculator = require('../utils/CreditScoreCalculator');
const StarknetCardService = require('../services/StarknetCardService');
const EncryptionService = require('../services/EncryptionService');
const Layerswap = require('../utils/Layerswap');
const qrcode = require('qrcode');
const fs = require('fs');

module.exports = {

    index: async (req, reply) => {

        let is_live = (req.user && req.user.is_live === true) ? 'checked' : '';

        return reply.view('home/index.ejs', {
            app_name: process.env.APP_NAME || 'ZionDefi',
            title: req.t('dashboard.title', { app_name: process.env.APP_NAME }),
            root: '/',
            user: req.user,
            is_live: is_live
        });
    },

    notifications: async (req, reply) => {
        const all = await req.dashboard.notification(req.user.user_id, 5);

        const allNotificationsHtml = await req.server.view('home/notification.ejs', {
            t: req.t,
            notifications: all.all
        });

        return reply.send({
            status: 200,
            notifications: allNotificationsHtml
        });
    },

    toggleLive: async (req, reply) => {
        try {
            const { live } = req.body;
            const userId = req.user.user_id;

            const isLive = (live === true || live === 'true');

            await req.models.User.updateOne(
                { user_id: userId },
                { $set: { is_live: isLive } }
            );

            if (req.session) {
                req.session.user.is_live = isLive;
            }

            return reply.send({ 
                status: 200, 
                message: 'Mode updated successfully', 
                is_live: JSON.stringify(req.body)
            });
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ status: 500, error: 'Failed to update mode' });
        }
    },

    stats: async (req, reply) => {
        const all = await req.apiService.getStats(req.user.user_id);
        
        return reply.send({
            status: 200,
            stats: all
        });
    },

    homeview: async (req, reply) => {
        try {
            const userId = req.user.user_id;
            const userName = `${req.user.name}`;
            const isLive = req.user.is_live;

            const calculator = new CreditScoreCalculator(req.models);
    
            // A. PARALLEL FETCHING
            const [cardsData, stats, transactions, credit] = await Promise.all([
                // 1. Cards (Auto-creates default)
                req.apiService.getRecentCards(userId, userName, 5, isLive),
                // 2. Stats
                req.apiService.getStats(userId),
                // 3. Transactions
                req.models.Transactions.list(userId, { limit: 5 }),
                calculator.calculate(userId),
                
            ]);

            // B. PROCESS CARDS (Generate QR Images)
            const cardsWithQr = await Promise.all(cardsData.map(async (card) => {
                const domain = process.env.APP_DOMAIN || 'https://zorahpay.com';
                let payload;

                if (card.status === 'pending_deployment' || card.status === 'deploying' || card.status === 'failed') {
                    // Points to Deployment Page
                    payload = `${domain}/cards/deploy/${card.card_id}`;
                } else {
                    // Points to Payment Link
                    const network = isLive ? 'mainnet' : 'sepolia';
                    const addr = card.address || '0x0000000000000000000000000000000000000000';
                    payload = `${domain}/pay/${network}/${addr}?ref=${card.ref_id || ''}`;
                }
                
                const qrDataUrl = await qrcode.toDataURL(payload, {
                    errorCorrectionLevel: 'H',
                    width: 250,
                    margin: 1,
                    color: {
                        dark: ['pending_deployment', 'deploying', 'failed'].includes(card.status) ? '#64748b' : '#000000',
                        light: '#ffffff'
                    }
                });

                return { ...card, qr_code_img: qrDataUrl };
            }));

            // C. RENDER HTML INTERNALLY
            // We render *only* the card slider loop into a string
            const cardHtml = await req.server.view('partials/cards_list.ejs', {
                t: req.t,
                app_name: process.env.APP_NAME || 'ZionDefi',
                cards: cardsWithQr,
                user: req.user
            });

            return reply.send({
                status: 200,
                mode: isLive ? 'live' : 'sandbox',
                cardHtml: cardHtml,
                stats: stats,
                transactions: transactions.data,
                credit: credit
            });

        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ error: 'Failed to load dashboard data' });
        }
    },

    getTransactions: async (req, reply) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;
            const skip = (page - 1) * limit;
            const userId = req.user.user_id;

            // 1. Get Data & Count in Parallel (Efficient)
            const [data, total] = await Promise.all([
                req.models.Transactions.find(
                    { user_id: userId },
                    { sort: { created_at: -1 }, skip: skip, limit: limit }
                ),
                req.models.Transactions.count({ user_id: userId })
            ]);

            // 2. Return JSON
            return reply.send({
                status: 'success',
                data: data,
                meta: {
                    current_page: page,
                    per_page: limit,
                    total_results: total,
                    total_pages: Math.ceil(total / limit)
                }
            });

        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({ error: 'Fetch failed' });
        }
    },

    showCardModal: async (req, reply) => {
        try {
            const userId = req.user.user_id;
            const isLive = req.user.is_live;
            const cardAction = req.postFilter.strip(req.body.action); // 'create', 'deploy', 'manage', 'unfreeze'
            const cardId = req.postFilter.strip(req.body.card_id); // may be 'none' for create
            const datehelper = new DateHelper();

            if (cardAction === 'create' || cardAction === 'deploy') {
                // Just return the Create Modal
                const csrfToken = await reply.generateCsrf();
                const modalHtml = await req.server.view('modal/create_card.ejs', {
                    t: req.t,
                    user: req.user,
                    root: '/',
                    csrfToken
                });
                return reply.send({ status: 200, modalHtml: modalHtml, modalId: 'createCardModal' });
            }

            if (cardAction === 'manage' || cardAction === 'unfreeze') {
                // Just return the Manage/Unfreeze Modal
                const result = await req.apiService.getCard(userId, cardId);

                const cardService = await StarknetCardService.create({
                    cardAddress: result.address,
                    isLive: isLive
                });
                
                const balanceData = await cardService.getFormattedCardBalances();

                const cardStats = await cardService.getComprehensiveStats();

                const ls = new Layerswap(process.env.LAYERSWAP_API_KEY, isLive); 
                const destNetwork = isLive ? 'STARKNET_MAINNET' : 'STARKNET_SEPOLIA';
                
                let bridgeNetworks = [];
                try {
                    bridgeNetworks = await ls.getSources(destNetwork); 
                } catch(e) {
                    req.log.warn("Layerswap sources fetch failed:", e.message);
                }

                const networks = await ls.getSources('STARKNET_SEPOLIA', 'STRK');
                if(!result){
                    return reply.code(404).send({
                        status: 404,
                        error: req.t('card.card_not_found') || 'Card not found'
                    });
                }

                 const qrDataUrl = await qrcode.toDataURL(result.address, {
                    errorCorrectionLevel: 'H',
                    width: 250,
                    margin: 1,
                    color: {
                        dark: ['pending_deployment', 'deploying', 'failed'].includes(result.status) ? '#64748b' : '#000000',
                        light: '#ffffff'
                    }
                });

                const modalHtml = await req.server.view('partials/manage_card.ejs', {
                    t: req.t,
                    user: req.user,
                    cardData: result,
                    qrDataUrl: qrDataUrl,
                    total_balance: Formatter.formatMoneyInt(balanceData.totalUsd),
                    total_pending_requests: cardStats.total_pending_requests || 0,
                    total_transactions: cardStats.total_transactions || 0,
                    updated_at: datehelper.formatDateFromTimestamp(result.updated_at, 'MMM D, YYYY h:mm A')
                });
                return reply.send({ status: 200, modalHtml: modalHtml, modalId: 'manageCardModal' });
            }

        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({ error: req.t('error.fetching_modal') });
        }

    },

    createCard: async (req, reply) => {
        try {
            const pf = req.postFilter;

            let currencies;
            try {
                currencies = JSON.parse(req.body.currencies);
                if (!Array.isArray(currencies) || currencies.length === 0) {
                    return reply.code(400).send({ status: 400, error: req.t('card.err_select_currency') || 'Select at least one currency' });
                }
            } catch (e) {
                return reply.code(400).send({ status: 400, error: 'Invalid currencies format' });
            }
            const identity = req.postFilter.getDevice(req);

            const result = await req.apiService.createCard({
                userId: req.user.user_id,
                userName: req.user.name,
                wallet: pf.strip(req.body.owner),
                walletChoice: pf.strip(req.body.wallet_choice),
                pinPublicKey: pf.strip(req.body.pin_public_key),
                currencies,
                paymentMode: pf.strip(req.body.payment_mode),
                maxTxAmount: pf.strip(req.body.max_transaction_amount),
                dailySpendLimit: pf.strip(req.body.daily_spend_limit),
                dailyTxLimit: parseInt(pf.strip(req.body.daily_transaction_limit)) || 50,
                slippageBps: parseInt(pf.strip(req.body.slippage_tolerance_bps)) || 50,
                transferDelay: req.body.transfer_delay !== undefined ? parseInt(pf.strip(req.body.transfer_delay)) : 86400,
                settlementDelay: pf.strip(req.body.settlement_delay),
                isLive: req.user.is_live !== false,
                device: identity
            });

            const cardHtml = await req.server.view('partials/card_creation_loader.ejs', {
                t: req.t,
                user: req.user,
            });
            return reply.send({ status: 200, cardHtml: cardHtml, card_id: result.card_id });

        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: code >= 500 ? (req.t('server_error') || 'Failed to create card') : err.message
            });
        }
    },

    /**
     * REDEPLOY CARD — delegates to CardService
     */
    redeployCard: async (req, reply) => {
        try {
            const result = await req.apiService.redeployCard({
                userId: req.user.user_id,
                cardId: req.postFilter.strip(req.body.card_id),
                isLive: req.user.is_live !== false
            });

            return reply.send({
                status: 200,
                message: req.t('card.card_requeued') || 'Card redeployment queued. It will be ready soon.',
                card_id: result.card_id
            });

        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: code >= 500 ? (req.t('card.failed_redeploy') || 'Failed to redeploy card') : err.message
            });
        }
    },

    getCard: async (req, reply) => {
        try {
            const pf = req.postFilter;
            const { id } = req.params;
            const cardId = pf.strip(id);

            const result = await req.apiService.getCard(req.user.user_id, cardId);
            if(!result){
                return reply.code(404).send({
                    status: 404,
                    error: req.t('card.card_not_found') || 'Card not found'
                });
            }
            const explorer =  (req.user.is_live) ? `${process.env.EXPLORER_URL_MAINNET}/contract/${result.address}` : `${process.env.EXPLORER_URL_SEPOLIA}/contract/${result.address}`;
            const network = (req.user.is_live) ? 'mainnet' : 'sepolia';

            const cardData = {
                ...result,
                explorer_url: explorer,
                network: network
            };

            return reply.send({
                status: 200,
                card: cardData
            });
        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: code >= 500 ? (req.t('server_error') || 'Failed to retrieve card details') : err.message
            });
        }
    },

    getCardBridgeList: async (req, reply) => {
        try {
            const pf = req.postFilter;
            const { id } = req.params;
            const cardId = pf.strip(id);
            const isLive = req.user.is_live !== false;
            const result = await req.apiService.getCard(req.user.user_id, cardId);
            if(!result){
                return reply.code(404).send({
                    status: 404,
                    error: req.t('card.card_not_found') || 'Card not found'
                });
            }

            const ls = new Layerswap(process.env.LAYERSWAP_API_KEY, isLive); 
            const destNetwork = isLive ? 'STARKNET_MAINNET' : 'STARKNET_SEPOLIA';
            let bridgeNetworks = [];

            if (isLive) {
                try {
                    bridgeNetworks = await ls.getSources(destNetwork); 
                } catch(e) {
                    req.log.warn("Layerswap sources fetch failed:", e.message);
                }
            } else {
                //Only ethereum_sepolia supported in testnet. So load that only and make sure if token is usdcs only reject that as its not supported in sepolia. 
                try {
                    const networks = await ls.getSources(destNetwork);
                    bridgeNetworks = networks.filter(n => n.name === 'ETHEREUM_SEPOLIA');
                } catch(e) {
                    req.log.warn("Layerswap sources fetch failed:", e.message);
                }
            }

            const formattedSources = [];
            bridgeNetworks.forEach(network => {
                if (network.tokens && Array.isArray(network.tokens)) {
                    network.tokens.forEach(token => {
                        if(!isLive && token.symbol === 'USDCS') {
                            return;
                        }
                        formattedSources.push({
                            network_name: network.name,
                            network_display_name: network.display_name,
                            asset: token.symbol,
                            logo: network.logo,
                            asset_logo: token.logo,
                            min_amount: token.min_amount || "0.01", 
                        });
                    });
                }
            });
            return reply.send({ status: 200, sources: formattedSources });
        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: code >= 500 ? (req.t('server_error') || 'Failed to retrieve bridge sources') : err.message
            });
        }
    },

    getBridgeQuote: async (req, reply) => {
        try {
            const pf = req.postFilter;
            const { card_id, source_network, source_token, amount } = req.body;

            const cardId = pf.strip(card_id);
            const result = await req.apiService.getCard(req.user.user_id, cardId);
            if(!result){
                return reply.code(404).send({
                    status: 404,
                    error: req.t('card.card_not_found') || 'Card not found'
                });
            }
            const isLive = req.user.is_live !== false;
            const ls = new Layerswap(process.env.LAYERSWAP_API_KEY, isLive);

            const sourceNetwork = pf.strip(source_network);
            const sourceToken = pf.strip(source_token);
            const parsedAmount = parseFloat(pf.strip(amount));

            if (!sourceNetwork || !sourceToken || !parsedAmount || parsedAmount <= 0) {
                return reply.code(400).send({ status: 400, error: 'Missing required parameters' });
            }

            const destNetwork = isLive ? 'STARKNET_MAINNET' : 'STARKNET_SEPOLIA';

            const quote = await ls.getQuote(sourceNetwork, sourceToken, destNetwork, sourceToken, parsedAmount);
            return reply.send({ status: 200, quote });
        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: err.message
            });
        }
    },

    createBridgeDeposit: async (req, reply) => {

        const pf = req.postFilter;
        const { card_id, source_network, source_token, amount, source_address } = req.body;

        try{
            const cardId = pf.strip(card_id);
            const result = await req.apiService.getCard(req.user.user_id, cardId);
            if(!result){
                return reply.code(404).send({
                    status: 404,
                    error: req.t('card.card_not_found') || 'Card not found'
                });
            }

            let sourceNetwork = pf.strip(source_network);
            let sourceToken = pf.strip(source_token);
            let sourceAddress = pf.strip(source_address);
            const parsedAmount = parseFloat(pf.strip(amount));

            if (!sourceNetwork || !sourceToken || !parsedAmount || parsedAmount <= 0 || !sourceAddress) {
                return reply.code(400).send({ status: 400, error: 'Missing required parameters' });
            }

            const isLive = req.user.is_live !== false;
            const ls = new Layerswap(process.env.LAYERSWAP_API_KEY, isLive);

            const reference_id = (new EncryptionService()).uuid();
            const swapResponse = await ls.createSwap({
                reference_id: reference_id,
                source_network: sourceNetwork,
                source_token: sourceToken,
                destination_network: isLive ? 'STARKNET_MAINNET' : 'STARKNET_SEPOLIA',
                destination_token: sourceToken,
                destination_address: result.address,
                amount: parsedAmount,
                source_address: sourceAddress
            });

            if (!swapResponse || !swapResponse.deposit_actions || swapResponse.deposit_actions.length === 0) {
                return reply.code(500).send({ status: 500, error: 'Failed to create bridge swap' });
            }

            const identity = req.postFilter.getDevice(req);

            const depositAction = swapResponse.deposit_actions[0];
            const renderData = {
                user_id: req.user.user_id,
                card_id: card_id,
                swap_id: swapResponse.swap.id,
                reference_id: reference_id,
                deposit_address: depositAction.to_address,
                deposit_amount: depositAction.amount,
                deposit_token: depositAction.token.symbol,
                network_name: depositAction.network.display_name,
                status: swapResponse.swap.status,
                received_amount: swapResponse.swap.received_amount,
                source_network: sourceNetwork,
                source_token: sourceToken,
                destination_network: isLive ? 'STARKNET_MAINNET' : 'STARKNET_SEPOLIA',
                destination_token: sourceToken,
                destination_address: result.address,
                amount: parsedAmount,
                source_address: sourceAddress,
                device: identity
            };

            await req.models.Bridge.create(renderData);

            const cardHtml = await req.server.view('partials/bridge_create.ejs', {
                t: req.t,
                app_name: process.env.APP_NAME || 'ZionDefi',
                user: req.user,
                amount: renderData.amount + ' ' + renderData.source_token,
                network: renderData.source_network,
                deposit_address: renderData.deposit_address
            });

            return reply.send({ status: 200, message: 'Bridge deposit initiated', bridge: renderData, html: cardHtml });

        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                status: code,
                error: err.message
            });
        }

    },

    getBridgeStatus: async (req, reply) => {
        const pf = req.postFilter;
        const { id } = req.params;
        const swapId = pf.strip(id);
        
        try {
            const bridgeRecord = await req.models.Bridge.retrieve(swapId);
            if(!bridgeRecord){
                return reply.code(404).send({
                    status: 404,
                    error: req.t('card.bridge_not_found') || 'Bridge not found'
                });
            }

            const isLive = req.user.is_live !== false;
            const ls = new Layerswap(process.env.LAYERSWAP_API_KEY, isLive);

            const swapResponse = await ls.getSwapStatus(bridgeRecord.swap_id);
            if (!swapResponse || !swapResponse.swap) {
                return reply.code(500).send({ status: 500, error: 'Failed to fetch bridge status' });
            }

            const updateData = {
                status: swapResponse.swap.status,
                received_amount: swapResponse.swap.received_amount
            }
            
            await req.models.Bridge.updateBridge(bridgeRecord.reference_id, updateData);

            return reply.send({ status: 200, payment: updateData});
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({
                status: 500,
                error: req.t('card.bridge_not_found') || 'Bridge record not found'
            });
        }
    }

}
