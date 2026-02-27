const ApiController = require('../controllers/ApiController');
const { GetCardsSchema, ApiCreateCardSchema, ApiRedeployCardSchema } = require('../schemas/ApiSchemas');

module.exports = async function (fastify, opts) {
    
    fastify.register(async function (publicApi) {
        publicApi.post('/oauth/token', ApiController.token);
    }, { prefix: '/api' });


    // PROTECTED API ROUTES (The Vault)
    fastify.register(async function (protectedApi) {
        
        protectedApi.get('/stats', ApiController.getStats);
        protectedApi.get('/cards', { schema: GetCardsSchema }, ApiController.getRecentCards);
        protectedApi.post('/cards/redeploy', { schema: ApiRedeployCardSchema }, ApiController.redeploy_card);

    }, { prefix: '/api/v1' });
};