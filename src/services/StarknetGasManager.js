/**
 * StarknetGasManager — Gas cost estimation & tracking for Starknet transactions.
 *
 * STRK/USD price is fetched automatically from CoinGecko and cached in
 * Redis for 5 minutes so no manual feed is needed and API rate limits
 * are respected.
 *
 * Provides:
 *   - `estimateWrite(account, call)` — pre-execution fee estimate
 *   - `extractCost(receipt)`         — post-execution actual cost from a receipt
 *   - `getActualCost(txHash)`        — fetch receipt + extract cost by tx hash
 *   - `friToStrk(fri)` / `friToUsd(fri)` — unit conversions
 *   - `getStrkPrice()`               — cached STRK/USD price
 *
 * Usage:
 *   const gas = new StarknetGasManager({ provider });
 *   const cost = await gas.extractCost(receipt);
 *   console.log(cost); // { strk: '0.001234', usd: '0.0006', ... }
 */

const { num } = require('starknet');
const axios = require('axios');
const redis = require('./RedisService');

const FRI_PER_STRK = BigInt(10 ** 18);

// Redis cache key & TTL for STRK price
const STRK_PRICE_KEY = 'strk:price:usd';
const STRK_PRICE_TTL = 300; // 5 minutes

class StarknetGasManager {
    /**
     * @param {object} opts
     * @param {import('starknet').RpcProvider} opts.provider — shared RPC provider
     */
    constructor({ provider } = {}) {
        if (!provider) throw new Error('StarknetGasManager requires a provider');
        this.provider = provider;
        // In-memory fallback so we never block on a cache miss mid-request
        this._priceMemo = 0;
    }

    // ================================================================
    // STRK PRICE (auto-fetched + cached)
    // ================================================================

    /**
     * Get the current STRK/USD price.
     * Checks Redis cache first (5-min TTL), falls back to CoinGecko,
     * and keeps an in-memory fallback if both fail.
     *
     * @returns {Promise<number>}
     */
    async getStrkPrice() {
        // 1. Try Redis cache
        try {
            const cached = await redis.get(STRK_PRICE_KEY);
            if (cached !== null && cached !== undefined) {
                this._priceMemo = Number(cached);
                return this._priceMemo;
            }
        } catch (_) { /* Redis down — continue */ }

        // 2. Fetch from CoinGecko
        try {
            const { data } = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=starknet&vs_currencies=usd',
                { timeout: 5000 },
            );
            const price = data?.starknet?.usd ?? 0;
            if (price > 0) {
                this._priceMemo = price;
                // Cache in Redis — fire-and-forget
                redis.set(STRK_PRICE_KEY, price, STRK_PRICE_TTL).catch(() => {});
            }
            return this._priceMemo;
        } catch (_) {
            // API down — return last known price
            return this._priceMemo;
        }
    }

    // ================================================================
    // UNIT CONVERSIONS
    // ================================================================

    /**
     * Convert FRI (wei) amount to STRK (human-readable string).
     * @param {bigint|string|number} fri
     * @returns {string}
     */
    friToStrk(fri) {
        const amount = BigInt(fri);
        return (Number(amount) / Number(FRI_PER_STRK)).toFixed(8);
    }

    /**
     * Convert FRI amount to USD string.
     * Requires an awaited price — use the async version `friToUsdAsync`
     * or pass a pre-fetched price.
     *
     * @param {bigint|string|number} fri
     * @param {number} strkPriceUsd — pre-fetched price
     * @returns {string}
     */
    friToUsd(fri, strkPriceUsd) {
        const strk = Number(BigInt(fri)) / Number(FRI_PER_STRK);
        return (strk * strkPriceUsd).toFixed(4);
    }

    // ================================================================
    // PRE-EXECUTION: ESTIMATE
    // ================================================================

    /**
     * Estimate the cost of an invoke (write) transaction before executing it.
     *
     * @param {import('starknet').Account} account
     * @param {object|object[]} call — { contractAddress, entrypoint, calldata } or array
     * @returns {Promise<{
     *   estimatedStrk: string,
     *   estimatedUsd:  string,
     *   resourceBounds: object,
     *   gasUnits: { l2: string, l1_data: string },
     *   strkPriceUsd: number
     * }>}
     */
    async estimateWrite(account, call) {
        const [estimate, price] = await Promise.all([
            account.estimateInvokeFee(call),
            this.getStrkPrice(),
        ]);

        return {
            estimatedStrk: this.friToStrk(estimate.suggestedMaxFee),
            estimatedUsd: this.friToUsd(estimate.suggestedMaxFee, price),
            resourceBounds: estimate.resourceBounds,
            gasUnits: {
                l2: estimate.resourceBounds?.l2_gas?.max_amount || '0',
                l1_data: estimate.resourceBounds?.l1_data_gas?.max_amount || '0',
            },
            strkPriceUsd: price,
        };
    }

    // ================================================================
    // POST-EXECUTION: EXTRACT FROM RECEIPT
    // ================================================================

    /**
     * Extract the actual gas cost from a transaction receipt.
     * Fetches the STRK price (cached) for the USD conversion.
     *
     * @param {object} receipt — transaction receipt from waitForTransaction
     * @returns {Promise<{
     *   actualStrk: string,
     *   actualUsd:  string,
     *   actualFri:  string,
     *   strkPriceUsd: number,
     *   executionResources: object|undefined
     * }>}
     */
    async extractCost(receipt) {
        if (!receipt) return { actualStrk: '0', actualUsd: '0.0000', actualFri: '0', strkPriceUsd: 0 };

        const rawFee = receipt.actual_fee?.amount ?? receipt.actual_fee ?? '0';
        const feeBigInt = num.toBigInt(rawFee);
        const price = await this.getStrkPrice();

        return {
            actualStrk: this.friToStrk(feeBigInt),
            actualUsd: this.friToUsd(feeBigInt, price),
            actualFri: feeBigInt.toString(),
            strkPriceUsd: price,
            executionResources: receipt.execution_resources,
        };
    }

    // ================================================================
    // STANDALONE: FETCH + EXTRACT BY TX HASH
    // ================================================================

    /**
     * Fetch a receipt by tx hash and return the actual cost.
     * Useful when you only have the hash (e.g. from a webhook).
     *
     * @param {string} txHash
     * @returns {Promise<{
     *   txHash: string,
     *   status: string,
     *   actualStrk: string,
     *   actualUsd:  string,
     *   actualFri:  string,
     *   strkPriceUsd: number,
     *   executionResources: object|undefined
     * }>}
     */
    async getActualCost(txHash) {
        const receipt = await this.provider.waitForTransaction(txHash);
        const cost = await this.extractCost(receipt);
        return {
            txHash,
            status: receipt.finality_status || receipt.execution_status,
            ...cost,
        };
    }
}

module.exports = StarknetGasManager;
