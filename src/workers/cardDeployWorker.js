const Cards = require('../models/Cards');
const StarknetCardService = require('../services/StarknetCardService');

const handleCardDeploy = async (cardData, mongoClient, currentAttempt, maxAttempts) => {
    console.log(`[Worker] Processing card deploy: ${cardData.card_id} (attempt ${currentAttempt}/${maxAttempts})`);
    
    const cardsModel = new Cards(mongoClient);
    if (cardData.is_live === false) {
        cardsModel.useDatabase(process.env.DB_NAME_SANDBOX);
    }

    try {
        await cardsModel.markDeploying(cardData.card_id);

        const result = await StarknetCardService.deployCard(cardData);

        if (result.success) {
            await cardsModel.confirmDeployment(
                cardData.card_id, 
                result.contract_address, 
                result.transaction_hash, 
                result.gasDetails
            );
            console.log(`[Worker] Card deployed successfully: ${cardData.card_id} → ${result.contract_address}`);
        } else {
            throw new Error(result.error || 'Deployment returned unsuccessful');
        }

    } catch (err) {
        if (currentAttempt >= maxAttempts) {
            console.error(`[Worker] Card deploy permanently failed after ${maxAttempts} attempts: ${cardData.card_id}`);
            try {
                const dbResult = await cardsModel.failDeployment(cardData.card_id, err.message, currentAttempt);
                console.log(`[Worker] Card status updated to failed in DB: ${cardData.card_id}`);
            } catch (updateErr) {
                console.error('[Worker] Failed to update card status to failed:', updateErr.message);

            }
        }
        
        throw err;
    }
};

module.exports = handleCardDeploy;