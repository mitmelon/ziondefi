// SPDX-License-Identifier: MIT
// ZionDefi Protocol v1.0 — Interface Definitions
// All trait interfaces consumed or exposed by the protocol contracts.

use starknet::{ContractAddress, ClassHash};
use super::types::{
    PaymentMode, CardConfig, CardInfo, CardStatus, RateLimitStatus,
    PaymentRequest, RequestStatus, TransactionSummary,
    BalanceSummary, FraudAlert, SettlementInfo, LoginResult,
    OffchainQuote, ProtocolConfig, MerchantReputation, MerchantInfo,
    PendingTransfer,
};

// ============================================================================
// IZionDefiCard — Card Contract Interface
// ============================================================================

#[starknet::interface]
pub trait IZionDefiCard<TContractState> {
    // ---- Card Configuration ------------------------------------------------
    fn add_accepted_currency(ref self: TContractState, token: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn remove_accepted_currency(ref self: TContractState, token: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn update_payment_mode(ref self: TContractState, new_mode: PaymentMode, sig_r: felt252, sig_s: felt252);
    fn set_slippage_tolerance(ref self: TContractState, tolerance_bps: u16, sig_r: felt252, sig_s: felt252);
    fn set_auto_approve_threshold(ref self: TContractState, threshold_usd: u256, sig_r: felt252, sig_s: felt252);
    fn update_spending_limits(ref self: TContractState, max_tx_amount: u256, daily_tx_limit: u16, daily_spend_limit: u256, sig_r: felt252, sig_s: felt252);
    fn set_merchant_spend_limit(ref self: TContractState, merchant: ContractAddress, max_amount_usd: u256, sig_r: felt252, sig_s: felt252);
    fn remove_merchant_spend_limit(ref self: TContractState, merchant: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn set_token_price_feed(ref self: TContractState, token: ContractAddress, pair_id: felt252, sig_r: felt252, sig_s: felt252);
    fn set_transfer_delay(ref self: TContractState, delay_seconds: u64, sig_r: felt252, sig_s: felt252);
    fn set_settlement_delay(ref self: TContractState, delay_seconds: u64, sig_r: felt252, sig_s: felt252);
    fn get_transfer_delay(self: @TContractState) -> u64;
    fn get_settlement_delay(self: @TContractState) -> u64;

    // ---- Owner Management (owner-only + PIN) -------------------------------
    fn change_owner(ref self: TContractState, new_owner: ContractAddress, sig_r: felt252, sig_s: felt252);

    // ---- Relayer Management (admin-only, no PIN) ---------------------------
    fn change_relayer(ref self: TContractState, new_relayer: ContractAddress);
    fn remove_relayer(ref self: TContractState);

    // ---- Payment Requests --------------------------------------------------
    fn submit_payment_request(ref self: TContractState, merchant: ContractAddress, amount: u256, token: ContractAddress, is_recurring: bool, description: ByteArray, metadata: ByteArray) -> u64;
    fn approve_payment_request(ref self: TContractState, request_id: u64, sig_r: felt252, sig_s: felt252);
    fn approve_multiple_requests(ref self: TContractState, request_ids: Span<u64>, sig_r: felt252, sig_s: felt252);
    fn reject_payment_request(ref self: TContractState, request_id: u64, sig_r: felt252, sig_s: felt252);
    fn revoke_payment_approval(ref self: TContractState, request_id: u64, sig_r: felt252, sig_s: felt252);

    // ---- Payment Execution & Settlement ------------------------------------
    fn charge_card(ref self: TContractState, request_id: u64, idempotency_key: felt252, settlement_delay_seconds: u64, quote: Option<OffchainQuote>, slippage_tolerance_bps: u16, deadline: u64);
    fn charge_recurring(ref self: TContractState, request_id: u64, idempotency_key: felt252, settlement_delay_seconds: u64, quote: Option<OffchainQuote>, slippage_tolerance_bps: u16, deadline: u64);
    fn process_settlement(ref self: TContractState, request_id: u64, idempotency_key: felt252);
    fn cancel_settlement(ref self: TContractState, request_id: u64, sig_r: felt252, sig_s: felt252);

    // ---- Funds Management --------------------------------------------------
    fn deposit_funds(ref self: TContractState, token: ContractAddress, amount: u256);
    fn transfer(ref self: TContractState, action: felt252, token: ContractAddress, amount: u256, recipient: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn execute_transfer(ref self: TContractState, transfer_id: u64, sig_r: felt252, sig_s: felt252);
    fn cancel_transfer(ref self: TContractState, transfer_id: u64, sig_r: felt252, sig_s: felt252);
    fn get_pending_transfer(self: @TContractState, transfer_id: u64) -> PendingTransfer;
    fn sync_balances(ref self: TContractState, tokens: Span<ContractAddress>, sig_r: felt252, sig_s: felt252);

    // ---- Swap & Auto-Swap Management (owner/relayer + PIN) -----------------
    fn set_auto_swap(ref self: TContractState, source_token: ContractAddress, target_token: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn remove_auto_swap(ref self: TContractState, source_token: ContractAddress, sig_r: felt252, sig_s: felt252);
    fn swap_tokens(ref self: TContractState, sell_token: ContractAddress, buy_token: ContractAddress, sell_amount: u256, quote: OffchainQuote, slippage_tolerance_bps: u16, sig_r: felt252, sig_s: felt252);
    fn execute_auto_swap(ref self: TContractState, source_token: ContractAddress, amount: u256, quote: OffchainQuote, slippage_tolerance_bps: u16, sig_r: felt252, sig_s: felt252);

    // ---- Merchant Management (on-card, owner-only) -------------------------
    fn add_merchant_to_blacklist(ref self: TContractState, merchant: ContractAddress, reason: ByteArray, sig_r: felt252, sig_s: felt252);
    fn remove_merchant_from_blacklist(ref self: TContractState, merchant: ContractAddress, sig_r: felt252, sig_s: felt252);

    // ---- Card Lifecycle ----------------------------------------------------
    fn freeze_card(ref self: TContractState, sig_r: felt252, sig_s: felt252);
    fn unfreeze_card(ref self: TContractState, sig_r: felt252, sig_s: felt252);
    fn burn_card(ref self: TContractState, sig_r: felt252, sig_s: felt252);

    // ---- PIN Management (owner/relayer) ------------------------------------
    fn rotate_pin(ref self: TContractState, new_public_key: felt252, old_sig_r: felt252, old_sig_s: felt252);
    fn get_pin_public_key(self: @TContractState, user: ContractAddress) -> felt252;
    fn get_pin_nonce(self: @TContractState, user: ContractAddress) -> felt252;

    // ---- Views (no PIN required) -------------------------------------------
    fn get_accepted_currencies(self: @TContractState) -> Span<ContractAddress>;
    fn get_factory_accepted_tokens(self: @TContractState) -> Span<ContractAddress>;
    fn get_payment_mode(self: @TContractState) -> PaymentMode;
    fn is_currency_accepted(self: @TContractState, token: ContractAddress) -> bool;
    fn get_pending_requests(self: @TContractState, offset: u64, limit: u8) -> Span<PaymentRequest>;
    fn get_approved_requests(self: @TContractState, offset: u64, limit: u8) -> Span<PaymentRequest>;
    fn get_request_details(self: @TContractState, request_id: u64) -> PaymentRequest;
    fn get_request_status(self: @TContractState, request_id: u64) -> RequestStatus;
    fn is_merchant_blacklisted(self: @TContractState, merchant: ContractAddress) -> bool;
    fn get_card_info(self: @TContractState) -> CardInfo;
    fn get_card_status(self: @TContractState) -> CardStatus;
    fn get_rate_limit_status(self: @TContractState) -> RateLimitStatus;
    fn get_merchant_spend_limit(self: @TContractState, merchant: ContractAddress) -> u256;
    fn get_auto_approve_threshold(self: @TContractState) -> u256;
    fn get_settlement_info(self: @TContractState, request_id: u64) -> SettlementInfo;
    fn is_idempotency_key_used(self: @TContractState, key: felt252) -> bool;
    fn is_deployment_fee_paid(self: @TContractState) -> bool;
    fn get_deployment_fee_debt(self: @TContractState) -> u256;
    fn get_auto_swap_target(self: @TContractState, source_token: ContractAddress) -> ContractAddress;
    fn is_auto_swap_enabled(self: @TContractState, source_token: ContractAddress) -> bool;
    fn get_all_auto_swap_rules(self: @TContractState) -> Span<(ContractAddress, ContractAddress)>;
    fn get_transactions(self: @TContractState, offset: u64, limit: u8) -> Span<PaymentRequest>;

    // ---- PIN-protected views -----------------------------------------------
    fn get_transaction_summary(ref self: TContractState, sig_r: felt252, sig_s: felt252, start_ts: u64, end_ts: u64, offset: u64, limit: u8) -> TransactionSummary;
    fn get_balance_summary(ref self: TContractState, sig_r: felt252, sig_s: felt252) -> BalanceSummary;
    fn get_fraud_alerts(ref self: TContractState, sig_r: felt252, sig_s: felt252) -> Span<FraudAlert>;

    // ---- dApp Owner Verification / Login -----------------------------------
    fn verify_owner_login(ref self: TContractState, sig_r: felt252, sig_s: felt252) -> LoginResult;
}

// ============================================================================
// IZionDefiFactory — Factory Contract Interface
// ============================================================================

#[starknet::interface]
pub trait IZionDefiFactory<TContractState> {
    // ---- Card Deployment ---------------------------------------------------
    fn create_card(ref self: TContractState, pin_public_key: felt252, accepted_currencies: Span<ContractAddress>, payment_mode: PaymentMode, initial_config: CardConfig) -> ContractAddress;

    // ---- Protocol Configuration (owner-only) -------------------------------
    fn set_deployment_fee(ref self: TContractState, new_fee: u256);
    fn set_transaction_fee_percent(ref self: TContractState, new_percent: u16);
    fn set_transaction_fee_cap(ref self: TContractState, new_cap: u256);
    fn set_user_cashback_percent(ref self: TContractState, new_percent: u8);
    fn set_burn_fee(ref self: TContractState, new_fee: u256);
    fn set_avnu_router(ref self: TContractState, avnu_router: ContractAddress);
    fn set_vault_class_hash(ref self: TContractState, new_class_hash: ClassHash);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);

    // ---- Relayer Management (owner-only) -----------------------------------
    fn update_authorized_relayer(ref self: TContractState, new_relayer: ContractAddress);

    // ---- Token Management (relayer-only) -----------------------------------
    fn add_accepted_token(ref self: TContractState, token: ContractAddress, pair_id: felt252);
    fn remove_accepted_token(ref self: TContractState, token: ContractAddress);

    // ---- Settlement Configuration (relayer-only) ---------------------------
    fn set_global_settlement_delay(ref self: TContractState, delay_seconds: u64);
    fn set_merchant_settlement_delay(ref self: TContractState, merchant: ContractAddress, delay_seconds: u64);
    fn set_merchant_instant_settlement(ref self: TContractState, merchant: ContractAddress, instant: bool);

    // ---- Merchant Registry (relayer-only) ----------------------------------
    fn register_merchant(ref self: TContractState, merchant: ContractAddress, payout_wallet: ContractAddress, business_name: ByteArray, contact_email: ByteArray, kyc_verified: bool);
    fn remove_merchant(ref self: TContractState, merchant: ContractAddress);
    fn update_merchant_info(ref self: TContractState, merchant: ContractAddress, business_name: ByteArray, contact_email: ByteArray, kyc_verified: bool);
    fn update_merchant_payout_wallet(ref self: TContractState, merchant: ContractAddress, new_payout_wallet: ContractAddress);
    fn activate_merchant(ref self: TContractState, merchant: ContractAddress);
    fn deactivate_merchant(ref self: TContractState, merchant: ContractAddress);
    fn set_merchant_discount(ref self: TContractState, merchant: ContractAddress, discount_bps: u16);
    fn remove_merchant_discount(ref self: TContractState, merchant: ContractAddress);
    fn globally_blacklist_merchant(ref self: TContractState, merchant: ContractAddress, reason: ByteArray);
    fn globally_unblacklist_merchant(ref self: TContractState, merchant: ContractAddress);
    fn set_merchant_reputation(ref self: TContractState, merchant: ContractAddress, reputation_score: u16);

    // ---- Called by Card contracts -------------------------------------------
    fn update_merchant_reputation(ref self: TContractState, merchant: ContractAddress, user: ContractAddress, amount: u256, is_successful: bool);
    fn increment_merchant_blacklist_count(ref self: TContractState, merchant: ContractAddress);

    // ---- View Functions ----------------------------------------------------
    fn get_protocol_config(self: @TContractState) -> ProtocolConfig;
    fn is_merchant_registered(self: @TContractState, merchant: ContractAddress) -> bool;
    fn is_merchant_active(self: @TContractState, merchant: ContractAddress) -> bool;
    fn is_merchant_globally_blacklisted(self: @TContractState, merchant: ContractAddress) -> bool;
    fn get_merchant_info(self: @TContractState, merchant: ContractAddress) -> MerchantInfo;
    fn get_merchant_payout_wallet(self: @TContractState, merchant: ContractAddress) -> ContractAddress;
    fn get_merchant_discount(self: @TContractState, merchant: ContractAddress) -> u16;
    fn get_merchant_reputation(self: @TContractState, merchant: ContractAddress) -> MerchantReputation;
    fn is_card_deployed(self: @TContractState, card: ContractAddress) -> bool;
    fn get_total_cards_deployed(self: @TContractState) -> u64;
    fn get_vault_class_hash(self: @TContractState) -> ClassHash;
    fn get_total_merchants(self: @TContractState) -> u64;
    fn is_token_accepted(self: @TContractState, token: ContractAddress) -> bool;
    fn get_accepted_tokens(self: @TContractState) -> Span<ContractAddress>;
    fn get_effective_settlement_delay(self: @TContractState, merchant: ContractAddress) -> u64;
    fn is_merchant_instant_settlement(self: @TContractState, merchant: ContractAddress) -> bool;
}
