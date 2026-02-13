// SPDX-License-Identifier: MIT
// ZionDefi Protocol v1.0 — Card (Vault) Contract
// Smart wallet with ECDSA PIN verification, multi-currency support,
// settlement delays, and anomaly detection.

#[starknet::contract]
mod ZionDefiCard {
    use core::num::traits::Zero;
    use starknet::{
        ContractAddress, ClassHash,
        get_caller_address, get_block_timestamp, get_contract_address,
    };
    use starknet::storage::{
        Map, StoragePointerReadAccess, StoragePointerWriteAccess,
        StoragePathEntry,
    };

    use openzeppelin_security::reentrancyguard::ReentrancyGuardComponent;
    use openzeppelin_upgrades::UpgradeableComponent;
    use openzeppelin_upgrades::interface::IUpgradeable;
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

    use ziondefi::types::{
        CardStatus, PaymentMode, RequestStatus, PaymentRequest, SettlementInfo,
        TransactionRecord, FraudAlert, TokenBalance, BalanceSummary,
        TransactionSummary, RateLimitStatus, CardInfo, CardConfig,
        OffchainQuote, Route,
        CHARGE_COOLDOWN,
        MERCHANT_REQUEST_LIMIT, APPROVAL_LIMIT,
        RATE_LIMIT_WINDOW, MAX_SLIPPAGE, BASIS_POINTS, SECONDS_PER_DAY,
        ANOMALY_MULTIPLIER,
    };
    use ziondefi::interfaces::{
        IZionDefiFactoryDispatcher, IZionDefiFactoryDispatcherTrait,
        IZorahAVNURouterDispatcher, IZorahAVNURouterDispatcherTrait,
    };
    use ziondefi::helpers;
    use ziondefi::Price_Oracle;
    use ziondefi::pin_component::PinComponent;

    component!(path: ReentrancyGuardComponent, storage: reentrancy, event: ReentrancyEvent);
    component!(path: UpgradeableComponent, storage: upgradeable, event: UpgradeableEvent);
    component!(path: PinComponent, storage: pin, event: PinEvent);

