module couplespace::protocol_fee {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};

    // ── Error codes ──
    const E_NOT_ADMIN: u64 = 1;

    // ── Fee constant: 2% = 200 basis points ──
    const FEE_BPS: u64 = 200;
    const BPS_BASE: u64 = 10_000;

    // ── Shared treasury object ──
    public struct FeeTreasury<phantom T> has key {
        id: UID,
        admin: address,
        balance: Balance<T>,
        total_collected: u64,
    }

    // ── Admin capability ──
    public struct AdminCap has key, store {
        id: UID,
    }

    // ── Create treasury (called once on deploy) ──
    fun init(ctx: &mut TxContext) {
        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── Create a new treasury for a token type ──
    public fun create_treasury<T>(
        _cap: &AdminCap,
        ctx: &mut TxContext
    ) {
        let treasury = FeeTreasury<T> {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            balance: balance::zero<T>(),
            total_collected: 0,
        };
        transfer::share_object(treasury);
    }

    // ── Calculate 2% fee on an amount ──
    public fun calculate_fee(amount: u64): u64 {
        (amount * FEE_BPS) / BPS_BASE
    }

    // ── Calculate net amount after 2% fee ──
    public fun calculate_net(amount: u64): u64 {
        amount - calculate_fee(amount)
    }

    // ── Deduct fee from a coin, deposit into treasury, return net coin ──
    public fun deduct_fee<T>(
        treasury: &mut FeeTreasury<T>,
        payment: Coin<T>,
        ctx: &mut TxContext
    ): Coin<T> {
        let total = coin::value(&payment);
        let fee_amount = calculate_fee(total);
        let _net_amount = total - fee_amount;

        let mut payment_balance = coin::into_balance(payment);

        // Take fee into treasury
        let fee_balance = balance::split(&mut payment_balance, fee_amount);
        balance::join(&mut treasury.balance, fee_balance);
        treasury.total_collected = treasury.total_collected + fee_amount;

        // Return net coin to caller
        coin::from_balance(payment_balance, ctx)
    }

    // ── Admin withdraws collected fees ──
    public fun withdraw_fees<T>(
        treasury: &mut FeeTreasury<T>,
        cap: &AdminCap,
        ctx: &mut TxContext
    ): Coin<T> {
        assert!(treasury.admin == tx_context::sender(ctx), E_NOT_ADMIN);
        let _ = cap;
        let amount = balance::value(&treasury.balance);
        let withdrawn = balance::split(&mut treasury.balance, amount);
        coin::from_balance(withdrawn, ctx)
    }

    // ── Getters ──
    public fun total_collected<T>(treasury: &FeeTreasury<T>): u64 {
        treasury.total_collected
    }

    public fun treasury_balance<T>(treasury: &FeeTreasury<T>): u64 {
        balance::value(&treasury.balance)
    }
}
