const WebController = require('../controllers/WebController');

module.exports = async function (fastify, opts) {
    
    // LANGUAGE SWITCHER
    // Example: /lang/fr or /lang/en
    fastify.get('/lang/:locale', async (req, reply) => {
        const locale = req.params.locale;
        const supported = ['en', 'fr', 'es'];

        if (supported.includes(locale)) {
            // Set the cookie that fastify-i18n looks for
            reply.setCookie('lang', locale, { path: '/', maxAge: 31536000 }); // 1 Year
        }

        // Redirect back to where they came from (or Home)
        const referer = req.headers.referer || '/';
        return reply.redirect(referer);
    });
    
};