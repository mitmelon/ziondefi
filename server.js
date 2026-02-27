require('dotenv').config(); // Load .env file
const buildApp = require('./src/app');

//REMOVE IN PRODUCTION
const startAllWorkers = require('./src/workers/index');

const logConfig = {
    development: {
        transport: { target: 'pino-pretty' },
        level: 'debug'
    },
    production: {
        level: 'info'
    }
};

const app = buildApp({
    logger: process.env.NODE_ENV === 'production' ? logConfig.production : logConfig.development,
    trustProxy: true
});

const start = async () => {
    try {
        const PORT = process.env.PORT || 3000;
        await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`Server running at http://localhost:${PORT}`);

        // Start RabbitMQ card deploy consumer
        try {
            const mongoClient = app.mongo.client;
            await startAllWorkers(mongoClient);
            console.log('RabbitMQ workers started');
        } catch (rabbitErr) {
            console.warn('RabbitMQ worker  failed to start (cards will deploy on retry):', rabbitErr.message);
        }
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

// Graceful Shutdown (Production Safety)
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    try {
        const RabbitService = require('./src/services/RabbitService');
        await RabbitService.close();
    } catch (e) { /* ignore */ }
    await app.close();
    process.exit(0);
});

start();