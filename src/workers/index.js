const RabbitService = require('../services/RabbitService');
const handleCardDeploy = require('./cardDeployWorker');

async function startAllWorkers(mongoClient) {
    console.log('[Workers] Starting all RabbitMQ consumers...');

    await RabbitService.consume(
        'ziondefi.card.deploy', 
        'card.deploy', 
        // Accept the new parameters and pass them down
        (data, currentAttempt, maxAttempts) => handleCardDeploy(data, mongoClient, currentAttempt, maxAttempts)
    );

    
}

module.exports = startAllWorkers;