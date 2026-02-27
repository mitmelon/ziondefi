/**
 * Layerswap.js
 * Handles all cross-chain bridging interactions via Layerswap API v2.
 * Docs: https://docs.layerswap.io/api-reference/
 */
class Layerswap {
    constructor(apiKey, isTestnet = false) {
        if (!apiKey) {
            throw new Error("Layerswap API key is required");
        }
        
        this.apiKey = apiKey;
        this.isTestnet = isTestnet;
        
        // Layerswap V2 uses the exact same base URL for both environments.
        // The environment is strictly determined by the API Key you provide.
        this.baseUrl = 'https://api.layerswap.io/api/v2';
        
        // Default fallbacks (we will use these if you don't pass one in)
        // If 'starknet_sepolia' is wrong, you can update this default after running getNetworks()
        this.defaultNetwork = this.isTestnet ? 'STARKNET_SEPOLIA' : 'STARKNET_MAINNET';
        
        // Define default headers
        this.headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-LS-APIKEY': this.apiKey
        };
    }

    async _request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: { ...this.headers, ...options.headers }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || `Layerswap API error: ${response.status}`);
            }

            return data.data || data;
        } catch (error) {
            console.error(`[Layerswap] Error fetching ${endpoint}:`, error.message);
            throw error;
        }
    }

    /**
     * UTILITY: Fetch all supported networks for your current API Key.
     * Run this once to see exactly what string Layerswap expects for Starknet!
     */
    async getNetworks() {
        const networks = await this._request('/networks');
        console.log("[Layerswap] Available Networks for this API Key:");
        networks.forEach(n => console.log(` - Name: '${n.name}', Display: '${n.display_name}'`));
        return networks;
    }

    /**
     * STEP 1: Get Routes / Available Networks
     * Returns all networks and tokens users can send from to reach your destination.
     */
    async getSources(destination_network = this.defaultNetwork, destination_token = 'USDC') {
        const query = new URLSearchParams({
            destination_network,
            has_deposit_address: true
        }).toString();

        return await this._request(`/sources?${query}`);
    }

    /**
     * STEP 1.5: Get Quote
     */
    async getQuote(source_network, source_token, destination_network = this.defaultNetwork, destination_token = 'USDC', amount) {
        const query = new URLSearchParams({
            source_network,
            source_token,
            destination_network,
            destination_token,
            amount: amount.toString()
        }).toString();

        return await this._request(`/quote?${query}`);
    }

    /**
     * STEP 2 & 3: Create Swap
     */
    async createSwap({ reference_id, source_network, source_token, destination_network = this.defaultNetwork, destination_token = 'USDC', amount, destination_address, source_address }) {
        const payload = {
            reference_id,
            source_network,
            source_token,
            destination_network,
            destination_token,
            destination_address,
            source_address,
            refund_address: source_address,
            use_deposit_address: true,
            use_new_deposit_address: true,
            amount: parseFloat(amount)
        };

        return await this._request('/swaps', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    /**
     * STEP 4 & 5: Check Status
     */
    async getSwapStatus(swapId) {
        return await this._request(`/swaps/${swapId}`);
    }
}

module.exports = Layerswap;