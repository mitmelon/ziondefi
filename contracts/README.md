# ZionDefi Protocol v1.0

ZionDefi is a QR + NFC payment method that deploys per-user smart QR ("cards") via a factory contract on starknet. Each card supports multi-currency deposits, ECDSA PIN-protected operations, merchant payment flows with settlement delays, subscriptions, automatic token swaps via AVNU, anomaly detection, and on-chain fraud alerts.

---

## Table of Contents

- [Architecture](#architecture)
- [Contracts](#contracts)
- [Deployed Addresses](#deployed-addresses)
- [Prerequisites](#prerequisites)
- [Building](#building)
- [Testing](#testing)
- [Deploying to Starknet](#deploying-to-starknet)
  - [1. Declare Contracts](#1-declare-contracts)
  - [2. Deploy the Factory](#2-deploy-the-factory)
  - [3. Configure the Factory](#3-configure-the-factory)
  - [4. Deploy a Card](#4-deploy-a-card-via-factory)
- [Usage Examples (starknet.js)](#usage-examples-starknetjs)
  - [Setup & Connection](#setup--connection)
  - [Deploy a Card](#deploy-a-card)
  - [Configure Card Settings](#configure-card-settings)
  - [Deposit Funds](#deposit-funds)
  - [Get Balance Summary](#get-balance-summary)
  - [Submit a Payment Request](#submit-a-payment-request)
  - [Approve a Payment Request](#approve-a-payment-request)
  - [Charge a Card](#charge-a-card)
  - [Manual Token Swap](#manual-token-swap)
  - [Freeze / Unfreeze Card](#freeze--unfreeze-card)
- [Access Control Summary](#access-control-summary)
- [Key Constants](#key-constants)
- [License](#license)

---

## Architecture

```
┌──────────────────────┐
│  ZionDefiFactory     │  Singleton — deploys cards, manages protocol config,
│  (Ownable, Pausable, │  merchant registry, settlement delays, token whitelist
│   Upgradeable)       │
└──────────┬───────────┘
           │ create_card()
           ▼
┌──────────────────────┐
│  ZionDefiCard        │  Per-user vault — deposits, withdrawals, payments,
│  (PIN Component,     │  auto-swap, settlement, anomaly detection
│   ReentrancyGuard,   │
│   Upgradeable)       │
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  AVNU Router         │  DEX aggregator — multi-route token swaps
└──────────────────────┘
```

**Dependencies:**
- OpenZeppelin Cairo Contracts v3.0.0
- Pragma Oracle (pragma_lib 0.2.0) — token↔USD price feeds
- AVNU Exchange Router — on-chain swap execution

---

## Contracts

| Contract | File | Description |
|---|---|---|
| **ZionDefiFactory** | `src/ZionDefiFactory.cairo` | Singleton factory — deploys cards, protocol config, merchant registry |
| **ZionDefiCard** | `src/ZionDefiCard.cairo` | Per-user smart wallet with payments, swaps, PIN auth |
| **Interfaces** | `src/interfaces.cairo` | All trait definitions (`IZionDefiCard`, `IZionDefiFactory`, `IZorahAVNURouter`) |
| **Types** | `src/types.cairo` | Shared structs, enums, and constants |
| **Helpers** | `src/helpers.cairo` | Utility functions |
| **Price Oracle** | `src/Price_Oracle.cairo` | Pragma Oracle integration for token↔USD conversion |
| **PIN Component** | `src/pin_component.cairo` | Reusable ECDSA PIN verification component |

---

## Deployed Addresses

| Network | Contract | Address |
|---|---|---|
| **Sepolia** | ZionDefiFactory | `TBD` |
| **Sepolia** | ZionDefiCard (class hash) | `TBD` |
| **Mainnet** | ZionDefiFactory | `TBD` |
| **Mainnet** | ZionDefiCard (class hash) | `TBD` |

**Known External Contracts (Sepolia):**

| Contract | Address |
|---|---|
| AVNU Router | `0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f` |
| ETH | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` |
| USDC | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` |
| USDT | `0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8` |

---

## Prerequisites

- [Scarb](https://docs.swmansion.com/scarb/) >= 2.8.0
- [Starkli](https://github.com/xJonathanLEI/starkli) (for CLI deployment)
- [Node.js](https://nodejs.org/) >= 18 (for starknet.js examples)
- A Starknet wallet (Argent or Braavos) with testnet ETH

---

## Building

```bash
cd contracts
scarb build
```

Build artifacts are output to `target/dev/`:
- `ziondefi_ZionDefiFactory.contract_class.json`
- `ziondefi_ZionDefiCard.contract_class.json`

---

## Testing

```bash
cd contracts
scarb test
```

---

## Deploying to Starknet

### 1. Declare Contracts

Declare both contract classes on-chain. You need a funded Starknet account.

```bash
# Set up environment
export STARKNET_RPC=https://free-rpc.nethermind.io/sepolia-juno/v0_7
export STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json
export STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json

# Declare ZionDefiCard (the vault class)
starkli declare target/dev/ziondefi_ZionDefiCard.contract_class.json
# Save the returned class hash as CARD_CLASS_HASH

# Declare ZionDefiFactory
starkli declare target/dev/ziondefi_ZionDefiFactory.contract_class.json
# Save the returned class hash as FACTORY_CLASS_HASH
```

### 2. Deploy the Factory

The factory constructor takes:
- `owner` — protocol admin (your deployer address)
- `vault_class_hash` — declared ZionDefiCard class hash
- `admin_wallet` — address that receives protocol fees

```bash
starkli deploy $FACTORY_CLASS_HASH \
  <OWNER_ADDRESS> \
  <CARD_CLASS_HASH> \
  <ADMIN_WALLET_ADDRESS>
```

### 3. Configure the Factory

After deployment, the owner (or relayer once set) must configure the protocol:

```bash
# Set the authorized relayer
starkli invoke <FACTORY_ADDRESS> update_authorized_relayer <RELAYER_ADDRESS>

# Set the AVNU router address
starkli invoke <FACTORY_ADDRESS> set_avnu_router <AVNU_ROUTER_ADDRESS>

# Add accepted tokens (relayer-only after relayer is set)
# pair_id is the Pragma price feed ID (e.g., 'ETH/USD' as felt252)
starkli invoke <FACTORY_ADDRESS> add_accepted_token <ETH_ADDRESS> <ETH_PAIR_ID>
starkli invoke <FACTORY_ADDRESS> add_accepted_token <USDC_ADDRESS> <USDC_PAIR_ID>

# Register a merchant (relayer-only)
starkli invoke <FACTORY_ADDRESS> register_merchant \
  <MERCHANT_ADDRESS> <PAYOUT_WALLET> \
  str:"My Store" str:"store@example.com" 1

# Activate the merchant
starkli invoke <FACTORY_ADDRESS> activate_merchant <MERCHANT_ADDRESS>
```

### 4. Deploy a Card (via Factory)

Cards are deployed by calling `create_card` on the factory. This is typically done via starknet.js (see examples below) since the call requires structured data (enums, structs).

The card starts in `PendingActivation` status. The deployment fee (default $2) is auto-deducted from the first deposit.

---

## Usage Examples (starknet.js)

All examples use **Starknet Sepolia** and **starknet.js v6**.

### Setup & Connection

```js
import { RpcProvider, Account, Contract, CallData, cairo, uint256, ec } from "starknet";

// Sepolia RPC
const provider = new RpcProvider({
  nodeUrl: "https://free-rpc.nethermind.io/sepolia-juno/v0_7",
});

// Your deployer / user account
const account = new Account(
  provider,
  "0xYOUR_ACCOUNT_ADDRESS",
  "0xYOUR_PRIVATE_KEY"
);

// Contract addresses (replace with actual deployed addresses)
const FACTORY_ADDRESS = "0xFACTORY_ADDRESS";
const CARD_ADDRESS    = "0xYOUR_CARD_ADDRESS";
const ETH_ADDRESS     = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const USDC_ADDRESS    = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

// Load ABIs from on-chain class (or from local build artifacts)
const factoryClass = await provider.getClassAt(FACTORY_ADDRESS);
const factory = new Contract(factoryClass.abi, FACTORY_ADDRESS, account);

// For the card, use the ABI from the declared class or a deployed instance
const cardClass = await provider.getClassAt(CARD_ADDRESS);
const card = new Contract(cardClass.abi, CARD_ADDRESS, account);

// ERC-20 ABI (minimal)
const erc20Abi = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
];

/**
 * 2️⃣ PROVE & EXECUTE
 * Returns the signature (r, s) needed to call a sensitive function.
 */
async function signPin(pin, userAddress) {
    const keys = deriveKeys(pin, userAddress);
    
    // Fetch current nonce from your contract
    const { abi } = await provider.getClassAt(CONTRACT_ADDRESS);
    const contract = new Contract(abi, CONTRACT_ADDRESS, provider);
    
    // Note: We call 'get_pin_nonce' which is exposed by the component
    const currentNonce = await card.call("get_pin_nonce", [userAddress]);

    // Create Message Hash: Hash('VERIFY', nonce)
    // MUST match the Cairo component logic exactly
    const msgHash = hash.computePoseidonHashOnElements([
        num.toBigInt('0x564552494659'), // 'VERIFY' in hex
        currentNonce
    ]);

    const signature = ec.starkCurve.sign(msgHash, privateKey);
    
    return {
        r: signature.r.toString(),
        s: signature.s.toString()
    };
}
```

### Deploy a Card

```js
// Generate ECDSA key pair for PIN
const pinPrivateKey = ec.starkCurve.utils.randomPrivateKey();
const pinPublicKey = ec.starkCurve.getStarkKey(pinPrivateKey);
// Save pinPrivateKey securely — it's needed for all PIN-signed operations

const tx = await factory.invoke("create_card", [
  pinPublicKey,                          // pin_public_key
  [ETH_ADDRESS, USDC_ADDRESS],           // accepted_currencies
  { variant: { AnyAcceptedToken: {} } }, // payment_mode enum
  {                                      // initial_config (CardConfig)
    max_transaction_amount: uint256.bnToUint256(1000_00000000n), // $1000 (8 decimals)
    daily_transaction_limit: 50,
    daily_spend_limit: uint256.bnToUint256(5000_00000000n),      // $5000
    slippage_tolerance_bps: 300,           // 3%
  },
]);

console.log("Card deployment tx:", tx.transaction_hash);
const receipt = await provider.waitForTransaction(tx.transaction_hash);
// Parse CardDeployed event from receipt to get the new card address
console.log("Card deployed:", receipt.events);
```

### Configure Card Settings

```js
const { sigR, sigS } = signPin();

// Add a new accepted currency
await card.invoke("add_accepted_currency", [USDC_ADDRESS, sigR, sigS]);

// Set auto-approve threshold ($50 in 8-decimal USD)
await card.invoke("set_auto_approve_threshold", [
  uint256.bnToUint256(50_00000000n), sigR, sigS,
]);

// Set merchant spend limit ($500 for a specific merchant)
await card.invoke("set_merchant_spend_limit", [
  "0xMERCHANT_ADDRESS",
  uint256.bnToUint256(500_00000000n),
  sigR, sigS,
]);

// Update spending limits
await card.invoke("update_spending_limits", [
  uint256.bnToUint256(2000_00000000n), // max tx amount ($2000)
  100,                                  // daily tx limit
  uint256.bnToUint256(10000_00000000n), // daily spend limit ($10000)
  sigR, sigS,
]);

// Set payment mode to MerchantTokenOnly
await card.invoke("update_payment_mode", [
  { variant: { MerchantTokenOnly: {} } }, sigR, sigS,
]);
```

### Deposit Funds

Before depositing, approve the card contract to spend your tokens:

```js
const ethContract = new Contract(erc20Abi, ETH_ADDRESS, account);
const depositAmount = uint256.bnToUint256(100000000000000000n); // 0.1 ETH

// 1. Approve the card to pull tokens
await ethContract.invoke("approve", [CARD_ADDRESS, depositAmount]);

// 2. Deposit without auto-swap (Option::None for quote)
await card.invoke("deposit_funds", [
  ETH_ADDRESS,                // token
  depositAmount,              // amount
  { variant: { None: {} } },  // quote (Option::None — no swap)
  0,                          // slippage_tolerance_bps (unused when no quote)
]);

console.log("Deposit complete.");
console.log("First deposit auto-pays the deployment fee and activates the card.");
```

### Get Balance Summary

```js
// --- Public views (no PIN required) ---

const cardInfo = await card.call("get_card_info", []);
console.log("Card status:", cardInfo);

const feePaid = await card.call("is_deployment_fee_paid", []);
console.log("Deployment fee paid:", feePaid);

const currencies = await card.call("get_accepted_currencies", []);
console.log("Accepted tokens:", currencies);

const cardStatus = await card.call("get_card_status", []);
console.log("Status:", cardStatus); // Active, Frozen, PendingActivation, Burned

const autoSwapRules = await card.call("get_all_auto_swap_rules", []);
console.log("Auto-swap rules:", autoSwapRules);

// Check specific auto-swap
const isAutoSwap = await card.call("is_auto_swap_enabled", [ETH_ADDRESS]);
console.log("ETH auto-swap enabled:", isAutoSwap);

// --- PIN-protected views ---

const { sigR, sigS } = signPin();

const balanceSummary = await card.invoke("get_balance_summary", [sigR, sigS]);
console.log("Balances:", balanceSummary.balances);

const txSummary = await card.invoke("get_transaction_summary", [
  sigR, sigS,
  0,                                      // start_ts (epoch)
  Math.floor(Date.now() / 1000),          // end_ts (now)
  0,                                      // offset
  50,                                     // limit
]);
console.log("Transactions:", txSummary);
```

### Submit a Payment Request

Payment requests are typically submitted by merchants or the relayer:

```js
// Merchant submits a payment request to the card
const merchantAccount = new Account(provider, "0xMERCHANT", "0xMERCHANT_PK");
const cardAsMerchant = new Contract(cardClass.abi, CARD_ADDRESS, merchantAccount);

const requestTx = await cardAsMerchant.invoke("submit_payment_request", [
  "0xMERCHANT_ADDRESS",                     // merchant
  uint256.bnToUint256(25_000000n),           // amount (25 USDC, 6 decimals)
  USDC_ADDRESS,                              // token
  false,                                     // is_recurring
  "Order #1234 — Widget x2",                // description (ByteArray)
  "",                                        // metadata (ByteArray)
]);

const receipt = await provider.waitForTransaction(requestTx.transaction_hash);
// Parse PaymentRequestCreated event to get request_id
console.log("Payment request submitted:", receipt.events);
```

### Approve a Payment Request

```js
const { sigR, sigS } = signPin();
const requestId = 1; // from PaymentRequestCreated event

// Approve a single request
await card.invoke("approve_payment_request", [requestId, sigR, sigS]);
console.log("Request approved");

// Approve multiple requests at once
await card.invoke("approve_multiple_requests", [
  [1, 2, 3], sigR, sigS,
]);

// Reject a request
await card.invoke("reject_payment_request", [requestId, sigR, sigS]);

// Revoke a previously approved request
await card.invoke("revoke_payment_approval", [requestId, sigR, sigS]);

// Check request status
const status = await card.call("get_request_status", [requestId]);
console.log("Status:", status); // Pending, Approved, Rejected, etc.

// Get full request details
const details = await card.call("get_request_details", [requestId]);
console.log("Request:", details);
```

### Charge a Card

After approval, the merchant or relayer executes the charge:

```js
// Direct charge (no swap needed — card holds the merchant's requested token)
await card.invoke("charge_card", [
  1,                           // request_id
  "0x1234ABCD",               // idempotency_key (unique felt252, prevents double-charge)
  0,                           // settlement_delay_seconds (0 = use factory default)
  { variant: { None: {} } },   // quote (no swap needed)
  0,                           // slippage_tolerance_bps
  Math.floor(Date.now() / 1000) + 3600, // deadline (1 hour from now)
]);
console.log("Card charged (direct). Settlement delay applies.");

// ---

// Charge WITH swap (card holds ETH, merchant wants USDC)
// The relayer fetches an AVNU quote off-chain, then submits:
const avnuQuote = {
  sell_token_address: ETH_ADDRESS,
  buy_token_address: USDC_ADDRESS,
  sell_amount: uint256.bnToUint256(50000000000000000n), // 0.05 ETH
  buy_amount: uint256.bnToUint256(25_000000n),          // ~25 USDC expected
  price_impact: uint256.bnToUint256(0n),
  fee: {
    fee_token: ETH_ADDRESS,
    avnu_fees: uint256.bnToUint256(0n),
    avnu_fees_bps: 0,
    integrator_fees: uint256.bnToUint256(0n),
    integrator_fees_bps: 0,
  },
  routes: [], // populated from AVNU API response
};

await card.invoke("charge_card", [
  2,                                      // request_id
  "0x5678EFAB",                           // idempotency_key
  1800,                                   // settlement_delay_seconds (30 min)
  { variant: { Some: avnuQuote } },       // quote for swap
  300,                                    // slippage_tolerance_bps (3%)
  Math.floor(Date.now() / 1000) + 3600,  // deadline
]);

// Process settlement after delay expires
await card.invoke("process_settlement", [
  2,                 // request_id
  "0xSETTLE_KEY_1",  // idempotency_key (different from charge key)
]);

// Or cancel settlement during delay (owner/relayer only, PIN required)
const { sigR, sigS } = signPin();
await card.invoke("cancel_settlement", [2, sigR, sigS]);
```

### Manual Token Swap

```js
const { sigR, sigS } = signPin();

// Fetch quote from AVNU API, then execute on-chain swap
const swapQuote = {
  sell_token_address: ETH_ADDRESS,
  buy_token_address: USDC_ADDRESS,
  sell_amount: uint256.bnToUint256(100000000000000000n), // 0.1 ETH
  buy_amount: uint256.bnToUint256(50_000000n),           // ~50 USDC
  price_impact: uint256.bnToUint256(0n),
  fee: {
    fee_token: ETH_ADDRESS,
    avnu_fees: uint256.bnToUint256(0n),
    avnu_fees_bps: 0,
    integrator_fees: uint256.bnToUint256(0n),
    integrator_fees_bps: 0,
  },
  routes: [], // from AVNU API
};

await card.invoke("swap_tokens", [
  ETH_ADDRESS,                                    // sell_token
  USDC_ADDRESS,                                   // buy_token
  uint256.bnToUint256(100000000000000000n),        // sell_amount
  swapQuote,                                      // quote
  300,                                            // slippage_tolerance_bps (3%)
  sigR, sigS,
]);
console.log("Swap executed: ETH → USDC");

// Configure auto-swap: automatically convert ETH deposits to USDC
await card.invoke("set_auto_swap", [ETH_ADDRESS, USDC_ADDRESS, sigR, sigS]);
console.log("Auto-swap configured: future ETH deposits will swap to USDC");

// Remove auto-swap rule
await card.invoke("remove_auto_swap", [ETH_ADDRESS, sigR, sigS]);
```

### Freeze / Unfreeze Card

```js
const { sigR, sigS } = signPin();

// Owner OR relayer can freeze (cancels all active payments)
await card.invoke("freeze_card", [sigR, sigS]);
console.log("Card frozen — all Pending, Approved, and AwaitingSettlement payments cancelled");

// Only the OWNER can unfreeze (safety mechanism — relayer cannot unfreeze)
await card.invoke("unfreeze_card", [sigR, sigS]);
console.log("Card unfrozen");

// Burn card permanently (owner-only, pays burn fee, withdraws all balances)
await card.invoke("burn_card", [sigR, sigS]);
console.log("Card burned — all remaining balances sent to owner");
```

---

## Access Control Summary

| Operation | Owner (PIN) | Relayer (no PIN) | Merchant | Admin |
|---|:---:|:---:|:---:|:---:|
| **Card Configuration** (currencies, limits, modes) | ✅ | ✅ | ❌ | ❌ |
| **Change Owner** | ✅ | ❌ | ❌ | ❌ |
| **Change/Remove Relayer** | ❌ | ❌ | ❌ | ✅ |
| **Submit Payment Request** | ✅ | ✅ | ✅ | ❌ |
| **Approve/Reject Payments** | ✅ | ✅ | ❌ | ❌ |
| **Charge Card** | ✅ | ✅ | ✅ | ❌ |
| **Deposit Funds** | anyone | anyone | anyone | anyone |
| **Withdraw Funds** | ✅ | ❌ | ❌ | ❌ |
| **Sync Balances** | ✅ | ✅ | ❌ | ❌ |
| **Swap Tokens / Auto-Swap** | ✅ | ✅ | ❌ | ❌ |
| **Freeze Card** | ✅ | ✅ | ❌ | ❌ |
| **Unfreeze Card** | ✅ | ❌ | ❌ | ❌ |
| **Burn Card** | ✅ | ❌ | ❌ | ❌ |
| **Blacklist Merchant (on-card)** | ✅ | ❌ | ❌ | ❌ |
| **Upgrade Contract** | ❌ | ❌ | ❌ | ✅ |
| **Factory: Protocol Config** | ❌ | ❌ | ❌ | ✅ (owner) |
| **Factory: Token/Merchant Management** | ❌ | ✅ (factory relayer) | ❌ | ❌ |
| **Factory: Settlement Config** | ❌ | ✅ (factory relayer) | ❌ | ❌ |

---

## Key Constants

| Constant | Value | Description |
|---|---|---|
| `MAX_FAILED_ATTEMPTS` | 3 | PIN lockout threshold |
| `LOCKOUT_DURATION` | 3,600s (1 hr) | Lockout after failed PINs |
| `CHARGE_COOLDOWN` | 30s | Min time between charges |
| `MERCHANT_REQUEST_LIMIT` | 10/hr | Max merchant requests per window |
| `APPROVAL_LIMIT` | 20/hr | Max approvals per window |
| `MAX_SLIPPAGE` | 1,000 bps (10%) | Max allowed swap slippage |
| `DEFAULT_SETTLEMENT_DELAY` | 1,800s (30 min) | Default settlement hold |
| `ANOMALY_MULTIPLIER` | 3x | Auto-freeze if charge > 3x largest |
| `RECURRING_INTERVAL` | 2,592,000s (~30 days) | Recurring billing interval |

**Default Protocol Fees (set in Factory constructor):**

| Fee | Default | Format |
|---|---|---|
| Deployment fee | $2.00 | 8-decimal USD (Pragma) |
| Transaction fee | 0.40% | basis points (40 bps) |
| Transaction fee cap | $10.00 | 8-decimal USD (Pragma) |
| User cashback | 10% of fee | percentage |
| Burn fee | $1.00 | 8-decimal USD (Pragma) |

---

## Payment Lifecycle

```
Merchant → submit_payment_request()
              │
              ▼
         [Pending] ──── reject_payment_request() ───→ [Rejected]
              │
   approve_payment_request()
              │
              ▼
        [Approved] ──── revoke_payment_approval() ──→ [Revoked]
              │
      charge_card() / charge_recurring()
              │
              ▼
  [AwaitingSettlement] ── cancel_settlement() ──→ [Cancelled] (funds refunded)
              │
    process_settlement() (after delay)
              │
              ▼
         [Settled] ── merchant paid, fees distributed, cashback credited
```

---

## Security Features

- **ECDSA PIN** — Every sensitive operation requires a Stark-curve signature. PIN public key is registered at card creation.
- **PIN Lockout** — 3 failed attempts → 1 hour lockout.
- **Reentrancy Guard** — OpenZeppelin component on all state-changing functions.
- **Idempotency Keys** — Prevent double-charges and double-settlements.
- **Anomaly Detection** — Charges exceeding 3x the largest historical charge auto-freeze the card.
- **Settlement Delays** — Configurable hold period before merchant receives funds; owner can cancel during delay.
- **Rate Limiting** — Per-merchant request limits, per-card approval limits, charge cooldowns.
- **Deployment Fee as Debt** — Card starts in `PendingActivation`; fee auto-deducted from first deposit. No operations (except deposit) until activated.

---

## License

MIT
