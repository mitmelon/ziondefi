# Changelog

## [2.0.0] — 2025-01-XX

### Architecture
- Split monolithic `ZionDefiCard.cairo` (2697 lines) into 7 focused modules.
- Added `types.cairo` — all shared structs, enums, and constants.
- Added `interfaces.cairo` — `IZionDefiCard`, `IZionDefiFactory`, `IZorahAVNURouter` trait definitions.
- Added `helpers.cairo` — pure utility functions (array ops, math, leap-year-aware recurring intervals).
- Updated `lib.cairo` to declare all modules.

### Security — PIN System
- **Replaced ZK-proof PIN** with ECDSA signature verification via `PinComponent`.
- All sensitive functions now take `sig_r: felt252, sig_s: felt252` instead of old proof structs.
- Added `PinInternalImpl` with `_register_pin_for()` and `_verify_pin()` for constructor and internal use.
- PIN lockout: 3 failed attempts → 1 hour lockout.

### Settlement System (NEW)
- `charge_card` / `charge_recurring` accept `settlement_delay_seconds` argument.
- Factory configures global settlement delay (default 30 min), per-merchant overrides, and instant settlement flags.
- `process_settlement` — finalises payment after delay elapses.
- `cancel_settlement` — owner/relayer may cancel during delay; funds returned in settlement token (no swap-back).

### Auto-Approve (NEW)
- `auto_approve_threshold_usd` — payment requests under this USD value are auto-approved on submission.

### Anomaly Detection (NEW)
- Tracks `largest_charge_amount`. If a new charge exceeds `largest × 3`, the card auto-freezes and all active payments are cancelled.

### Freeze / Blacklist Behaviour
- `freeze_card` now cancels **all** Pending, Approved, and AwaitingSettlement payments.
- `add_merchant_to_blacklist` cancels all active payments from that merchant (including awaiting settlement), refunding held funds.

### Merchant Spend Limits (NEW)
- `set_merchant_spend_limit` / `remove_merchant_spend_limit` — per-merchant USD caps enforced on submit and charge.
- Limit changes auto-revoke affected payments.

### Global Limit Enforcement
- `update_spending_limits` auto-revokes approved/awaiting payments exceeding the new cap.

### Plugin System (NEW)
- `register_plugin` / `unregister_plugin` / `upgrade_plugin_by_id` / `call_plugin`.
- Plugins execute via `library_call_syscall` with stored `PluginPermissions`.

### Owner / Relayer Roles
- **Owner can do everything relayer can**, plus exclusive operations.
- Added `change_owner`, `change_relayer`, `remove_relayer` (owner-only + PIN).
- **Relayer cannot withdraw funds** — explicit owner-only gate on `withdraw_funds`.

### Token Management
- Moved accepted-token management to factory (`add_accepted_token`, `remove_accepted_token`).
- Cards validate deposits and currency additions against factory's accepted list.
- Added `get_factory_accepted_tokens` view on card.

### Factory Enhancements
- `set_global_settlement_delay`, `set_merchant_settlement_delay`, `set_merchant_instant_settlement`.
- `get_effective_settlement_delay`, `is_merchant_instant_settlement` views.
- Merchant registration restricted to **relayer-only**.
- Reputation system: formula-based scoring (success rate × 700 + volume × 200 + recency × 100 − penalties).

### Removed
- **Credit score system** — removed entirely.
- **Default token** — removed `default_token` and `DefaultTokenOnly` payment mode.
- **Merchant creation on card** — merchants are registered only via factory by the relayer.
- **ZK-proof PIN** — replaced by ECDSA signatures.

### Price Oracle
- Fixed imports for Cairo 2.8+ (`starknet::get_block_timestamp`, `core::starknet::info::get_tx_info`).
- Removed non-existent `MAINNET_BTC()` reference; only `MAINNET_WBTC()` retained.

---

## [1.0.0] — Initial Release

- Monolithic `ZionDefiCard.cairo` with ZK-proof PIN, credit scoring, default token, and inline types.
- `ZionDefiFactory.cairo` with merchant registry and card deployment.
- `pin_component.cairo` with external-only ECDSA verification.
- `Price_Oracle.cairo` with Pragma integration.
