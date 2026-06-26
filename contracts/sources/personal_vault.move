module couplespace::personal_vault {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::clock::{Self, Clock};
    use couplespace::protocol_fee::{Self, FeeTreasury};

    // ── Error codes ──
    const E_NOT_OWNER:     u64 = 1;
    const E_ALREADY_RELEASED: u64 = 2;
    const E_NOT_READY:     u64 = 3;

    // ── Trigger types ──
    const TRIGGER_AMOUNT: u8 = 0;
    const TRIGGER_DATE:   u8 = 1;

    // ── Status ──
    const STATUS_ACTIVE:   u8 = 0;
    const STATUS_RELEASED: u8 = 1;

    // ── Personal vault — owned object, invisible to partner ──
    public struct PersonalVault<phantom T> has key {
        id: UID,
        owner: address,
        balance: Balance<T>,
        target: u64,
        trigger_type: u8,
        trigger_value: u64, // amount threshold OR unix timestamp ms
        label: vector<u8>,
        status: u8,
        destination: address,
        total_contributed: u64,
    }

    // ── Create a personal vault ──
    public fun create<T>(
        target: u64,
        trigger_type: u8,
        trigger_value: u64,
        label: vector<u8>,
        destination: address,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let vault = PersonalVault<T> {
            id: object::new(ctx),
            owner: sender,
            balance: balance::zero<T>(),
            target,
            trigger_type,
            trigger_value,
            label,
            status: STATUS_ACTIVE,
            destination,
            total_contributed: 0,
        };
        // Owned object — only sender can see and access it
        transfer::transfer(vault, sender);
    }

    // ── Contribute to personal vault ──
    public fun contribute<T>(
        vault: &mut PersonalVault<T>,
        payment: Coin<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == vault.owner, E_NOT_OWNER);
        assert!(vault.status == STATUS_ACTIVE, E_ALREADY_RELEASED);

        let amount = coin::value(&payment);
        vault.total_contributed = vault.total_contributed + amount;

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut vault.balance, payment_balance);
    }

    // ── Check if trigger is met ──
    fun is_trigger_met<T>(vault: &PersonalVault<T>, clock: &Clock): bool {
        if (vault.trigger_type == TRIGGER_AMOUNT) {
            balance::value(&vault.balance) >= vault.trigger_value
        } else if (vault.trigger_type == TRIGGER_DATE) {
            clock::timestamp_ms(clock) >= vault.trigger_value
        } else {
            false
        }
    }

    // ── Release funds to destination (2% fee deducted) ──
    public fun release<T>(
        vault: &mut PersonalVault<T>,
        treasury: &mut FeeTreasury<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == vault.owner, E_NOT_OWNER);
        assert!(vault.status == STATUS_ACTIVE, E_ALREADY_RELEASED);
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
    public fun balance_value<T>(vault: &PersonalVault<T>): u64 {
        balance::value(&vault.balance)
    }

    public fun target<T>(vault: &PersonalVault<T>): u64 {
        vault.target
    }

    public fun status<T>(vault: &PersonalVault<T>): u8 {
        vault.status
    }

    public fun total_contributed<T>(vault: &PersonalVault<T>): u64 {
        vault.total_contributed
    }

    public fun owner<T>(vault: &PersonalVault<T>): address {
        vault.owner
    }
}
