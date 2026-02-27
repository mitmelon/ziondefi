const opencage = require('opencage-api-client');

class OpenCageUtil {
    /**
     * Initialize with API Key
     * @param {string} apiKey - Your OpenCage API Key from .env
     */
    constructor(apiKey) {
        this.apiKey = apiKey || process.env.OPENCAGE_API_KEY;
        if (!this.apiKey) {
            console.warn("OpenCage API Key is missing!");
        }
    }

    /**
     * Validates and Normalizes an Address
     * @param {string} address - The full address string (e.g., "123 Main St, New York, NY")
     * @param {number} minConfidence - Minimum confidence score (1-10) to consider valid. Default 6.
     * @returns {Promise<Object>} - { isValid: boolean, data: object|null, error: string|null }
     */
    async validateAddress(address, minConfidence = 6) {
        try {
            if (!address || typeof address !== 'string') {
                return { isValid: false, error: "invalid_address_provided" };
            }

            const data = await opencage.geocode({ 
                q: address, 
                key: this.apiKey,
                limit: 1 // We only need the best match
            });

            // Check if we got results (Status 200)
            if (data.status.code === 200 && data.results.length > 0) {
                const place = data.results[0];
                
                // CONFIDENCE CHECK
                // OpenCage returns a confidence score from 1 (vague) to 10 (exact building).
                // We reject anything below our threshold (defaults to 6 - street level).
                if (place.confidence >= minConfidence) {
                    return {
                        isValid: true,
                        formatted: place.formatted, 
                        components: place.components, 
                        geometry: place.geometry, 
                        timezone: place.annotations.timezone,
                        confidence: place.confidence,
                    };
                } else {
                    return { 
                        isValid: false, 
                        error: `address_too_vague (confidence: ${place.confidence})` 
                    };
                }
            }

            return { isValid: false, error: "address_not_found" };

        } catch (error) {
            console.error("OpenCage Error:", error.message);
            // Handle quota limits specifically
            if (error.status && error.status.code === 402) {
                return { isValid: false, error: "address_validation_quota_exceeded" };
            }
            return { isValid: false, error: "unable_to_validate_address" };
        }
    }
}

module.exports = new OpenCageUtil();