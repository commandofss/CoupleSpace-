module couplespace::couple_vault {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::clock::{Self, Clock};
    use couplespace::protocol_fee::{Self, FeeTreasury};

    // ── Error codes ──
    const E_NOT_PARTNER:       u64 = 1;
    const E_VAULT_LOCKED:      u64 = 2;
    const E_ALREADY_CONNECTED: u64 = 3;
    const E_NOT_READY:         u64 = 4;

    // ── Release trigger types ──
    const TRIGGER_PERCENT:  u8 = 0;
    const TRIGGER_DATE:     u8 = 1;

    // ── Status constants ──
    const STATUS_ACTIVE:   u8 = 0;
    const STATUS_RELEASED: u8 = 1;

    // ── Shared vault object ──
    public struct CoupleVault<phantom T> has key {
        id: UID,
        partner_a: address,
        partner_b: address,
        balance: Balance<T>,
        target: u64,
        my_contrib_a: u64,
        my_contrib_b: u64,
        trigger_type: u8,
        trigger_value: u64,
        label: vector<u8>,
        status: u8,
        destination: address,
    }

    // ── Create a new couple vault ──
    public fun create<T>(
        partner_b: address,
        target: u64,
        trigger_type: u8,
        trigger_value: u64,
        label: vector<u8>,
        destination: address,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender != partner_b, E_ALREADY_CONNECTED);

        let vault = CoupleVault<T> {
            id: object::new(ctx),
            partner_a: sender,
            partner_b,
            balance: balance::zero<T>(),
            target,
            my_contrib_a: 0,
            my_contrib_b: 0,
            trigger_type,
            trigger_value,
            label,
            status: STATUS_ACTIVE,
            destination,
        };
        transfer::share_object(vault);
    }

    // ── Contribute to the vault ──
    public fun contribute<T>(
        vault: &mut CoupleVault<T>,
        payment: Coin<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == vault.partner_a || sender == vault.partner_b,
            E_NOT_PARTNER
        );
        assert!(vault.status == STATUS_ACTIVE, E_VAULT_LOCKED);

        let amount = coin::value(&payment);

        if (sender == vault.partner_a) {
            vault.my_contrib_a = vault.my_contrib_a + amount;
        } else {
            vault.my_contrib_b = vault.my_contrib_b + amount;
        };

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut vault.balance, payment_balance);
    }

    // ── Check if release trigger is met ──
    fun is_trigger_met<T>(vault: &CoupleVault<T>, clock: &Clock): bool {
        let total = balance::value(&vault.balance);
        if (vault.trigger_type == TRIGGER_PERCENT) {
            let pct = (total * 100) / vault.target;
            pct >= vault.trigger_value
        } else if (vault.trigger_type == TRIGGER_DATE) {
            clock::timestamp_ms(clock) >= vault.trigger_value
        } else {
            false
        }
    }

    // ── Release funds to destination (2% fee deducted) ──
    public fun release<T>(
        vault: &mut CoupleVault<T>,
        treasury: &mut FeeTreasury<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == vault.partner_a || sender == vault.partner_b,
            E_NOT_PARTNER
        );
        assert!(vault.status == STATUS_ACTIVE, E_VAULT_LOCKED);
        assert!(is_trigger_met(vault, clock), E_NOT_READY);

        let total = balance::value(&vault.balance);
        let full_balance = balance::split(&mut vault.balance, total);
        let full_coin = coin::from_balance(full_balance, ctx);

        // Deduct 2% fee
        let net_coin = protocol_fee::deduct_fee(treasury, full_coin, ctx);

        vault.status = STATUS_RELEASED;
        transfer::public_transfer(net_coin, vault.destination);
    }

    // ── Getters ──
    public fun balance_value<T>(vault: &CoupleVault<T>): u64 {
        balance::value(&vault.balance)
    }

    public fun target<T>(vault: &CoupleVault<T>): u64 {
        vault.target
    }

    public fun status<T>(vault: &CoupleVault<T>): u8 {
        vault.status
    }

    public fun contrib_a<T>(vault: &CoupleVault<T>): u64 {
        vault.my_contrib_a
    }

    public fun contrib_b<T>(vault: &CoupleVault<T>): u64 {
        vault.my_contrib_b
    }

    public fun partners<T>(vault: &CoupleVault<T>): (address, address) {
        (vault.partner_a, vault.partner_b)
    }
}
