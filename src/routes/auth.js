const AuthController = require('../controllers/AuthController');
const { loginSchema, registerSchema } = require('../schemas/auth');

module.exports = async function (fastify, opts) {

    //GET REQUESTS
    fastify.get('/login', AuthController.showLogin);
    fastify.get('/register', AuthController.showRegister);
    fastify.get('/logout', AuthController.logout);
    fastify.get('/onboarding', AuthController.showOnboarding);
    fastify.get('/email/verify/:code', AuthController.verifyEmail);

    //POST REQUESTS
    fastify.post('/login', { schema: loginSchema, preHandler: fastify.csrfProtection }, AuthController.login);
    fastify.post('/register', { schema: registerSchema, preHandler: fastify.csrfProtection }, AuthController.register);
    fastify.post('/login/wallet', { preHandler: fastify.csrfProtection }, AuthController.loginWallet);
    fastify.post('/onboarding', AuthController.onboarding);
};