    impl ReentrancyInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;
    impl UpgradeableInternalImpl = UpgradeableComponent::InternalImpl<ContractState>;
    impl PinInternalImpl = PinComponent::PinInternalImpl<ContractState>;
    impl PinImpl = PinComponent::PinImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        reentrancy: ReentrancyGuardComponent::Storage,
        #[substorage(v0)]
        upgradeable: UpgradeableComponent::Storage,
        #[substorage(v0)]
        pin: PinComponent::Storage,
        owner: ContractAddress,
        admin: ContractAddress,
        authorized_relayer: ContractAddress,
        factory: ContractAddress,
        status: CardStatus,
        created_at: u64,
        failed_pin_attempts: u8,
        lockout_until: u64,
        accepted_currencies: Map<u32, ContractAddress>,
        currency_count: u32,
        is_currency_accepted: Map<ContractAddress, bool>,
        payment_mode: PaymentMode,
        slippage_tolerance_bps: u16,
        token_balances: Map<ContractAddress, u256>,
        last_balance_sync: Map<ContractAddress, u64>,
        token_price_feed_ids: Map<ContractAddress, felt252>,
        max_transaction_amount: u256,
        daily_transaction_limit: u16,
        daily_spend_limit: u256,
        daily_transaction_count: u16,
        daily_spend_amount: u256,
        last_daily_reset: u64,
        auto_approve_threshold_usd: u256,
        merchant_spend_limit: Map<ContractAddress, u256>,
        request_counter: u64,
        payment_requests: Map<u64, PaymentRequest>,
        request_status: Map<u64, RequestStatus>,
        request_to_transaction_id: Map<u64, u64>,
        settlements: Map<u64, SettlementInfo>,
        merchant_blacklist: Map<ContractAddress, bool>,
        merchant_blacklist_reason: Map<ContractAddress, ByteArray>,
        merchant_interactions: Map<ContractAddress, bool>,
        merchant_request_count: Map<ContractAddress, u8>,
        merchant_last_request_reset: Map<ContractAddress, u64>,
        approval_count: u8,
        approval_last_reset: u64,
        last_charge_timestamp: u64,
        transaction_counter: u64,
        transactions: Map<u64, TransactionRecord>,
        fraud_alerts: Map<u64, FraudAlert>,
        fraud_alert_count: u64,
        largest_charge_amount: u256,
        idempotency_keys: Map<felt252, bool>,
        deployment_fee_usd: u256,
        deployment_fee_paid: bool,
        autoswap_target: Map<ContractAddress, ContractAddress>,
        autoswap_enabled: Map<ContractAddress, bool>,
        autoswap_rule_count: u32,
        autoswap_sources: Map<u32, ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat] ReentrancyEvent: ReentrancyGuardComponent::Event,
        #[flat] UpgradeableEvent: UpgradeableComponent::Event,
        #[flat] PinEvent: PinComponent::Event,
        CardInitialized: CardInitialized,
        CardFrozen: CardFrozen,
        CardUnfrozen: CardUnfrozen,
        CardBurned: CardBurned,
        OwnerChanged: OwnerChanged,
        RelayerChanged: RelayerChanged,
        CurrencyAdded: CurrencyAdded,
        CurrencyRemoved: CurrencyRemoved,
        ConfigUpdated: ConfigUpdated,
        PaymentRequestSubmitted: PaymentRequestSubmitted,
        PaymentAutoApproved: PaymentAutoApproved,
        PaymentRequestApproved: PaymentRequestApproved,
        PaymentRequestRejected: PaymentRequestRejected,
        PaymentApprovalRevoked: PaymentApprovalRevoked,
        CardCharged: CardCharged,
        SettlementProcessed: SettlementProcessed,
        SettlementCancelled: SettlementCancelled,
        SwapExecuted: SwapExecuted,
        FundsDeposited: FundsDeposited,
        FundsWithdrawn: FundsWithdrawn,
        MerchantBlacklisted: MerchantBlacklisted,
        MerchantUnblacklisted: MerchantUnblacklisted,
        LimitsUpdated: LimitsUpdated,
        AnomalyDetected: AnomalyDetected,
        DeploymentFeePaid: DeploymentFeePaid,
        CardActivated: CardActivated,
        AutoSwapConfigured: AutoSwapConfigured,
        AutoSwapRemoved: AutoSwapRemoved,
        ManualSwapExecuted: ManualSwapExecuted,
    }

    #[derive(Drop, starknet::Event)]
    struct CardInitialized { #[key] owner: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CardFrozen { timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CardUnfrozen { timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CardBurned { #[key] owner: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct OwnerChanged { old_owner: ContractAddress, #[key] new_owner: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct RelayerChanged { old_relayer: ContractAddress, #[key] new_relayer: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CurrencyAdded { #[key] token: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CurrencyRemoved { #[key] token: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct ConfigUpdated { key: felt252, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct PaymentRequestSubmitted { #[key] request_id: u64, #[key] merchant: ContractAddress, amount: u256, token: ContractAddress, is_recurring: bool, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct PaymentAutoApproved { #[key] request_id: u64, amount_usd: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct PaymentRequestApproved { #[key] request_id: u64, #[key] merchant: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct PaymentRequestRejected { #[key] request_id: u64, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct PaymentApprovalRevoked { #[key] request_id: u64, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CardCharged { #[key] request_id: u64, #[key] merchant: ContractAddress, amount: u256, token_in: ContractAddress, token_out: ContractAddress, swap_occurred: bool, settle_at: u64, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct SettlementProcessed { #[key] request_id: u64, amount: u256, payout_wallet: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct SettlementCancelled { #[key] request_id: u64, refunded: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct SwapExecuted { token_in: ContractAddress, token_out: ContractAddress, amount_in: u256, amount_out: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct FundsDeposited { #[key] token: ContractAddress, amount: u256, depositor: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct FundsWithdrawn { #[key] token: ContractAddress, amount: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct MerchantBlacklisted { #[key] merchant: ContractAddress, reason: ByteArray, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct MerchantUnblacklisted { #[key] merchant: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct LimitsUpdated { max_tx: u256, daily_tx_limit: u16, daily_spend: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct AnomalyDetected { #[key] request_id: u64, amount_usd: u256, threshold: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct DeploymentFeePaid { token: ContractAddress, amount_in_token: u256, fee_usd: u256, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct CardActivated { #[key] owner: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct AutoSwapConfigured { #[key] source_token: ContractAddress, #[key] target_token: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct AutoSwapRemoved { #[key] source_token: ContractAddress, timestamp: u64 }
    #[derive(Drop, starknet::Event)]
    struct ManualSwapExecuted { token_in: ContractAddress, token_out: ContractAddress, amount_in: u256, amount_out: u256, timestamp: u64 }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        admin: ContractAddress,
        authorized_relayer: ContractAddress,
        pin_public_key: felt252,
        accepted_currencies: Span<ContractAddress>,
        payment_mode: PaymentMode,
        initial_config: CardConfig,
        deployment_fee_usd: u256,
    ) {
        assert(!owner.is_zero(), 'Invalid owner');
        assert(!admin.is_zero(), 'Invalid admin');
        assert(pin_public_key != 0, 'Invalid PIN key');
        assert(accepted_currencies.len() > 0, 'No currencies');

        self.owner.write(owner);
        self.admin.write(admin);
        self.authorized_relayer.write(authorized_relayer);
        self.factory.write(get_caller_address());
        self.deployment_fee_usd.write(deployment_fee_usd);
        self.deployment_fee_paid.write(false);
        self.status.write(CardStatus::PendingActivation);
        let ts = get_block_timestamp();
        self.created_at.write(ts);
        self.pin._register_pin_for(owner, pin_public_key);
        self.payment_mode.write(payment_mode);
        self.slippage_tolerance_bps.write(initial_config.slippage_tolerance_bps);
        let mut i: u32 = 0;
        loop {
            if i >= accepted_currencies.len() { break; }
            let token = *accepted_currencies.at(i);
            assert(!token.is_zero(), 'Invalid currency');
            self.accepted_currencies.entry(i).write(token);
            self.is_currency_accepted.entry(token).write(true);
            i += 1;
        };
        self.currency_count.write(i);
        self.max_transaction_amount.write(initial_config.max_transaction_amount);
        self.daily_transaction_limit.write(initial_config.daily_transaction_limit);
        self.daily_spend_limit.write(initial_config.daily_spend_limit);
        self.last_daily_reset.write(ts);
        self.emit(CardInitialized { owner, timestamp: ts });
    }

    #[abi(embed_v0)]
    impl ZionDefiCardImpl of ziondefi::interfaces::IZionDefiCard<ContractState> {

        // ================================================================
        // A. CARD CONFIGURATION
        // ================================================================

        fn add_accepted_currency(ref self: ContractState, token: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(!token.is_zero(), 'Invalid token');
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_token_accepted(token), 'Token not in factory');
            if !self.is_currency_accepted.entry(token).read() {
                let count = self.currency_count.read();
                self.accepted_currencies.entry(count).write(token);
                self.is_currency_accepted.entry(token).write(true);
                self.currency_count.write(count + 1);
                self.emit(CurrencyAdded { token, timestamp: get_block_timestamp() });
            }
        }

        fn remove_accepted_currency(ref self: ContractState, token: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self.is_currency_accepted.entry(token).write(false);
            self.emit(CurrencyRemoved { token, timestamp: get_block_timestamp() });
        }

        fn update_payment_mode(ref self: ContractState, new_mode: PaymentMode, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self.payment_mode.write(new_mode);
            self.emit(ConfigUpdated { key: 'payment_mode', timestamp: get_block_timestamp() });
        }

        fn set_slippage_tolerance(ref self: ContractState, tolerance_bps: u16, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            assert(tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self.slippage_tolerance_bps.write(tolerance_bps);
            self.emit(ConfigUpdated { key: 'slippage', timestamp: get_block_timestamp() });
        }

        fn set_auto_approve_threshold(ref self: ContractState, threshold_usd: u256, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self.auto_approve_threshold_usd.write(threshold_usd);
            self.emit(ConfigUpdated { key: 'auto_approve', timestamp: get_block_timestamp() });
        }

        fn update_spending_limits(
            ref self: ContractState,
            max_tx_amount: u256,
            daily_tx_limit: u16,
            daily_spend_limit: u256,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self.max_transaction_amount.write(max_tx_amount);
            self.daily_transaction_limit.write(daily_tx_limit);
            self.daily_spend_limit.write(daily_spend_limit);
            self.emit(LimitsUpdated { max_tx: max_tx_amount, daily_tx_limit, daily_spend: daily_spend_limit, timestamp: get_block_timestamp() });
        }

        fn set_merchant_spend_limit(ref self: ContractState, merchant: ContractAddress, max_amount_usd: u256, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_pin(sig_r, sig_s);
            self.merchant_spend_limit.entry(merchant).write(max_amount_usd);
            self.emit(ConfigUpdated { key: 'merchant_limit', timestamp: get_block_timestamp() });
        }

        fn remove_merchant_spend_limit(ref self: ContractState, merchant: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_pin(sig_r, sig_s);
            self.merchant_spend_limit.entry(merchant).write(0);
            self.emit(ConfigUpdated { key: 'merchant_limit', timestamp: get_block_timestamp() });
        }

        fn set_token_price_feed(ref self: ContractState, token: ContractAddress, pair_id: felt252) {
            self._assert_owner_or_relayer();
            self.token_price_feed_ids.entry(token).write(pair_id);
        }

        // ================================================================
        // B. OWNER & RELAYER MANAGEMENT
        // ================================================================

        fn change_owner(ref self: ContractState, new_owner: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_pin(sig_r, sig_s);
            assert(!new_owner.is_zero(), 'Invalid owner');
            let old = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnerChanged { old_owner: old, new_owner, timestamp: get_block_timestamp() });
        }

        fn change_relayer(ref self: ContractState, new_relayer: ContractAddress) {
            self._assert_admin();
            assert(!new_relayer.is_zero(), 'Invalid relayer');
            let old = self.authorized_relayer.read();
            self.authorized_relayer.write(new_relayer);
            self.emit(RelayerChanged { old_relayer: old, new_relayer, timestamp: get_block_timestamp() });
        }

        fn remove_relayer(ref self: ContractState) {
            self._assert_admin();
            let old = self.authorized_relayer.read();
            self.authorized_relayer.write(Zero::zero());
            self.emit(RelayerChanged { old_relayer: old, new_relayer: Zero::zero(), timestamp: get_block_timestamp() });
        }

        // ================================================================
        // C. PAYMENT REQUESTS
        // ================================================================

        fn submit_payment_request(
            ref self: ContractState,
            merchant: ContractAddress,
            amount: u256,
            token: ContractAddress,
            is_recurring: bool,
            description: ByteArray,
            metadata: ByteArray,
        ) -> u64 {
            self.reentrancy.start();
            self._assert_not_frozen();
            assert(amount > 0, 'Zero amount');
            assert(!merchant.is_zero(), 'Invalid merchant');
            assert(!token.is_zero(), 'Invalid token');
            let ts = get_block_timestamp();

            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_merchant_registered(merchant), 'Merchant not registered');
            assert(factory.is_merchant_active(merchant), 'Merchant not active');
            assert(!factory.is_merchant_globally_blacklisted(merchant), 'Merchant globally blocked');
            assert(!self.merchant_blacklist.entry(merchant).read(), 'Merchant blacklisted');
            self._check_merchant_rate_limit(merchant);
            assert(self.is_currency_accepted.entry(token).read(), 'Currency not accepted');

            let m_limit = self.merchant_spend_limit.entry(merchant).read();
            if m_limit > 0 {
                let manual_id = self.token_price_feed_ids.entry(token).read();
                let amount_usd = Price_Oracle::convert_token_to_usd_auto(token, amount, manual_id);
                if amount_usd > 0 { assert(amount_usd <= m_limit, 'Exceeds merchant limit'); }
            }

            let max_tx = self.max_transaction_amount.read();
            if max_tx > 0 {
                let manual_id = self.token_price_feed_ids.entry(token).read();
                let amount_usd = Price_Oracle::convert_token_to_usd_auto(token, amount, manual_id);
                if amount_usd > 0 { assert(amount_usd <= max_tx, 'Exceeds max tx amount'); }
            }

            assert(self._has_any_balance(), 'No funds');

            let request_id = self.request_counter.read() + 1;
            self.request_counter.write(request_id);

            let threshold = self.auto_approve_threshold_usd.read();
            let mut initial_status = RequestStatus::Pending;
            let mut approved_at: u64 = 0;
            if threshold > 0 {
                let manual_id = self.token_price_feed_ids.entry(token).read();
                let amount_usd = Price_Oracle::convert_token_to_usd_auto(token, amount, manual_id);
                if amount_usd > 0 && amount_usd <= threshold {
                    initial_status = RequestStatus::Approved;
                    approved_at = ts;
                    self.emit(PaymentAutoApproved { request_id, amount_usd, timestamp: ts });
                }
            }

            let request = PaymentRequest {
                request_id, merchant, amount, token, is_recurring,
                status: initial_status,
                description: description.clone(),
                metadata,
                created_at: ts, approved_at, last_charged_at: 0, charge_count: 0,
            };
            self.payment_requests.entry(request_id).write(request);
            self.request_status.entry(request_id).write(initial_status);

            if !self.merchant_interactions.entry(merchant).read() {
                self.merchant_interactions.entry(merchant).write(true);
            }

            self.emit(PaymentRequestSubmitted { request_id, merchant, amount, token, is_recurring, timestamp: ts });
            self.reentrancy.end();
            request_id
        }

        fn approve_payment_request(ref self: ContractState, request_id: u64, sig_r: felt252, sig_s: felt252) {
            self._assert_not_frozen();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            self._check_approval_rate_limit();

            let mut req = self.payment_requests.entry(request_id).read();
            assert(req.request_id != 0, 'Request not found');
            assert(req.status == RequestStatus::Pending, 'Not pending');

            let ts = get_block_timestamp();
            req.status = RequestStatus::Approved;
            req.approved_at = ts;
            let merchant = req.merchant;
            self.payment_requests.entry(request_id).write(req);
            self.request_status.entry(request_id).write(RequestStatus::Approved);
            self.emit(PaymentRequestApproved { request_id, merchant, timestamp: ts });
        }

        fn approve_multiple_requests(ref self: ContractState, request_ids: Span<u64>, sig_r: felt252, sig_s: felt252) {
            self._assert_not_frozen();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(request_ids.len() <= 10, 'Max 10 requests');

            let mut rl: u32 = 0;
            loop {
                if rl >= request_ids.len() { break; }
                self._check_approval_rate_limit();
                rl += 1;
            };

            let ts = get_block_timestamp();
            let mut i: u32 = 0;
            loop {
                if i >= request_ids.len() { break; }
                let rid = *request_ids.at(i);
                let mut req = self.payment_requests.entry(rid).read();
                let merchant = req.merchant;
                let is_bl = self.merchant_blacklist.entry(merchant).read();
                if req.request_id != 0 && req.status == RequestStatus::Pending && !is_bl {
                    req.status = RequestStatus::Approved;
                    req.approved_at = ts;
                    self.payment_requests.entry(rid).write(req);
                    self.request_status.entry(rid).write(RequestStatus::Approved);
                    self.emit(PaymentRequestApproved { request_id: rid, merchant, timestamp: ts });
                }
                i += 1;
            };
        }

        fn reject_payment_request(ref self: ContractState, request_id: u64, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let mut req = self.payment_requests.entry(request_id).read();
            assert(req.request_id != 0, 'Request not found');
            assert(req.status == RequestStatus::Pending, 'Not pending');
            req.status = RequestStatus::Rejected;
            self.payment_requests.entry(request_id).write(req);
            self.request_status.entry(request_id).write(RequestStatus::Rejected);
            self.emit(PaymentRequestRejected { request_id, timestamp: get_block_timestamp() });
        }

        fn revoke_payment_approval(ref self: ContractState, request_id: u64, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let mut req = self.payment_requests.entry(request_id).read();
            assert(req.request_id != 0, 'Request not found');
            assert(req.status == RequestStatus::Approved, 'Not approved');
            req.status = RequestStatus::Revoked;
            self.payment_requests.entry(request_id).write(req);
            self.request_status.entry(request_id).write(RequestStatus::Revoked);
            self.emit(PaymentApprovalRevoked { request_id, timestamp: get_block_timestamp() });
        }

        // ================================================================
        // D. CHARGE & SETTLEMENT
        // ================================================================

        fn charge_card(
            ref self: ContractState,
            request_id: u64,
            idempotency_key: felt252,
            settlement_delay_seconds: u64,
            quote: Option<OffchainQuote>,
            slippage_tolerance_bps: u16,
            deadline: u64,
        ) {
            let mut req = self.payment_requests.entry(request_id).read();
            assert(!req.is_recurring, 'Use charge_recurring');
            self._execute_charge(request_id, idempotency_key, settlement_delay_seconds, quote, slippage_tolerance_bps, deadline, false);
        }

        fn charge_recurring(
            ref self: ContractState,
            request_id: u64,
            idempotency_key: felt252,
            settlement_delay_seconds: u64,
            quote: Option<OffchainQuote>,
            slippage_tolerance_bps: u16,
            deadline: u64,
        ) {
            let req = self.payment_requests.entry(request_id).read();
            assert(req.is_recurring, 'Not recurring');
            if req.last_charged_at > 0 {
                let interval = helpers::calculate_recurring_interval(req.last_charged_at, get_block_timestamp());
                assert(get_block_timestamp() >= req.last_charged_at + interval, 'Too soon');
            }
            self._execute_charge(request_id, idempotency_key, settlement_delay_seconds, quote, slippage_tolerance_bps, deadline, true);
        }

        fn process_settlement(ref self: ContractState, request_id: u64, idempotency_key: felt252) {
            self.reentrancy.start();
            self._assert_not_frozen();

            let mut info = self.settlements.entry(request_id).read();
            assert(info.request_id != 0, 'No settlement');

            let caller = get_caller_address();
            assert(
                caller == self.owner.read()
                || caller == self.authorized_relayer.read()
                || caller == info.merchant,
                'Unauthorized'
            );

            assert(idempotency_key != 0, 'Key required');
            assert(!self.idempotency_keys.entry(idempotency_key).read(), 'Key already used');
            self.idempotency_keys.entry(idempotency_key).write(true);

            assert(!info.settled && !info.cancelled, 'Already finalised');
            assert(get_block_timestamp() >= info.settle_at, 'Delay not elapsed');
            assert(!self.merchant_blacklist.entry(info.merchant).read(), 'Merchant blacklisted');
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_merchant_registered(info.merchant), 'Merchant unregistered');
            assert(!factory.is_merchant_globally_blacklisted(info.merchant), 'Merchant blocked');

            let ts = get_block_timestamp();
            let token_d = IERC20Dispatcher { contract_address: info.token };
            assert(token_d.transfer(info.payout_wallet, info.amount_for_merchant), 'Merchant payout failed');
            if info.admin_fee > 0 {
                let config = factory.get_protocol_config();
                assert(token_d.transfer(config.admin_wallet, info.admin_fee), 'Admin fee failed');
            }
            if info.cashback > 0 {
                let bal = self.token_balances.entry(info.token).read();
                self.token_balances.entry(info.token).write(bal + info.cashback);
            }

            info.settled = true;
            self.settlements.entry(request_id).write(info);
            let mut req = self.payment_requests.entry(request_id).read();
            req.status = RequestStatus::Settled;
            self.payment_requests.entry(request_id).write(req);
            self.request_status.entry(request_id).write(RequestStatus::Settled);

            self.emit(SettlementProcessed { request_id, amount: info.amount_for_merchant, payout_wallet: info.payout_wallet, timestamp: ts });
            self.reentrancy.end();
        }

        fn cancel_settlement(ref self: ContractState, request_id: u64, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let mut info = self.settlements.entry(request_id).read();
            assert(info.request_id != 0, 'No settlement');
            assert(!info.settled && !info.cancelled, 'Already finalised');

            let refund = info.amount_for_merchant + info.admin_fee;
            let bal = self.token_balances.entry(info.token).read();
            self.token_balances.entry(info.token).write(bal + refund);

            info.cancelled = true;
            self.settlements.entry(request_id).write(info);
            let mut req = self.payment_requests.entry(request_id).read();
            req.status = RequestStatus::Cancelled;
            self.payment_requests.entry(request_id).write(req);
            self.request_status.entry(request_id).write(RequestStatus::Cancelled);

            self.emit(SettlementCancelled { request_id, refunded: refund, timestamp: get_block_timestamp() });
        }

        // ================================================================
        // E. FUNDS MANAGEMENT
        // ================================================================

        fn deposit_funds(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            quote: Option<OffchainQuote>,
            slippage_tolerance_bps: u16,
        ) {
            self.reentrancy.start();
            let status = self.status.read();
            assert(status != CardStatus::Frozen, 'Card frozen');
            assert(status != CardStatus::Burned, 'Card burned');
            assert(amount > 0, 'Zero amount');
            assert(self.is_currency_accepted.entry(token).read(), 'Currency not accepted');
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_token_accepted(token), 'Token not in factory');

            let caller = get_caller_address();
            let card = get_contract_address();
            let d = IERC20Dispatcher { contract_address: token };
            assert(d.transfer_from(caller, card, amount), 'Transfer failed');

            let mut remaining = amount;

            if !self.deployment_fee_paid.read() {
                let fee_usd = self.deployment_fee_usd.read();
                if fee_usd > 0 {
                    let manual_id = self.token_price_feed_ids.entry(token).read();
                    let fee_in_token = Price_Oracle::convert_usd_to_token_auto(token, fee_usd, manual_id);
                    assert(fee_in_token > 0, 'Price feed unavailable');
                    assert(remaining >= fee_in_token, 'Deposit < deployment fee');
                    let config = factory.get_protocol_config();
                    assert(d.transfer(config.admin_wallet, fee_in_token), 'Fee transfer failed');
                    remaining -= fee_in_token;
                    self.deployment_fee_paid.write(true);
                    let ts = get_block_timestamp();
                    self.emit(DeploymentFeePaid { token, amount_in_token: fee_in_token, fee_usd, timestamp: ts });
                    self.status.write(CardStatus::Active);
                    self.emit(CardActivated { owner: self.owner.read(), timestamp: ts });
                }
            }

            if remaining > 0 && self.autoswap_enabled.entry(token).read() {
                let target_token = self.autoswap_target.entry(token).read();
                match quote {
                    Option::Some(q) => {
                        assert(!target_token.is_zero(), 'Invalid swap target');
                        assert(slippage_tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');
                        assert(q.sell_token_address == token, 'Quote sell mismatch');
                        assert(q.buy_token_address == target_token, 'Quote buy mismatch');
                        assert(q.sell_amount >= remaining, 'Quote sell < remaining');
                        let sell_amount = remaining;
                        let config = factory.get_protocol_config();
                        let min_out = q.buy_amount - (q.buy_amount * slippage_tolerance_bps.into() / BASIS_POINTS);
                        let credited = self._do_swap(config.avnu_router, token, target_token, sell_amount, q.buy_amount, min_out, q.fee.integrator_fees_bps, q.routes);
                        let tracked = self.token_balances.entry(target_token).read();
                        self.token_balances.entry(target_token).write(tracked + credited);
                        let ts = get_block_timestamp();
                        self.emit(SwapExecuted { token_in: token, token_out: target_token, amount_in: sell_amount, amount_out: credited, timestamp: ts });
                        self.emit(FundsDeposited { token: target_token, amount: credited, depositor: caller, timestamp: ts });
                        self.reentrancy.end();
                        return;
                    },
                    Option::None => {},
                }
            }

            if remaining > 0 {
                let bal = self.token_balances.entry(token).read();
                self.token_balances.entry(token).write(bal + remaining);
            }
            self.emit(FundsDeposited { token, amount: remaining, depositor: caller, timestamp: get_block_timestamp() });
            self.reentrancy.end();
        }

        fn withdraw_funds(ref self: ContractState, token: ContractAddress, amount: u256, sig_r: felt252, sig_s: felt252) {
            self.reentrancy.start();
            self._assert_not_frozen();
            self._assert_owner_pin(sig_r, sig_s);
            assert(amount > 0, 'Zero amount');
            let bal = self.token_balances.entry(token).read();
            assert(bal >= amount, 'Insufficient balance');
            self.token_balances.entry(token).write(bal - amount);
            let d = IERC20Dispatcher { contract_address: token };
            assert(d.transfer(self.owner.read(), amount), 'Transfer failed');
            self.emit(FundsWithdrawn { token, amount, timestamp: get_block_timestamp() });
            self.reentrancy.end();
        }

        fn sync_balances(
            ref self: ContractState,
            tokens: Span<ContractAddress>,
            quotes: Span<Option<OffchainQuote>>,
            slippage_tolerance_bps: u16,
        ) {
            self.reentrancy.start();
            self._assert_owner_or_relayer();
            assert(tokens.len() == quotes.len(), 'Length mismatch');
            let card = get_contract_address();
            let ts = get_block_timestamp();
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };

            let mut i: u32 = 0;
            loop {
                if i >= tokens.len() { break; }
                let token = *tokens.at(i);
                let d = IERC20Dispatcher { contract_address: token };
                let actual = d.balance_of(card);
                let tracked = self.token_balances.entry(token).read();

                if actual > tracked {
                    let mut surplus = actual - tracked;

                    if !self.deployment_fee_paid.read() {
                        let fee_usd = self.deployment_fee_usd.read();
                        if fee_usd > 0 {
                            let manual_id = self.token_price_feed_ids.entry(token).read();
                            let fee_in_token = Price_Oracle::convert_usd_to_token_auto(token, fee_usd, manual_id);
                            if fee_in_token > 0 && surplus >= fee_in_token {
                                let config = factory.get_protocol_config();
                                if d.transfer(config.admin_wallet, fee_in_token) {
                                    self.deployment_fee_paid.write(true);
                                    self.emit(DeploymentFeePaid { token, amount_in_token: fee_in_token, fee_usd, timestamp: ts });
                                    self.status.write(CardStatus::Active);
                                    self.emit(CardActivated { owner: self.owner.read(), timestamp: ts });
                                    surplus = d.balance_of(card) - tracked;
                                }
                            }
                        }
                    }

                    if surplus > 0 && self.autoswap_enabled.entry(token).read() {
                        let target_token = self.autoswap_target.entry(token).read();
                        let q_opt = *quotes.at(i);
                        match q_opt {
                            Option::Some(q) => {
                                if !target_token.is_zero() {
                                    assert(slippage_tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');
                                    assert(q.sell_token_address == token, 'Quote sell mismatch');
                                    assert(q.buy_token_address == target_token, 'Quote buy mismatch');
                                    assert(q.sell_amount >= surplus, 'Quote sell < surplus');
                                    let config = factory.get_protocol_config();
                                    let min_out = q.buy_amount - (q.buy_amount * slippage_tolerance_bps.into() / BASIS_POINTS);
                                    let credited = self._do_swap(config.avnu_router, token, target_token, surplus, q.buy_amount, min_out, q.fee.integrator_fees_bps, q.routes);
                                    let tgt_bal = self.token_balances.entry(target_token).read();
                                    self.token_balances.entry(target_token).write(tgt_bal + credited);
                                    self.emit(SwapExecuted { token_in: token, token_out: target_token, amount_in: surplus, amount_out: credited, timestamp: ts });
                                    let new_actual = d.balance_of(card);
                                    self.token_balances.entry(token).write(new_actual);
                                    self.last_balance_sync.entry(token).write(ts);
                                    i += 1;
                                    continue;
                                }
                            },
                            Option::None => {},
                        }
                    }

                    let new_actual = d.balance_of(card);
                    self.token_balances.entry(token).write(new_actual);
                } else {
                    self.token_balances.entry(token).write(actual);
                }
                self.last_balance_sync.entry(token).write(ts);
                i += 1;
            };
            self.reentrancy.end();
        }

        fn set_auto_swap(ref self: ContractState, source_token: ContractAddress, target_token: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_active();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(!source_token.is_zero() && !target_token.is_zero(), 'Invalid token');
            assert(source_token != target_token, 'Same token');
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_token_accepted(source_token), 'Source not supported');
            assert(factory.is_token_accepted(target_token), 'Target not supported');
            assert(self.is_currency_accepted.entry(source_token).read(), 'Source not on card');
            assert(self.is_currency_accepted.entry(target_token).read(), 'Target not on card');

            if !self.autoswap_enabled.entry(source_token).read() {
                let idx = self.autoswap_rule_count.read();
                self.autoswap_sources.entry(idx).write(source_token);
                self.autoswap_rule_count.write(idx + 1);
            }
            self.autoswap_target.entry(source_token).write(target_token);
            self.autoswap_enabled.entry(source_token).write(true);
            self.emit(AutoSwapConfigured { source_token, target_token, timestamp: get_block_timestamp() });
        }

        fn remove_auto_swap(ref self: ContractState, source_token: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(self.autoswap_enabled.entry(source_token).read(), 'No rule exists');
            self.autoswap_enabled.entry(source_token).write(false);
            self.autoswap_target.entry(source_token).write(Zero::zero());
            self.emit(AutoSwapRemoved { source_token, timestamp: get_block_timestamp() });
        }

        fn swap_tokens(
            ref self: ContractState,
            sell_token: ContractAddress,
            buy_token: ContractAddress,
            sell_amount: u256,
            quote: OffchainQuote,
            slippage_tolerance_bps: u16,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            self.reentrancy.start();
            self._assert_not_frozen();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(!sell_token.is_zero() && !buy_token.is_zero(), 'Invalid token');
            assert(sell_token != buy_token, 'Same token');
            assert(sell_amount > 0, 'Zero amount');
            assert(slippage_tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');

            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_token_accepted(sell_token), 'Sell not supported');
            assert(factory.is_token_accepted(buy_token), 'Buy not supported');
            assert(self.is_currency_accepted.entry(sell_token).read(), 'Sell not on card');
            assert(self.is_currency_accepted.entry(buy_token).read(), 'Buy not on card');

            assert(quote.sell_token_address == sell_token, 'Quote sell mismatch');
            assert(quote.buy_token_address == buy_token, 'Quote buy mismatch');
            assert(quote.sell_amount >= sell_amount, 'Quote sell < amount');

            let bal = self.token_balances.entry(sell_token).read();
            assert(bal >= quote.sell_amount, 'Insufficient balance');
            self.token_balances.entry(sell_token).write(bal - quote.sell_amount);

            let config = factory.get_protocol_config();
            let min_out = quote.buy_amount - (quote.buy_amount * slippage_tolerance_bps.into() / BASIS_POINTS);
            let credited = self._do_swap(config.avnu_router, sell_token, buy_token, quote.sell_amount, quote.buy_amount, min_out, quote.fee.integrator_fees_bps, quote.routes);
            let tracked = self.token_balances.entry(buy_token).read();
            self.token_balances.entry(buy_token).write(tracked + credited);

            let ts = get_block_timestamp();
            self.emit(SwapExecuted { token_in: sell_token, token_out: buy_token, amount_in: quote.sell_amount, amount_out: credited, timestamp: ts });
            self.reentrancy.end();
        }

        fn execute_auto_swap(
            ref self: ContractState,
            source_token: ContractAddress,
            amount: u256,
            quote: OffchainQuote,
            slippage_tolerance_bps: u16,
            sig_r: felt252,
            sig_s: felt252,
        ) {
            self.reentrancy.start();
            self._assert_not_frozen();
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            assert(self.autoswap_enabled.entry(source_token).read(), 'No auto-swap rule');
            let target_token = self.autoswap_target.entry(source_token).read();
            assert(!target_token.is_zero(), 'Invalid target');
            assert(amount > 0, 'Zero amount');
            assert(slippage_tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');

            assert(quote.sell_token_address == source_token, 'Quote sell mismatch');
            assert(quote.buy_token_address == target_token, 'Quote buy mismatch');
            assert(quote.sell_amount >= amount, 'Quote sell < amount');

            let bal = self.token_balances.entry(source_token).read();
            assert(bal >= quote.sell_amount, 'Insufficient balance');
            self.token_balances.entry(source_token).write(bal - quote.sell_amount);

            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            let config = factory.get_protocol_config();
            let min_out = quote.buy_amount - (quote.buy_amount * slippage_tolerance_bps.into() / BASIS_POINTS);
            let credited = self._do_swap(config.avnu_router, source_token, target_token, quote.sell_amount, quote.buy_amount, min_out, quote.fee.integrator_fees_bps, quote.routes);
            let tracked = self.token_balances.entry(target_token).read();
            self.token_balances.entry(target_token).write(tracked + credited);

            let ts = get_block_timestamp();
            self.emit(SwapExecuted { token_in: source_token, token_out: target_token, amount_in: quote.sell_amount, amount_out: credited, timestamp: ts });
            self.reentrancy.end();
        }

        fn add_merchant_to_blacklist(ref self: ContractState, merchant: ContractAddress, reason: ByteArray, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_pin(sig_r, sig_s);
            self.merchant_blacklist.entry(merchant).write(true);
            self.merchant_blacklist_reason.entry(merchant).write(reason.clone());
            self._cancel_merchant_payments(merchant);
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            factory.increment_merchant_blacklist_count(merchant);
            self.emit(MerchantBlacklisted { merchant, reason, timestamp: get_block_timestamp() });
        }

        fn remove_merchant_from_blacklist(ref self: ContractState, merchant: ContractAddress, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_pin(sig_r, sig_s);
            self.merchant_blacklist.entry(merchant).write(false);
            self.emit(MerchantUnblacklisted { merchant, timestamp: get_block_timestamp() });
        }

        fn freeze_card(ref self: ContractState, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let status = self.status.read();
            assert(status != CardStatus::Frozen, 'Already frozen');
            assert(status != CardStatus::Burned, 'Card burned');
            self.status.write(CardStatus::Frozen);
            self._cancel_all_active_payments();
            self.emit(CardFrozen { timestamp: get_block_timestamp() });
        }

        fn unfreeze_card(ref self: ContractState, sig_r: felt252, sig_s: felt252) {
            self._assert_owner_pin(sig_r, sig_s);
            assert(self.status.read() == CardStatus::Frozen, 'Not frozen');
            if self.deployment_fee_paid.read() {
                self.status.write(CardStatus::Active);
            } else {
                self.status.write(CardStatus::PendingActivation);
            }
            self.emit(CardUnfrozen { timestamp: get_block_timestamp() });
        }

        fn burn_card(ref self: ContractState, sig_r: felt252, sig_s: felt252) {
            self.reentrancy.start();
            self._assert_owner_pin(sig_r, sig_s);
            assert(self.status.read() != CardStatus::Burned, 'Already burned');
            let owner = self.owner.read();
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            let config = factory.get_protocol_config();

            self._cancel_all_active_payments();

            let burn_fee_usd = config.burn_fee;
            let mut fee_paid = false;
            let count = self.currency_count.read();
            let mut i: u32 = 0;
            loop {
                if i >= count || fee_paid { break; }
                let token = self.accepted_currencies.entry(i).read();
                let bal = self.token_balances.entry(token).read();
                let manual_id = self.token_price_feed_ids.entry(token).read();
                let fee_in_token = Price_Oracle::convert_usd_to_token_auto(token, burn_fee_usd, manual_id);
                if fee_in_token > 0 && bal >= fee_in_token {
                    let d = IERC20Dispatcher { contract_address: token };
                    if d.transfer(config.admin_wallet, fee_in_token) {
                        self.token_balances.entry(token).write(bal - fee_in_token);
                        fee_paid = true;
                    }
                }
                i += 1;
            };
            assert(fee_paid, 'No balance for burn fee');

            let mut j: u32 = 0;
            loop {
                if j >= count { break; }
                let token = self.accepted_currencies.entry(j).read();
                let bal = self.token_balances.entry(token).read();
                if bal > 0 {
                    self.token_balances.entry(token).write(0);
                    let d = IERC20Dispatcher { contract_address: token };
                    d.transfer(owner, bal);
                }
                j += 1;
            };

            self.owner.write(Zero::zero());
            self.status.write(CardStatus::Burned);
            self.emit(CardBurned { owner, timestamp: get_block_timestamp() });
            self.reentrancy.end();
        }

        fn get_accepted_currencies(self: @ContractState) -> Span<ContractAddress> {
            let count = self.currency_count.read();
            let mut out = ArrayTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                let t = self.accepted_currencies.entry(i).read();
                if self.is_currency_accepted.entry(t).read() {
                    out.append(t);
                }
                i += 1;
            };
            out.span()
        }

        fn get_factory_accepted_tokens(self: @ContractState) -> Span<ContractAddress> {
            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            factory.get_accepted_tokens()
        }

        fn get_payment_mode(self: @ContractState) -> PaymentMode { self.payment_mode.read() }

        fn is_currency_accepted(self: @ContractState, token: ContractAddress) -> bool {
            self.is_currency_accepted.entry(token).read()
        }

        fn get_pending_requests(self: @ContractState, offset: u64, limit: u8) -> Span<PaymentRequest> {
            self._get_requests_by_status(offset, limit, RequestStatus::Pending)
        }

        fn get_approved_requests(self: @ContractState, offset: u64, limit: u8) -> Span<PaymentRequest> {
            self._get_requests_by_status(offset, limit, RequestStatus::Approved)
        }

        fn get_request_details(self: @ContractState, request_id: u64) -> PaymentRequest {
            let r = self.payment_requests.entry(request_id).read();
            assert(r.request_id != 0, 'Not found');
            r
        }

        fn get_request_status(self: @ContractState, request_id: u64) -> RequestStatus {
            let r = self.payment_requests.entry(request_id).read();
            assert(r.request_id != 0, 'Not found');
            self.request_status.entry(request_id).read()
        }

        fn is_merchant_blacklisted(self: @ContractState, merchant: ContractAddress) -> bool {
            self.merchant_blacklist.entry(merchant).read()
        }

        fn get_card_info(self: @ContractState) -> CardInfo {
            CardInfo {
                card_address: get_contract_address(),
                owner: self.owner.read(),
                relayer: self.authorized_relayer.read(),
                is_frozen: self.status.read() == CardStatus::Frozen,
                is_burned: self.status.read() == CardStatus::Burned,
                created_at: self.created_at.read(),
                payment_mode: self.payment_mode.read(),
                slippage_tolerance_bps: self.slippage_tolerance_bps.read(),
                auto_approve_threshold_usd: self.auto_approve_threshold_usd.read(),
                total_currencies: self.currency_count.read(),
            }
        }

        fn get_card_status(self: @ContractState) -> CardStatus { self.status.read() }

        fn get_rate_limit_status(self: @ContractState) -> RateLimitStatus {
            let now = get_block_timestamp();
            let lock_until = self.lockout_until.read();
            let last_charge = self.last_charge_timestamp.read();
            RateLimitStatus {
                is_locked: now < lock_until,
                failed_attempts: self.failed_pin_attempts.read(),
                lockout_until: lock_until,
                requests_submitted_last_hour: 0,
                approvals_last_hour: self.approval_count.read(),
                last_charge_timestamp: last_charge,
                cooldown_remaining: if last_charge + CHARGE_COOLDOWN > now { (last_charge + CHARGE_COOLDOWN) - now } else { 0 },
            }
        }

        fn get_merchant_spend_limit(self: @ContractState, merchant: ContractAddress) -> u256 {
            self.merchant_spend_limit.entry(merchant).read()
        }

        fn get_auto_approve_threshold(self: @ContractState) -> u256 {
            self.auto_approve_threshold_usd.read()
        }

        fn get_settlement_info(self: @ContractState, request_id: u64) -> SettlementInfo {
            self.settlements.entry(request_id).read()
        }

        fn is_idempotency_key_used(self: @ContractState, key: felt252) -> bool {
            self.idempotency_keys.entry(key).read()
        }

        fn is_deployment_fee_paid(self: @ContractState) -> bool {
            self.deployment_fee_paid.read()
        }

        fn get_deployment_fee_debt(self: @ContractState) -> u256 {
            if self.deployment_fee_paid.read() { 0 } else { self.deployment_fee_usd.read() }
        }

        fn get_auto_swap_target(self: @ContractState, source_token: ContractAddress) -> ContractAddress {
            self.autoswap_target.entry(source_token).read()
        }

        fn is_auto_swap_enabled(self: @ContractState, source_token: ContractAddress) -> bool {
            self.autoswap_enabled.entry(source_token).read()
        }

        fn get_all_auto_swap_rules(self: @ContractState) -> Span<(ContractAddress, ContractAddress)> {
            let count = self.autoswap_rule_count.read();
            let mut out = ArrayTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                let src = self.autoswap_sources.entry(i).read();
                if self.autoswap_enabled.entry(src).read() {
                    let tgt = self.autoswap_target.entry(src).read();
                    out.append((src, tgt));
                }
                i += 1;
            };
            out.span()
        }

        fn rotate_pin(ref self: ContractState, new_public_key: felt252, old_sig_r: felt252, old_sig_s: felt252) {
            self._assert_owner();
            self.pin.rotate_pin(new_public_key, old_sig_r, old_sig_s);
        }

        fn get_pin_public_key(self: @ContractState, user: ContractAddress) -> felt252 {
            self._assert_owner_or_relayer();
            self.pin.get_pin_public_key(user)
        }

        fn get_pin_nonce(self: @ContractState, user: ContractAddress) -> felt252 {
            self._assert_owner_or_relayer();
            self.pin.get_pin_nonce(user)
        }

        fn get_transactions(self: @ContractState, offset: u64, limit: u8) -> Span<PaymentRequest> {
            let cap = if limit > 100 { 100_u8 } else { limit };
            let total = self.request_counter.read();
            let mut out = ArrayTrait::new();
            let mut collected: u8 = 0;
            let mut i = offset + 1;
            loop {
                if i > total || collected >= cap { break; }
                let req = self.payment_requests.entry(i).read();
                if req.request_id != 0 {
                    out.append(req);
                    collected += 1;
                }
                i += 1;
            };
            out.span()
        }

        fn get_transaction_summary(
            ref self: ContractState, sig_r: felt252, sig_s: felt252,
            start_ts: u64, end_ts: u64, offset: u64, limit: u8,
        ) -> TransactionSummary {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let cap = if limit > 100 { 100_u8 } else { limit };
            let total = self.transaction_counter.read();
            let mut spent: u256 = 0; let mut cb: u256 = 0; let mut fees: u256 = 0;
            let mut count: u64 = 0; let mut collected: u8 = 0;
            let mut i = offset + 1;
            loop {
                if i > total || collected >= cap { break; }
                let tx = self.transactions.entry(i).read();
                if tx.timestamp >= start_ts && tx.timestamp <= end_ts {
                    spent = spent + tx.amount;
                    cb = cb + tx.cashback_amount;
                    fees = fees + tx.transaction_fee;
                    count += 1;
                    collected += 1;
                }
                i += 1;
            };
            TransactionSummary {
                total_spent: spent, total_received: 0, total_cashback_earned: cb,
                total_swap_fees_paid: 0, total_tx_fees_charged: fees,
                transaction_count: count, unique_merchants: 0,
                transactions: ArrayTrait::new().span(),
            }
        }

        fn get_balance_summary(ref self: ContractState, sig_r: felt252, sig_s: felt252) -> BalanceSummary {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let mut out = ArrayTrait::new();
            let count = self.currency_count.read();
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                let token = self.accepted_currencies.entry(i).read();
                let bal = self.token_balances.entry(token).read();
                out.append(TokenBalance { token, balance: bal, last_updated: self.last_balance_sync.entry(token).read() });
                i += 1;
            };
            BalanceSummary { balances: out.span(), total_value_usd: 0 }
        }

        fn get_fraud_alerts(ref self: ContractState, sig_r: felt252, sig_s: felt252) -> Span<FraudAlert> {
            self._assert_owner_or_relayer_pin(sig_r, sig_s);
            let mut out = ArrayTrait::new();
            let total = self.fraud_alert_count.read();
            let mut i: u64 = 1;
            loop {
                if i > total { break; }
                out.append(self.fraud_alerts.entry(i).read());
                i += 1;
            };
            out.span()
        }
    }

    // ====================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {

        fn _do_swap(
            ref self: ContractState,
            avnu_router: ContractAddress,
            sell_token: ContractAddress,
            buy_token: ContractAddress,
            sell_amount: u256,
            expected_buy: u256,
            min_buy: u256,
            integrator_fees_bps: u128,
            routes: Span<Route>,
        ) -> u256 {
            let card = get_contract_address();
            let sell_d = IERC20Dispatcher { contract_address: sell_token };
            assert(sell_d.approve(avnu_router, sell_amount), 'Approve failed');
            let buy_d = IERC20Dispatcher { contract_address: buy_token };
            let pre = buy_d.balance_of(card);
            let avnu = IZorahAVNURouterDispatcher { contract_address: avnu_router };
            assert(avnu.multi_route_swap(
                sell_token, sell_amount, buy_token, expected_buy, min_buy,
                card, integrator_fees_bps, Zero::zero(), routes,
            ), 'Swap failed');
            let post = buy_d.balance_of(card);
            let credited = post - pre;
            assert(credited > 0, 'Swap returned nothing');
            credited
        }

        fn _assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), 'Not owner');
        }

        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'Not admin');
        }

        fn _assert_owner_or_relayer(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.owner.read() || caller == self.authorized_relayer.read(), 'Unauthorized');
        }

        fn _assert_owner_or_relayer_pin(ref self: ContractState, sig_r: felt252, sig_s: felt252) {
            self._check_lockout();
            let caller = get_caller_address();
            let owner = self.owner.read();
            if caller == owner {
                self.pin._verify_pin(owner, sig_r, sig_s);
                self.failed_pin_attempts.write(0);
            } else {
                assert(caller == self.authorized_relayer.read(), 'Unauthorized');
            }
        }

        fn _assert_owner_pin(ref self: ContractState, sig_r: felt252, sig_s: felt252) {
            self._check_lockout();
            let owner = self.owner.read();
            assert(get_caller_address() == owner, 'Not owner');
            self.pin._verify_pin(owner, sig_r, sig_s);
            self.failed_pin_attempts.write(0);
        }

        fn _check_lockout(self: @ContractState) {
            assert(get_block_timestamp() >= self.lockout_until.read(), 'Locked out');
        }

        fn _assert_active(self: @ContractState) {
            assert(self.status.read() == CardStatus::Active, 'Card not active');
        }

        fn _assert_not_frozen(self: @ContractState) {
            let status = self.status.read();
            assert(status != CardStatus::PendingActivation, 'Pay deployment fee first');
            assert(status != CardStatus::Frozen, 'Card frozen');
            assert(status != CardStatus::Burned, 'Card burned');
        }

        fn _check_merchant_rate_limit(ref self: ContractState, merchant: ContractAddress) {
            let now = get_block_timestamp();
            let last = self.merchant_last_request_reset.entry(merchant).read();
            let mut count = self.merchant_request_count.entry(merchant).read();
            if now >= last + RATE_LIMIT_WINDOW {
                count = 0;
                self.merchant_request_count.entry(merchant).write(0);
                self.merchant_last_request_reset.entry(merchant).write(now);
            }
            count += 1;
            assert(count <= MERCHANT_REQUEST_LIMIT, 'Merchant rate limit');
            self.merchant_request_count.entry(merchant).write(count);
        }

        fn _check_approval_rate_limit(ref self: ContractState) {
            let now = get_block_timestamp();
            let last = self.approval_last_reset.read();
            let mut count = self.approval_count.read();
            if now >= last + RATE_LIMIT_WINDOW {
                count = 0;
                self.approval_count.write(0);
                self.approval_last_reset.write(now);
            }
            count += 1;
            assert(count <= APPROVAL_LIMIT, 'Approval rate limit');
            self.approval_count.write(count);
        }

        fn _has_any_balance(self: @ContractState) -> bool {
            let count = self.currency_count.read();
            let mut i: u32 = 0;
            loop {
                if i >= count { break false; }
                let t = self.accepted_currencies.entry(i).read();
                if self.token_balances.entry(t).read() > 0 { break true; }
                i += 1;
            }
        }

        fn _determine_source_token(self: @ContractState, target: ContractAddress, amount: u256) -> ContractAddress {
            let mode = self.payment_mode.read();
            if mode == PaymentMode::MerchantTokenOnly {
                return target;
            }
            let direct = self.token_balances.entry(target).read();
            if direct >= amount { return target; }
            let count = self.currency_count.read();
            let mut i: u32 = 0;
            loop {
                if i >= count { break; }
                let t = self.accepted_currencies.entry(i).read();
                if self.token_balances.entry(t).read() > 0 { return t; }
                i += 1;
            };
            panic(array!['No balance'])
        }

        fn _execute_charge(
            ref self: ContractState,
            request_id: u64,
            idempotency_key: felt252,
            settlement_delay_seconds: u64,
            quote: Option<OffchainQuote>,
            slippage_tolerance_bps: u16,
            deadline: u64,
            is_recurring: bool,
        ) {
            self.reentrancy.start();
            self._assert_not_frozen();

            assert(idempotency_key != 0, 'Key required');
            assert(!self.idempotency_keys.entry(idempotency_key).read(), 'Key already used');
            self.idempotency_keys.entry(idempotency_key).write(true);

            assert(slippage_tolerance_bps <= MAX_SLIPPAGE, 'Slippage too high');

            let caller = get_caller_address();
            let ts = get_block_timestamp();
            assert(ts <= deadline, 'Deadline passed');
            let last_charge = self.last_charge_timestamp.read();
            assert(ts >= last_charge + CHARGE_COOLDOWN, 'Cooldown');

            let mut req = self.payment_requests.entry(request_id).read();
            assert(req.request_id != 0, 'Not found');
            assert(req.status == RequestStatus::Approved, 'Not approved');

            let is_owner = caller == self.owner.read();
            let is_relayer = caller == self.authorized_relayer.read();
            let is_merchant = caller == req.merchant;
            assert(is_owner || is_relayer || is_merchant, 'Unauthorized');

            let factory = IZionDefiFactoryDispatcher { contract_address: self.factory.read() };
            assert(factory.is_merchant_registered(req.merchant), 'Merchant not registered');
            assert(factory.is_merchant_active(req.merchant), 'Merchant not active');
            assert(!factory.is_merchant_globally_blacklisted(req.merchant), 'Merchant blocked');
            assert(!self.merchant_blacklist.entry(req.merchant).read(), 'Merchant blacklisted');

            let m_limit = self.merchant_spend_limit.entry(req.merchant).read();
            if m_limit > 0 {
                let manual_id = self.token_price_feed_ids.entry(req.token).read();
                let usd = Price_Oracle::convert_token_to_usd_auto(req.token, req.amount, manual_id);
                if usd > 0 { assert(usd <= m_limit, 'Exceeds merchant limit'); }
            }

            self._check_tx_limit(req.amount, req.token);

            let payout_wallet = factory.get_merchant_payout_wallet(req.merchant);
            assert(!payout_wallet.is_zero(), 'No payout wallet');

            let source_token = self._determine_source_token(req.token, req.amount);
            let swap_needed = source_token != req.token;
            let mut swap_fee: u256 = 0;
            let mut final_token_in = source_token;

            if swap_needed {
                assert(quote.is_some(), 'Quote required');
                let q = quote.unwrap();
                assert(q.buy_token_address == req.token, 'Quote output mismatch');
                assert(q.sell_token_address == source_token, 'Quote input mismatch');
                assert(q.buy_amount >= req.amount, 'Insufficient quote output');

                let sell_bal = self.token_balances.entry(source_token).read();
                assert(sell_bal >= q.sell_amount, 'Insufficient balance');
                self.token_balances.entry(source_token).write(sell_bal - q.sell_amount);

                let config = factory.get_protocol_config();
                let slippage_adjusted = q.buy_amount - (q.buy_amount * slippage_tolerance_bps.into() / BASIS_POINTS);
                let min_out = if slippage_adjusted > req.amount { slippage_adjusted } else { req.amount };
                self._do_swap(config.avnu_router, source_token, req.token, q.sell_amount, q.buy_amount, min_out, q.fee.integrator_fees_bps, q.routes);

                swap_fee = q.fee.avnu_fees;
                final_token_in = source_token;

                let card = get_contract_address();
                let actual_out = IERC20Dispatcher { contract_address: req.token }.balance_of(card);
                let existing_tracked = self.token_balances.entry(req.token).read();
                assert(actual_out >= existing_tracked + req.amount, 'Swap output insufficient');

                let surplus = actual_out - existing_tracked - req.amount;
                if surplus > 0 {
                    self.token_balances.entry(req.token).write(existing_tracked + surplus);
                }

                self.emit(SwapExecuted { token_in: source_token, token_out: req.token, amount_in: q.sell_amount, amount_out: q.buy_amount, timestamp: ts });
            } else {
                let bal = self.token_balances.entry(req.token).read();
                assert(bal >= req.amount, 'Insufficient balance');
                self.token_balances.entry(req.token).write(bal - req.amount);
            }

            let config = factory.get_protocol_config();
            let fee_pct = config.transaction_fee_percent;
            let mut fee = (req.amount * fee_pct.into()) / BASIS_POINTS;

            let fee_cap_usd = config.transaction_fee_cap;
            if fee_cap_usd > 0 {
                let manual_id = self.token_price_feed_ids.entry(req.token).read();
                let cap_in_token = Price_Oracle::convert_usd_to_token_auto(req.token, fee_cap_usd, manual_id);
                if cap_in_token > 0 && fee > cap_in_token { fee = cap_in_token; }
            }

            let discount_bps = factory.get_merchant_discount(req.merchant);
            if discount_bps > 0 { fee = fee - (fee * discount_bps.into() / BASIS_POINTS); }

            let cashback_pct = config.user_cashback_percent;
            let cashback = (fee * cashback_pct.into()) / 100;
            assert(fee <= req.amount, 'Fee exceeds amount');
            assert(cashback <= fee, 'Cashback exceeds fee');
            let admin_fee = fee - cashback;
            let amount_for_merchant = req.amount - fee;

            let is_instant = factory.is_merchant_instant_settlement(req.merchant);
            let effective_delay = if is_instant {
                0_u64
            } else if settlement_delay_seconds > 0 {
                settlement_delay_seconds
            } else {
                factory.get_effective_settlement_delay(req.merchant)
            };

            let settle_at = ts + effective_delay;

            let settlement = SettlementInfo {
                request_id,
                amount_for_merchant,
                admin_fee,
                cashback,
                token: req.token,
                payout_wallet,
                merchant: req.merchant,
                settle_at,
                settled: effective_delay == 0,
                cancelled: false,
                swap_occurred: swap_needed,
                token_in: final_token_in,
                swap_fee,
            };
            self.settlements.entry(request_id).write(settlement);

            if is_recurring {
                req.last_charged_at = ts;
                req.charge_count += 1;
                if effective_delay == 0 {
                } else {
                    req.status = RequestStatus::AwaitingSettlement;
                    self.request_status.entry(request_id).write(RequestStatus::AwaitingSettlement);
                }
            } else {
                if effective_delay == 0 {
                    req.status = RequestStatus::Settled;
                    self.request_status.entry(request_id).write(RequestStatus::Settled);
                } else {
                    req.status = RequestStatus::AwaitingSettlement;
                    self.request_status.entry(request_id).write(RequestStatus::AwaitingSettlement);
                }
                req.last_charged_at = ts;
                req.charge_count = 1;
            }
            let req_merchant = req.merchant;
            let req_token = req.token;
            let req_amount = req.amount;
            self.payment_requests.entry(request_id).write(req);

            if effective_delay == 0 {
                let token_d = IERC20Dispatcher { contract_address: req_token };
                assert(token_d.transfer(payout_wallet, amount_for_merchant), 'Merchant payout failed');
                if admin_fee > 0 { assert(token_d.transfer(config.admin_wallet, admin_fee), 'Admin fee failed'); }
                if cashback > 0 {
                    let cb_bal = self.token_balances.entry(req_token).read();
                    self.token_balances.entry(req_token).write(cb_bal + cashback);
                }
            }

            self._record_transaction(
                request_id, req_merchant, payout_wallet, req_amount,
                final_token_in, req_token, swap_needed, swap_fee, fee, cashback,
                if is_recurring { 'charge_recurring' } else { 'charge_one_time' },
            );

            self.last_charge_timestamp.write(ts);
            self._update_daily_tracking(req_amount, req_token);

            let manual_id = self.token_price_feed_ids.entry(req_token).read();
            let amount_usd = Price_Oracle::convert_token_to_usd_auto(req_token, req_amount, manual_id);
            let largest = self.largest_charge_amount.read();
            if amount_usd > 0 {
                if largest > 0 && amount_usd > largest * ANOMALY_MULTIPLIER {
                    self.status.write(CardStatus::Frozen);
                    self._cancel_all_active_payments();
                    self.emit(AnomalyDetected { request_id, amount_usd, threshold: largest * ANOMALY_MULTIPLIER, timestamp: ts });
                    self.emit(CardFrozen { timestamp: ts });
                }
                if amount_usd > largest {
                    self.largest_charge_amount.write(amount_usd);
                }
            }

            factory.update_merchant_reputation(req_merchant, get_contract_address(), req_amount, true);

            self.emit(CardCharged {
                request_id, merchant: req_merchant, amount: req_amount,
                token_in: final_token_in, token_out: req_token,
                swap_occurred: swap_needed, settle_at, timestamp: ts,
            });
            self.reentrancy.end();
        }

        fn _record_transaction(
            ref self: ContractState,
            request_id: u64, merchant: ContractAddress, payout_wallet: ContractAddress,
            amount: u256, token_in: ContractAddress, token_out: ContractAddress,
            swap_occurred: bool, swap_fee: u256, tx_fee: u256, cashback: u256, tx_type: felt252,
        ) {
            let tx_id = self.transaction_counter.read() + 1;
            self.transaction_counter.write(tx_id);
            self.request_to_transaction_id.entry(request_id).write(tx_id);
            self.transactions.entry(tx_id).write(TransactionRecord {
                transaction_id: tx_id, request_id, merchant, payout_wallet, amount,
                token_in, token_out, swap_occurred, swap_fee, slippage_paid: 0,
                transaction_fee: tx_fee, cashback_amount: cashback,
                timestamp: get_block_timestamp(), transaction_type: tx_type,
            });
        }

        fn _update_daily_tracking(ref self: ContractState, amount: u256, token: ContractAddress) {
            let now = get_block_timestamp();
            if now >= self.last_daily_reset.read() + SECONDS_PER_DAY {
                self.daily_transaction_count.write(0);
                self.daily_spend_amount.write(0);
                self.last_daily_reset.write(now);
            }
            let mut cnt = self.daily_transaction_count.read() + 1;
            self.daily_transaction_count.write(cnt);
            let spent = self.daily_spend_amount.read() + amount;
            self.daily_spend_amount.write(spent);
            let limit_cnt = self.daily_transaction_limit.read();
            if limit_cnt > 0 { assert(cnt <= limit_cnt, 'Daily tx limit'); }
            let limit_spend = self.daily_spend_limit.read();
            if limit_spend > 0 { assert(spent <= limit_spend, 'Daily spend limit'); }
        }

        fn _check_tx_limit(self: @ContractState, amount: u256, token: ContractAddress) {
            let max = self.max_transaction_amount.read();
            if max == 0 { return; }
            let manual_id = self.token_price_feed_ids.entry(token).read();
            let usd = Price_Oracle::convert_token_to_usd_auto(token, amount, manual_id);
            if usd > 0 { assert(usd <= max, 'Max tx exceeded'); }
        }

        fn _cancel_all_active_payments(ref self: ContractState) {
            let total = self.request_counter.read();
            let mut i: u64 = 1;
            loop {
                if i > total { break; }
                let status = self.request_status.entry(i).read();
                if status == RequestStatus::Pending || status == RequestStatus::Approved {
                    self.request_status.entry(i).write(RequestStatus::Cancelled);
                    let mut req = self.payment_requests.entry(i).read();
                    req.status = RequestStatus::Cancelled;
                    self.payment_requests.entry(i).write(req);
                } else if status == RequestStatus::AwaitingSettlement {
                    self._refund_settlement(i);
                }
                i += 1;
            };
        }

        fn _cancel_merchant_payments(ref self: ContractState, merchant: ContractAddress) {
            let total = self.request_counter.read();
            let mut i: u64 = 1;
            loop {
                if i > total { break; }
                let req = self.payment_requests.entry(i).read();
                if req.merchant == merchant {
                    let status = self.request_status.entry(i).read();
                    if status == RequestStatus::Pending || status == RequestStatus::Approved {
                        self.request_status.entry(i).write(RequestStatus::Cancelled);
                        let mut r = req;
                        r.status = RequestStatus::Cancelled;
                        self.payment_requests.entry(i).write(r);
                    } else if status == RequestStatus::AwaitingSettlement {
                        self._refund_settlement(i);
                    }
                }
                i += 1;
            };
        }

        fn _refund_settlement(ref self: ContractState, request_id: u64) {
            let mut info = self.settlements.entry(request_id).read();
            if info.request_id != 0 && !info.settled && !info.cancelled {
                let refund = info.amount_for_merchant + info.admin_fee;
                let bal = self.token_balances.entry(info.token).read();
                self.token_balances.entry(info.token).write(bal + refund);
                info.cancelled = true;
                self.settlements.entry(request_id).write(info);
            }
            self.request_status.entry(request_id).write(RequestStatus::Cancelled);
            let mut req = self.payment_requests.entry(request_id).read();
            req.status = RequestStatus::Cancelled;
            self.payment_requests.entry(request_id).write(req);
        }

        fn _get_requests_by_status(self: @ContractState, offset: u64, limit: u8, target: RequestStatus) -> Span<PaymentRequest> {
            let cap = if limit > 100 { 100_u8 } else { limit };
            let total = self.request_counter.read();
            let mut out = ArrayTrait::new();
            let mut i = offset + 1;
            let mut count: u8 = 0;
            loop {
                if i > total || count >= cap { break; }
                if self.request_status.entry(i).read() == target {
                    out.append(self.payment_requests.entry(i).read());
                    count += 1;
                }
                i += 1;
            };
            out.span()
        }
    }

    // ====================================================================

    #[abi(embed_v0)]
    impl UpgradeableImpl of IUpgradeable<ContractState> {
        fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
            assert(get_caller_address() == self.admin.read(), 'Admin only');
            self.upgradeable.upgrade(new_class_hash);
        }
    }
}
