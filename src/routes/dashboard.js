const DashboardController = require('../controllers/DashboardController');
const { DashboardCreateCardSchema, DashboardRedeployCardSchema } = require('../schemas/ApiSchemas');

module.exports = async function (fastify, opts) {
    
    fastify.register(async function (privateRoutes) {
        
        privateRoutes.get('/', DashboardController.index);
        privateRoutes.get('/notifications', DashboardController.notifications);
        privateRoutes.get('/transactions', DashboardController.getTransactions);
        privateRoutes.get('/homeview', DashboardController.homeview);
        privateRoutes.get('/card/:id', DashboardController.getCard);
        privateRoutes.get('/card/:id/bridge/list', DashboardController.getCardBridgeList);
        privateRoutes.get('/card/bridge/:id/status', DashboardController.getBridgeStatus);
      
        
        privateRoutes.post('/live', DashboardController.toggleLive);
        privateRoutes.post('/card/modal', DashboardController.showCardModal);
        privateRoutes.post('/card/create', { schema: DashboardCreateCardSchema }, DashboardController.createCard);
        privateRoutes.post('/card/redeploy', { schema: DashboardRedeployCardSchema }, DashboardController.redeployCard);
        privateRoutes.post('/card/bridge/quote', DashboardController.getBridgeQuote);
        privateRoutes.post('/card/bridge/start', DashboardController.createBridgeDeposit);

    }, { prefix: '/home' }); // <--- THIS IS CRITICAL
};