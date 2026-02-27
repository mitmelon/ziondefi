const fp = require('fastify-plugin');
const jwt = require('jsonwebtoken');

async function authGuard(fastify, options) {
    fastify.decorateRequest('user', null);
    fastify.decorateRequest('isApi', false);

    fastify.addHook('onRequest', async (req, reply) => {
        //Bypass Public Routes & Assets
        if (req.url.startsWith('/public') || req.url.startsWith('/assets')) return;
        //Bypass Token Generation Endpoint (Handled by Controller)
        if (req.url === '/api/oauth/token' && req.method === 'POST') return;

        const { auth, dashboard, apiService, postFilter } = req;
        
        const rawAuthHeader = req.headers['authorization'];
        const cleanAuthHeader = rawAuthHeader ? postFilter.strip(rawAuthHeader) : null;

        const sessionKey = 'ziondefi_session';
        const rawCookie = req.cookies[sessionKey];
        const rawHeaderToken = req.headers['x-session-token'];
        
        // Sanitize Browser Tokens
        const browserToken = postFilter.strip(rawCookie || rawHeaderToken);
        
        let apiToken = null;
        if (cleanAuthHeader && cleanAuthHeader.startsWith('Bearer ')) {
            apiToken = cleanAuthHeader.substring(7);
        }

        let user = null;
        let isLive = true; // Default to Live

        if (apiToken) {
            try {
                // Verify Signature & Expiry
                const decoded = jwt.verify(apiToken, process.env.JWT_SECRET, { 
                    audience: 'api.ziondefi',
                    issuer: process.env.APP_DOMAIN
                });

                // Fetch Client
                const client = await req.models.ApiClient.getByClientId(decoded.cid);
                if (!client || !client.is_active) throw new Error('revoked');

                // Redis Rate Limit (Atomic Check)
                const isAllowed = await apiService.checkRateLimit(client);
                if (!isAllowed) {
                    req.log.warn(`[Rate Limit] Exceeded for Client: ${client.client_id}`);
                    return reply.code(429).send({ code: 429, error: 'rate_limit_exceeded', message: 'Too many requests. Please try again later.' });
                }

                // IP Whitelist (Runtime Check)
                const requestIp = req.ip || req.socket.remoteAddress;
                
                // We re-validate IP here just in case the token was stolen
                if (client.policies && client.policies.allowed_ips && client.policies.allowed_ips.length > 0) {
                     const isIpAllowed = apiService.verifyIp(requestIp, client.policies.allowed_ips);
                     
                     if (!isIpAllowed) {
                         req.log.warn(`[Security] Blocked Stolen Token Usage. IP: ${requestIp}, Client: ${client.client_id}`);
                         return reply.code(403).send({ code: 403, error: 'ip_not_whitelisted', message: 'Access denied from this IP address.' });
                     }
                }
                
                // Fetch Context User
                user = await req.models.User.findOne({ user_id: decoded.uid });
                if (!user) throw new Error('user_not_found');
                
                isLive = decoded.is_live; 
                req.isApi = true;

            } catch (err) {
                // Return 401 for any JWT failure
                return reply.code(401).send({ code: 401, error: 'invalid_token', message: 'Invalid or expired token.' });
            }
        } 
        else if (browserToken) {
            // Fingerprint Device
            const currentDevice = postFilter.getDevice(req);
            
            // Validate Session
            const result = await auth.loggedin(browserToken, currentDevice);

            if (result && result.status) {
                user = result.user;
                isLive = user.is_live;
                req.sessionToken = result.session;

                // Sliding Window: Refresh Cookie
                reply.setCookie(sessionKey, result.session, {
                    path: '/',
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: result.maxAge 
                });
            }
        }

        // FINAL: DATABASE CONTEXT SWITCH & LOCAL SETUP
        if (user) {
            req.user = user;

            // Only switch if User/Client is explicitly in Test Mode
            if (isLive === false) {
                const sandboxDbName = process.env.DB_NAME_SANDBOX;

                if (req.models.Notification) req.models.Notification.useDatabase(sandboxDbName);

                if (req.models.Transactions) req.models.Transactions.useDatabase(sandboxDbName);

                if (req.models.Cards) req.models.Cards.useDatabase(sandboxDbName);

                if (req.models.Bridge) req.models.Bridge.useDatabase(sandboxDbName);

                //Others
               


                req.log.debug(`[Context] Mode: SANDBOX | User: ${user.user_id}`);
            }

            // Fetch Notifications (Browser Users Only)
            if (!req.isApi) {
                // Block browser-session users from protected API routes
                if (req.url.startsWith('/api/v1')) {
                    return reply.code(403).send({
                        code: 403,
                        error: 'forbidden',
                        message: 'API routes require Bearer token authentication'
                    });
                }

                const unreadCount = await dashboard.hasUnread(req.user.user_id);
                req.user.has_notifications = unreadCount;
            }

            // Block API clients from dashboard routes
            if (req.isApi && req.url.startsWith('/home')) {
                return reply.code(403).send({
                    code: 403,
                    error: 'forbidden',
                    message: 'Dashboard routes are not accessible via API tokens'
                });
            }

            // Setup Locals for View Engine
            reply.locals = reply.locals || {};
            reply.locals.user = user;

        } else {
            // Clear invalid session cookie if it existed
            if (browserToken) {
                reply.clearCookie(sessionKey, { path: '/' });
            }

            // API or AJAX Request -> Return JSON 401
            if (req.url.startsWith('/api') || req.isApi || req.headers['content-type'] === 'application/json') {
                return reply.code(401).send({ error: "Unauthorized", message: "Authentication required" });
            }
            
            // Standard Browser Request -> Redirect to Login
            const isProtectedRoute = req.url.startsWith('/home') || req.url.startsWith('/onboarding');
            if (isProtectedRoute) {
                return reply.redirect('/login');
            }
        }
    });
}

module.exports = fp(authGuard);