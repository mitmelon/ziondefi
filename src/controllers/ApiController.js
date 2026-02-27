module.exports = {

    token: async (req, reply) => {
        const { client_id, client_secret, grant_type, refresh_token } = req.body;
        const requestIp = req.ip || req.socket.remoteAddress;

        try {
            // CLIENT CREDENTIALS FLOW
            if (grant_type === 'client_credentials') {
                if (!client_id || !client_secret) return reply.code(400).send({ code: 400, error: 'invalid_request' });

                const validation = await req.apiService.validateCredentials(client_id, client_secret, requestIp);
                
                if (!validation.status) {
                    // Security: Add 500ms delay to thwart timing attacks
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return reply.code(401).send({ code: 401, error: validation.error });
                }

                const tokens = await req.apiService.generateTokens(validation.client);
                return reply.code(200).send({code: 200, data: tokens});
            }

            // 2. REFRESH TOKEN FLOW
            if (grant_type === 'refresh_token') {
                if (!refresh_token) return reply.code(400).send({ code: 400, error: 'missing_refresh_token' });
                
                const tokens = await req.apiService.refreshAccessToken(refresh_token, requestIp);
                
                if (!tokens.status) {
                    return reply.code(401).send({ code: 401, error: tokens.error });
                }
                
                return reply.code(200).send({code: 200, data: tokens});
            }

            return reply.code(400).send({ code: 400, error: 'unsupported_grant_type' });
        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ code: 500, error: 'server_error' });
        }
    },

    getStats: async (req, reply) => {
        try {
            const stats = await req.apiService.getStats(req.user.id);
            return reply.code(200).send({code: 200, data: stats});

        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ code: 500, error: 'server_error' });
        }
    },

    getRecentCards: async (req, reply) => {
        try {
            let rawLimit = req.query.limit || 10;
            if (req.postFilter) {
                rawLimit = req.postFilter.strip(rawLimit.toString());
            }
            const limit = parseInt(rawLimit);
            const isLive = req.user.is_live;
            const userId = req.user.user_id;

            const cards = await req.apiService.getRecentCards(userId, limit, isLive);

            return reply.send({
                code: 200,
                status: 'success',
                mode: isLive ? 'live' : 'sandbox',
                count: cards.length,
                data: cards
            });

        } catch (err) {
            req.log.error(err);
            return reply.code(500).send({ 
                code: 500, 
                error: 'Internal Server Error', 
                message: 'Failed to retrieve card data' 
            });
        }
    },

    redeploy_card: async (req, reply) => {
        try {
            const result = await req.apiService.redeployCard({
                userId: req.user.user_id,
                cardId: req.body.card_id,
                isLive: req.user.is_live
            });

            return reply.code(200).send({
                code: 200,
                message: 'Card redeployment queued successfully',
                card_id: result.card_id
            });

        } catch (err) {
            const code = err.statusCode || 500;
            req.log.error(err);
            return reply.code(code).send({
                code,
                error: code >= 500 ? 'Internal Server Error' : err.message,
                message: err.message
            });
        }
    }


};