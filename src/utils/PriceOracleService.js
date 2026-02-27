/**
 * PriceOracleService.js
 * Fetches and caches live USD prices for supported Starknet tokens.
 * Uses Redis for distributed caching.
 * Automatically uses CoinGecko Pro if an API key is provided, otherwise falls back to Free tier.
 */
const redis = require('../services/RedisService');

class PriceOracleService {
    constructor() {
        // 1. Pull the API key from your environment variables
        this.apiKey = process.env.COINGECKO_API_KEY || null;

        // 2. Dynamically set URL and Redis Cache TTL (in seconds) based on tier
        if (this.apiKey) {
            this.baseUrl = 'https://pro-api.coingecko.com/api/v3';
            this.cacheTtl = 10; // 10 seconds TTL for Pro
            console.log('[PriceOracle] Initialized using CoinGecko PRO (Redis TTL: 10s)');
        } else {
            this.baseUrl = 'https://api.coingecko.com/api/v3';
            this.cacheTtl = 60; // 60 seconds TTL for Free tier safety
            console.log('[PriceOracle] Initialized using CoinGecko FREE (Redis TTL: 60s)');
        }
        
        this.coinGeckoIds = {
            'ETH': 'ethereum',
            'STRK': 'starknet',
            'USDC': 'usd-coin',
            'USDT': 'tether',
            'DAI': 'dai',
            'WBTC': 'wrapped-bitcoin',
            'LORDS': 'lords',
            'WSTETH': 'wrapped-steth'
        };

        this.idToSymbol = Object.entries(this.coinGeckoIds).reduce((acc, [sym, id]) => {
            acc[id] = sym;
            return acc;
        }, {});
    }

    async fetchLivePrices() {
        const redisKey = 'oracle:live_prices';

        try {
            // 1. Check Redis Cache first
            const cachedPrices = await redis.get(redisKey);
            if (cachedPrices) {
                return cachedPrices;
            }

            // 2. Cache miss or expired. Build the API request.
            const ids = Object.values(this.coinGeckoIds).join(',');
            const url = `${this.baseUrl}/simple/price?ids=${ids}&vs_currencies=usd`;

            const headers = {
                'Accept': 'application/json'
            };
            
            if (this.apiKey) {
                headers['x-cg-pro-api-key'] = this.apiKey; 
            }

            // 3. Fetch from CoinGecko
            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`CoinGecko API responded with status ${response.status}`);
            }

            const data = await response.json();
            const newPrices = {};

            // 4. Transform response
            for (const [cgId, priceData] of Object.entries(data)) {
                const symbol = this.idToSymbol[cgId];
                if (symbol && priceData.usd !== undefined) {
                    newPrices[symbol] = priceData.usd;
                }
            }

            // Fallback safety for stablecoins
            if (!newPrices['USDC']) newPrices['USDC'] = 1.00;
            if (!newPrices['USDT']) newPrices['USDT'] = 1.00;
            if (!newPrices['DAI']) newPrices['DAI'] = 1.00;

            // 5. Save to Redis
            await redis.set(redisKey, newPrices, this.cacheTtl);

            return newPrices;

        } catch (error) {
            console.error('[PriceOracle] Error fetching prices:', error.message);
            
            // If the API fails and Redis is empty, return safe defaults to prevent app crashes
            return {
                ETH: 0, STRK: 0, USDC: 1, USDT: 1, DAI: 1, WBTC: 0, LORDS: 0, WSTETH: 0
            };
        }
    }
}

// Export as singleton
const priceOracle = new PriceOracleService();
module.exports = priceOracle;