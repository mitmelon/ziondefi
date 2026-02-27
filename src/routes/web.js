const WebController = require('../controllers/WebController');

module.exports = async function (fastify, opts) {
    
    fastify.get('/', WebController.index);
    fastify.get('/index', WebController.index);

    //Others

    
};