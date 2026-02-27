<div align="center">

# 💳 ZionDefi Protocol v1.0
### **The Push-Only Smart Contract NFC & QR Payment System on Starknet**

[![Cairo](https://img.shields.io/badge/Cairo-2.0+-blue?style=flat-square)](https://www.cairo-lang.org/) [![Starknet](https://img.shields.io/badge/Starknet-Sepolia-purple?style=flat-square)](https://www.starknet.io/) [![AVNU](https://img.shields.io/badge/AVNU-Powered-green?style=flat-square)](https://avnu.fi/) [![Layerswap](https://img.shields.io/badge/Layerswap-Cross--Chain-orange?style=flat-square)](https://layerswap.io/) [![Contracts: MIT](https://img.shields.io/badge/Contracts-MIT-yellow.svg?style=flat-square)](contracts/LICENSE) [![Backend: Commercial](https://img.shields.io/badge/Backend-Commercial%20License-red.svg?style=flat-square)](LICENSE) [![Website](https://img.shields.io/badge/Website-ziondefi.work.gd-blue?style=flat-square&logo=google-chrome)](https://ziondefi.work.gd)

---

🔒 **No Infinite Approvals** · ⚡ **Gasless Experience** · 🔄 **Auto-Swaps via AVNU** · 🌉 **Cross-Chain Funding via Layerswap** · 🛡️ **On-Chain Fraud Prevention** · 📲 **NFC + QR Payments**

**🌐 [Visit Our Website](https://ziondefi.work.gd)** | **📖 [Documentation](#-getting-started)** | **💬 [Report Issues](https://github.com/manomitehq/ziondefi/issues)**

</div>

> ### ⚠️ Security Notice — v1.0 Beta
>
> The core contracts are currently undergoing internal audits on Starknet Sepolia.
>
> Please use **testnet funds only** while interacting with the factory contract.

---

## 🌟 About

ZionDefi is a revolutionary **QR + NFC payment method** that deploys per-user smart wallets ("cards") via a Factory contract on Starknet. By completely eliminating the traditional DeFi "pull" mechanism (infinite approvals) and replacing it with a secure **"push-only" architecture**, ZionDefi allows users to spend crypto securely in the real world — just like tapping a contactless card.

Each smart contract card supports:

- 💰 **Multi-currency deposits** — hold and spend any supported token
- 🌉 **Cross-chain funding via Layerswap** — top up your card directly from Ethereum, Base, Arbitrum, Optimism, and more — no wallet connection to any bridge required
- 🔐 **ECDSA PIN-protected operations** — your device's secure enclave signs every transaction
- 🏪 **Merchant payment flows** — with configurable settlement delays for chargeback protection
- 🔁 **Recurring subscriptions** — on-chain, permissioned recurring payments
- 🔄 **Automatic token swaps via AVNU** — pay in STRK, merchant receives USDC
- 🚨 **Anomaly detection & on-chain fraud alerts** — daily limits, blacklists, and auto-freeze

*Watch ZionDefi in action: Tapping an NFC card to execute a secure, gasless Starknet transaction in a physical store.*

<video src="your-video-url" controls>
Your browser does not support the video tag.
</video>

---

## 📑 Table of Contents

- [🌟 About](#-about)
- [⚠️ The Problem](#️-the-problem)
- [💡 Our Solution](#-our-solution)
- [⚙️ How It Works](#️-how-it-works)
- [🛠️ Tech Stack](#️-tech-stack)
- [📍 Deployed Addresses](#-deployed-addresses)
- [🚀 Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Step 1: Clone and Compile](#-step-1-clone-and-compile-the-contracts)
  - [Step 2: Set Up Deployment Account](#-step-2-set-up-your-deployment-account)
  - [Step 3: Declare Both Contracts](#-step-3-declare-both-contracts)
  - [Step 4: Deploy the Factory](#-step-4-deploy-the-factory)
  - [Step 5: Configure the Factory](#️-step-5-configure-the-factory)
- [💳 Using the Factory to Deploy a Card](#-using-the-factory-to-deploy-a-card)
  - [Deploy a New Card](#deploy-a-new-card-starknetjs)
  - [Fund via Layerswap (Cross-Chain)](#-fund-the-card--cross-chain-via-layerswap)
  - [Deposit Funds (on Starknet)](#deposit-funds-already-on-starknet)
  - [Make a Payment](#make-a-payment)
  - [Card Management](#card-management)
- [📁 Project Structure](#-project-structure)
- [🗺️ Roadmap](#️-roadmap)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ⚠️ The Problem

The current state of crypto payments and DeFi interactions is deeply flawed:

- 🔓 **Infinite Approvals**: Users must give dApps permission to pull unlimited funds from their wallets, leading to catastrophic drains when protocols are exploited.
- ⛽ **Gas Friction**: Expecting retail users to calculate and pay network fees for a cup of coffee is completely unrealistic for mainstream adoption.
- 💱 **Token Fragmentation**: Users hold volatile assets (ETH, STRK) but merchants want stablecoins (USDC). Bridging this gap manually creates friction.
- 🌉 **Dangerous Bridging**: Moving funds across chains traditionally requires connecting your wallet to third-party bridge UIs — exposing you to phishing, malicious approvals, and smart contract exploits.
- 🛑 **No Fraud Protection**: If a payment mistake is made or a merchant is compromised, the funds are gone forever — there's no recourse.
- 🔑 **Wallet Exposure**: Connecting your main wallet to every merchant is an enormous security risk.

---

## 💡 Our Solution

ZionDefi shifts the paradigm from **"pull" to "push"**:

1. 🏦 **Smart Contract Cards**: You don't connect your main wallet to merchants. You fund an isolated ZionDefi Card (a smart contract) that you control 100%.
2. 🌉 **Wallet-Free Cross-Chain Funding via Layerswap**: Top up your card from any major chain — Ethereum, Base, Arbitrum, Optimism, and more — without ever connecting your wallet to a bridge. You simply provide your card's contract address as the destination. Layerswap handles the transfer directly; your source wallet and your card are the only parties involved. Funds cannot be lost or intercepted in transit.
3. 📤 **Push-Only Payments**: The card mathematically signs transactions via your device's ECDSA enclave (linked to a 6-digit PIN) and pushes the *exact* amount to the merchant — nothing more.
4. 🔄 **Auto-Swaps via AVNU**: Pay in STRK; the contract automatically swaps to USDC via AVNU's optimal routing before it hits the merchant's wallet.
5. 🛡️ **On-Chain Fraud Prevention**: Built-in daily limits, merchant blacklists, and automated freeze triggers fire the moment anomalous behaviour is detected.
6. ⚙️ **Gasless via Relayers**: Starknet's native Account Abstraction enables a relayer to pay gas on behalf of the user, creating a seamless Web2-like experience.

---

## ⚙️ How It Works

```
                          ┌──────────────────────────┐
   ETH / Base / Arbitrum  │  🌉 Layerswap             │
   Optimism / Any Chain ──►  Cross-Chain Bridge        │
   (No wallet connection  │  (Direct to Card Address) │
    to bridge required)   └────────────┬─────────────┘
                                       │
┌─────────────┐                        │ Funds arrive on Starknet
│ 📱 User App │◄─── ECDSA PIN Sig      ▼
│ (NFC / QR)  │          ┌─────────────────────┐
└──────┬──────┘          │ 💳 User Card         │
       │                 │    Contract          │
       ├─► 🏭 ZionDefi   │ (Funded & Isolated)  │
       │   Factory       └──────────┬──────────┘
       │   • Deploys card           │
       │   • Stores registry        ├──► 🔄 AVNU DEX Router
       │                            │    (Optimal Swaps)
       └────────────────────────────┘
                          │   (Gasless via Relayer)
                          ▼
               ┌─────────────────────┐       ┌────────────────────┐
               │ 🚨 Anomaly          │       │ 🏪 Merchant Wallet │
               │  Detection          │──────►│ (Receives USDC)    │
               └─────────────────────┘       └────────────────────┘
```

**The Flow:**
1. **Top up from any chain**: The user provides their ZionDefi card address as the Layerswap destination — no wallet connection to any bridge, no approval risk. Funds are delivered directly to the card contract on Starknet.
2. User taps NFC card or scans QR at a merchant terminal
3. The mobile app prompts for a PIN, which generates an ECDSA signature locally
4. The signature is passed to the user's Card Contract on Starknet
5. The Card Contract verifies the signature, checks daily limits, and checks against the fraud blacklist
6. If all checks pass, AVNU routing swaps the user's STRK to USDC on the fly
7. The exact USDC amount is pushed to the merchant — with a configurable settlement delay for dispute protection

---

## 🛠️ Tech Stack

### ⛓️ Smart Contracts & Blockchain
- **Cairo 2.0+**: Core smart contract language for Starknet
- **Starknet**: Layer 2 ZK-Rollup providing fast, cheap transaction execution
- **AVNU**: On-chain DEX aggregator for optimal token swap routing
- **Layerswap**: Cross-chain bridging that deposits directly to the card contract address — no bridge wallet connection required, funds are secured end-to-end
- **Account Abstraction**: Native Starknet AA enabling gasless relayer transactions
- **ECDSA**: Elliptic curve signature scheme for secure PIN-based authorization

### 💻 Infrastructure & Testing
- **Scarb** (>= 2.8.0): Cairo package manager and build toolchain
- **Starkli**: CLI tool for declaring and deploying contracts
- **Starknet Foundry** (`snforge`): Cairo contract test runner
- **starknet.js v6**: JavaScript SDK for card deployment and interaction
- **Node.js Relayer**: Gasless transaction relay service (pays gas on users' behalf via Account Abstraction)
- **Pragma Oracle**: On-chain token↔USD price feeds used for fee calculations

---

## 📍 Deployed Addresses

### Starknet Sepolia (Testnet)

| Contract | Address |
|---|---|
| **ZionDefiFactory** | `0x065bc639e04910671f537576971827d516104bc791aaf88b9fd890ce17e6e77c` |
| **ZionDefiCard** (class hash) | `0x5205078675208b9b925e57f05277a5216a9d18444e40d152a483420db9f7550` |

> The Factory is live and accepting card deployments on Sepolia testnet. The ZionDefiCard class hash is the declared blueprint used by the factory to deploy individual user cards — it does not have its own contract address.

### Supported Tokens (Testnet)

| Token | Address |
|---|---|
| **ETH** | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` |
| **STRK** | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| **USDC.e** | `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080` |
| **USDC** | `0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343` |

### Known External Contracts (Sepolia)

| Contract | Address |
|---|---|
| **AVNU Router** | `0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f` |

### Mainnet

| Contract | Address |
|---|---|
| **ZionDefiFactory** | *Coming soon — pending audit completion* |
| **ZionDefiCard** (class hash) | *Coming soon* |

### Prerequisites

Before deploying the protocol, ensure you have the following installed:

- **Scarb** (>= 2.8.0): [Install Scarb](https://docs.swmansion.com/scarb/)
- **Starkli**: [Install Starkli](https://github.com/xJonathanLEI/starkli) — used for declaring and deploying contracts
- **Node.js** (>= 18): [Download](https://nodejs.org/) — required for starknet.js interaction examples
- **Git**: For cloning the repository
- **Starknet Wallet** (ArgentX or Braavos) with testnet ETH: [Sepolia Faucet](https://starknet-faucet.vercel.app/)

---

### 🏗️ Step 1: Clone and Compile the Contracts

```bash
# Clone the repository
git clone https://github.com/mitmelon/ziondefi.git
cd ziondefi/contracts

# Compile all Cairo contracts
scarb build
```

A successful build will produce the compiled contract artifacts in `target/dev/`:
- `ziondefi_ZionDefiFactory.contract_class.json`
- `ziondefi_ZionDefiCard.contract_class.json`

You can also run the test suite at this point:

```bash
scarb test
```

---

### 🔧 Step 2: Set Up Your Deployment Account

Set up a Starkli deployer account and fund it on Sepolia:

```bash
# Set environment variables for all subsequent starkli commands
export STARKNET_RPC=https://free-rpc.nethermind.io/sepolia-juno/v0_7
export STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json
export STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json
```

> 💡 Fund your deployer account from the [Starknet Sepolia Faucet](https://starknet-faucet.vercel.app/) before proceeding.

---

### 📜 Step 3: Declare Both Contracts

Both the `ZionDefiCard` (the per-user vault) and the `ZionDefiFactory` must be declared on-chain. The Factory needs the Card's class hash to deploy new cards for users.

```bash
# Declare ZionDefiCard first — save the returned class hash
starkli declare target/dev/ziondefi_ZionDefiCard.contract_class.json
# → Save as CARD_CLASS_HASH

# Declare ZionDefiFactory
starkli declare target/dev/ziondefi_ZionDefiFactory.contract_class.json
# → Save as FACTORY_CLASS_HASH
```

**Save both class hashes** — you need them for the next step.

---

### 🏭 Step 4: Deploy the Factory

The Factory constructor takes three arguments: the protocol `owner` (your deployer), the `vault_class_hash` (the declared ZionDefiCard class hash), and the `admin_wallet` that receives protocol fees.

```bash
starkli deploy $FACTORY_CLASS_HASH \
  <OWNER_ADDRESS> \
  <CARD_CLASS_HASH> \
  <ADMIN_WALLET_ADDRESS>
```

**Save the deployed `ZionDefiFactory` address** — this is the protocol entry point for all card deployments.

---

### ⚙️ Step 5: Configure the Factory

After deployment, the owner must configure the protocol before cards can be used. If you are building **on top of the already-deployed testnet factory**, skip to [Using the Factory to Deploy a Card](#-using-the-factory-to-deploy-a-card).

```bash
# Set the authorized relayer (pays gas on behalf of users)
starkli invoke <FACTORY_ADDRESS> update_authorized_relayer <RELAYER_ADDRESS>

# Set the AVNU router address
starkli invoke <FACTORY_ADDRESS> set_avnu_router \
  0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f

# Add accepted tokens — pair_id is the Pragma price feed ID for that token (as felt252)
starkli invoke <FACTORY_ADDRESS> add_accepted_token \
  0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7 <ETH_PAIR_ID>
starkli invoke <FACTORY_ADDRESS> add_accepted_token \
  0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d <STRK_PAIR_ID>
starkli invoke <FACTORY_ADDRESS> add_accepted_token \
  0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343 <USDC_PAIR_ID>

# Register and activate a merchant
starkli invoke <FACTORY_ADDRESS> register_merchant \
  <MERCHANT_ADDRESS> <PAYOUT_WALLET> \
  str:"My Store" str:"store@example.com" 1
starkli invoke <FACTORY_ADDRESS> activate_merchant <MERCHANT_ADDRESS>
```

---

## 💳 Using the Factory to Deploy a Card

Once the factory is configured, cards are deployed and interacted with via **starknet.js** (not raw CLI) since the calls involve structured Cairo types like enums and structs.

> 💡 The factory is already live on Sepolia at `0x065bc639e04910671f537576971827d516104bc791aaf88b9fd890ce17e6e77c`. You can deploy a card directly without running your own factory.

### Deploy a New Card (starknet.js)

```js
import { RpcProvider, Account, Contract, uint256, ec } from "starknet";

const provider = new RpcProvider({
  nodeUrl: "https://free-rpc.nethermind.io/sepolia-juno/v0_7",
});
const account = new Account(provider, "0xYOUR_ADDRESS", "0xYOUR_PRIVATE_KEY");

// Live testnet factory address
const FACTORY_ADDRESS = "0x065bc639e04910671f537576971827d516104bc791aaf88b9fd890ce17e6e77c";

// Supported testnet token addresses
const ETH    = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK   = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const USDC   = "0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343";
const USDCe  = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";

const factoryClass = await provider.getClassAt(FACTORY_ADDRESS);
const factory = new Contract(factoryClass.abi, FACTORY_ADDRESS, account);

// Generate a fresh ECDSA key pair for PIN — store the private key securely
const pinPrivateKey = ec.starkCurve.utils.randomPrivateKey();
const pinPublicKey  = ec.starkCurve.getStarkKey(pinPrivateKey);

const tx = await factory.invoke("create_card", [
  pinPublicKey,                           // pin_public_key
  [ETH, USDC],                            // accepted_currencies
  { variant: { AnyAcceptedToken: {} } },  // payment_mode enum
  {                                       // initial CardConfig
    max_transaction_amount:  uint256.bnToUint256(1000_00000000n), // $1,000
    daily_transaction_limit: 50,
    daily_spend_limit:       uint256.bnToUint256(5000_00000000n), // $5,000
    slippage_tolerance_bps:  300,          // 3%
  },
]);

const receipt = await provider.waitForTransaction(tx.transaction_hash);
// Parse the CardDeployed event from receipt.events to get the new card address
console.log("Card deployed:", receipt.events);
```

> The card starts in `PendingActivation` status. The $2 deployment fee is automatically deducted from the first deposit, which activates the card.

---

### 🌉 Fund the Card — Cross-Chain via Layerswap

One of ZionDefi's most important security features is that **you never need to connect your wallet to a bridge**. Your card's contract address is the Layerswap destination. Funds travel directly from your source chain wallet to your ZionDefi card on Starknet — no third-party approval, no bridge UI risk.

**Why this is secure:**
- Your source wallet signs only a standard token transfer — nothing more
- The card contract address is the direct recipient; there is no intermediary custody
- Layerswap's atomic swap mechanism means funds either arrive in full or the transfer reverts — they cannot be lost in transit
- No infinite approvals, no bridge permissions granted to your main wallet

**How to top up your card from another chain:**

1. Go to [layerswap.io](https://layerswap.io) (or use the in-app Layerswap integration)
2. Select your **source network** (Ethereum, Base, Arbitrum, Optimism, Polygon, zkSync, etc.)
3. Select **Starknet** as the destination network
4. Paste your **ZionDefi card contract address** as the destination
5. Enter the amount and complete the transfer from your source wallet

Your card will be funded on Starknet within minutes, ready to spend via NFC or QR.

> 💡 If you already hold tokens on Starknet, you can deposit directly to the card contract address 
---

### Make a Payment

Payments follow a **submit → approve → charge → settle** lifecycle. Merchants or the relayer submit a request; the card owner approves it with their PIN signature; the relayer executes the charge after the settlement delay.

```js
// 1. Merchant submits a payment request
const merchantAccount = new Account(provider, "0xMERCHANT", "0xMERCHANT_PK");
const cardAsMerchant  = new Contract(cardClass.abi, CARD_ADDRESS, merchantAccount);

const reqTx = await cardAsMerchant.invoke("submit_payment_request", [
  "0xMERCHANT_ADDRESS",
  uint256.bnToUint256(25_000000n),  // 25 USDC (6 decimals)
  "0xUSDC_ADDRESS",
  false,                             // not recurring
  "Order #1234",                     // description
  "",                                // metadata
]);
// Parse PaymentRequestCreated event for the request_id

// 2. Card owner approves (PIN signature required)
const { sigR, sigS } = await signPin(pin, ownerAddress); // see contracts/README for signPin helper
await card.invoke("approve_payment_request", [requestId, sigR, sigS]);

// 3. Relayer charges the card (with optional AVNU swap if card holds a different token)
await card.invoke("charge_card", [
  requestId,
  "0xUNIQUE_IDEMPOTENCY_KEY",         // prevents double-charges
  1800,                                 // 30-min settlement delay
  { variant: { None: {} } },           // no swap needed if card holds USDC
  0,
  Math.floor(Date.now() / 1000) + 3600,
]);

// 4. After delay expires, relayer processes settlement → merchant is paid
await card.invoke("process_settlement", [requestId, "0xSETTLE_KEY"]);
```

---

### Card Management

```js
const { sigR, sigS } = await signPin(pin, ownerAddress);

// Configure auto-swap: ETH deposits → USDC automatically
await card.invoke("set_auto_swap", ["0xETH_ADDRESS", "0xUSDC_ADDRESS", sigR, sigS]);

// Update spending limits
await card.invoke("update_spending_limits", [
  uint256.bnToUint256(2000_00000000n), // max tx $2,000
  100,                                  // max 100 tx/day
  uint256.bnToUint256(10000_00000000n), // daily spend cap $10,000
  sigR, sigS,
]);

// Freeze card (owner or relayer)
await card.invoke("freeze_card", [sigR, sigS]);

// Unfreeze — owner only
await card.invoke("unfreeze_card", [sigR, sigS]);

// Burn card permanently — withdraws all balances to owner
await card.invoke("burn_card", [sigR, sigS]);
```

**Payment Lifecycle:**
```
submit_payment_request() → [Pending]
        ↓ approve_payment_request()
    [Approved] → revoke_payment_approval() → [Revoked]
        ↓ charge_card()
[AwaitingSettlement] → cancel_settlement() → [Cancelled]
        ↓ process_settlement() (after delay)
    [Settled] — merchant paid, fees distributed, cashback credited
```

---

## 📁 Project Structure

```
ziondefi/
├── contracts/                      # Cairo Smart Contracts
│   ├── src/
│   │   ├── ZionDefiFactory.cairo   # Singleton factory — deploys cards, protocol config, merchant registry
│   │   ├── ZionDefiCard.cairo      # Per-user vault — payments, swaps, PIN auth, settlement
│   │   ├── interfaces.cairo        # All trait definitions (IZionDefiCard, IZionDefiFactory)
│   │   ├── types.cairo             # Shared structs, enums, and constants
│   │   ├── helpers.cairo           # Utility functions
│   │   ├── Price_Oracle.cairo      # Pragma Oracle integration for token↔USD conversion
│   │   └── pin_component.cairo     # Reusable ECDSA PIN verification component
│   ├── tests/                      # Starknet Foundry test suite
│   ├── Scarb.toml                  # Cairo package manifest
│   └── README.md                   # Full contract API & starknet.js integration guide
│
├── public/                         # contains public asset
├── src/                            # User dashboard (Fastify.js)
└── README.md                       # This file
```

---

## 🗺️ Roadmap

ZionDefi is being built in phases, moving from a tested protocol foundation to a full physical payments network.

### ✅ Phase 1 — Protocol Foundation (Complete)
- [x] `ZionDefiFactory` and `ZionDefiCard` contracts designed and built in Cairo
- [x] ECDSA PIN component with lockout and nonce protection
- [x] Multi-currency deposit and withdrawal support
- [x] Merchant payment request → approve → charge → settle lifecycle
- [x] Settlement delay with owner-controlled cancellation window
- [x] AVNU DEX aggregator integration for on-card token swaps
- [x] Anomaly detection with auto-freeze on suspicious charges
- [x] Pragma Oracle integration for USD-denominated fee calculations
- [x] Recurring subscription payment support
- [x] Factory deployed and ZionDefiCard class declared on Starknet Sepolia testnet

### 🔄 Phase 2 — Infrastructure & Integrations (In Progress)
- [ ] Mobile app (React Native) — NFC tap-to-pay and QR payment flows
- [ ] Merchant dashboard (Next.js) — submit requests, view settlement status
- [ ] Full starknet.js SDK wrapper for the card and factory APIs
- [ ] Smart contract security audit

### 🔜 Phase 3 — Mainnet Launch
- [ ] Mainnet deployment of `ZionDefiFactory` following audit sign-off
- [ ] Physical NFC card production and provisioning pipeline
- [ ] Merchant onboarding programme — register, verify, and activate merchants on-chain
- [ ] Integration with Starknet's native account abstraction for sponsored transactions
- [ ] STRK and ETH staking rewards for early card holders

### 🔮 Phase 4 — Ecosystem Expansion
- [ ] Multi-chain expansion — factory deployments on additional ZK-Rollup networks
- [ ] ZionDefi SDK for third-party wallet and dApp integrations
- [ ] Card-linked DeFi yield — idle card balances earn yield via integrated protocols
- [ ] Fiat off-ramp partnerships — merchant settlements directly in local currency
- [ ] ZionDefi DAO governance — community control over protocol fee parameters

---

## 🤝 Contributing

We welcome contributions to make Web3 payments a reality for physical retail.

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/your-feature-name`)
3. **Commit** your changes (`git commit -m 'Add your feature'`)
4. **Push** to the branch (`git push origin feature/your-feature-name`)
5. **Open** a Pull Request

### Areas for Contribution

- 🛡️ Additional anomaly detection heuristics
- 🌉 Additional Layerswap source chain integrations in the mobile app
- 📱 Mobile NFC integration improvements
- 🌐 Multi-language documentation
- 🧪 Expanded Foundry test coverage
- 🐛 Bug fixes and gas optimisations

---

## 📄 License

ZionDefi uses a dual-license model:

**`/contracts`** — Licensed under the **MIT License**. The Cairo smart contracts (`ZionDefiFactory`, `ZionDefiCard`, and all supporting Cairo source files) are open-source. See [`contracts/LICENSE`](contracts/LICENSE) for details.

**Backend, relayer, frontend, mobile, and all other components** — Licensed under a **Commercial License**. These components are proprietary. You may not copy, modify, distribute, or use them in production without explicit written permission from the ZionDefi team.

If you are interested in licensing the backend for commercial use, please contact us via [ziondefi.work.gd](https://ziondefi.work.gd).

---

**🌐 Visit [ziondefi.work.gd](https://ziondefi.work.gd) · Redefining digital payments on Starknet. 🚀**
