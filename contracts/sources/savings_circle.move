module couplespace::savings_circle {

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::clock::{Self, Clock};
    use sui::vec_map::{Self, VecMap};
    use couplespace::protocol_fee::{Self, FeeTreasury};

    // ── Error codes ──
    const E_NOT_ADMIN:         u64 = 1;
    const E_NOT_MEMBER:        u64 = 2;
    const E_ALREADY_MEMBER:    u64 = 3;
    const E_CIRCLE_FULL:       u64 = 4;
    const E_ALREADY_PAID:      u64 = 5;
    const E_CIRCLE_NOT_ACTIVE: u64 = 6;
    const E_GRACE_PERIOD:      u64 = 8;
    const E_ALREADY_EJECTED:   u64 = 9;
    const E_WRONG_AMOUNT:      u64 = 10;

    // ── Status ──
    const STATUS_PENDING:  u8 = 0;
    const STATUS_ACTIVE:   u8 = 1;
    const STATUS_COMPLETE: u8 = 2;

    // ── Max misses before ejection ──
    const MAX_MISSES: u64 = 2;

    // ── Member info ──
    public struct Member has store, drop {
        addr: address,
        slot: u64,
        paid_this_round: bool,
        misses: u64,
        received_payout: bool,
        stake: u64,
        ejected: bool,
    }

    // ── Shared circle object ──
    public struct SavingsCircle<phantom T> has key {
        id: UID,
        admin: address,
        name: vector<u8>,
        max_size: u64,
        contribution: u64,
        grace_period_ms: u64,
        balance: Balance<T>,
        stake_balance: Balance<T>,
        members: VecMap<address, Member>,
        slot_order: vector<address>,
        current_round: u64,
        current_slot: u64,
        round_deadline_ms: u64,
        status: u8,
        total_paid_out: u64,
    }

    // ── Create a new circle ──
    public fun create<T>(
        name: vector<u8>,
        max_size: u64,
        contribution: u64,
        grace_period_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let circle = SavingsCircle<T> {
            id: object::new(ctx),
            admin: sender,
            name,
            max_size,
            contribution,
            grace_period_ms,
            balance: balance::zero<T>(),
            stake_balance: balance::zero<T>(),
            members: vec_map::empty(),
            slot_order: vector[],
            current_round: 0,
            current_slot: 0,
            round_deadline_ms: 0,
            status: STATUS_PENDING,
            total_paid_out: 0,
        };
        transfer::share_object(circle);
    }

    // ── Join circle with stake ──
    public fun join<T>(
        circle: &mut SavingsCircle<T>,
        stake: Coin<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(circle.status == STATUS_PENDING, E_CIRCLE_NOT_ACTIVE);
        assert!(!vec_map::contains(&circle.members, &sender), E_ALREADY_MEMBER);
        assert!(vec_map::length(&circle.members) < circle.max_size, E_CIRCLE_FULL);
        assert!(coin::value(&stake) == circle.contribution, E_WRONG_AMOUNT);

        let slot = vec_map::length(&circle.members) + 1;
        let stake_amount = coin::value(&stake);

        let member = Member {
            addr: sender,
            slot,
            paid_this_round: false,
            misses: 0,
            received_payout: false,
            stake: stake_amount,
            ejected: false,
        };

        vec_map::insert(&mut circle.members, sender, member);
        vector::push_back(&mut circle.slot_order, sender);

        let stake_balance = coin::into_balance(stake);
        balance::join(&mut circle.stake_balance, stake_balance);
    }

    // ── Admin starts the circle ──
    public fun start<T>(
        circle: &mut SavingsCircle<T>,
        deadline_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == circle.admin, E_NOT_ADMIN);
        assert!(circle.status == STATUS_PENDING, E_CIRCLE_NOT_ACTIVE);

        circle.status = STATUS_ACTIVE;
        circle.current_round = 1;
        circle.current_slot = 0;
        circle.round_deadline_ms = deadline_ms;
    }

    // ── Member pays their round contribution ──
    public fun pay_round<T>(
        circle: &mut SavingsCircle<T>,
        payment: Coin<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(circle.status == STATUS_ACTIVE, E_CIRCLE_NOT_ACTIVE);
        assert!(vec_map::contains(&circle.members, &sender), E_NOT_MEMBER);
        assert!(coin::value(&payment) == circle.contribution, E_WRONG_AMOUNT);

        let member = vec_map::get_mut(&mut circle.members, &sender);
        assert!(!member.ejected, E_ALREADY_EJECTED);
        assert!(!member.paid_this_round, E_ALREADY_PAID);

        member.paid_this_round = true;

        let payment_balance = coin::into_balance(payment);
        balance::join(&mut circle.balance, payment_balance);
    }

    // ── Admin triggers payout to current slot winner ──
    public fun payout<T>(
        circle: &mut SavingsCircle<T>,
        treasury: &mut FeeTreasury<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == circle.admin, E_NOT_ADMIN);
        assert!(circle.status == STATUS_ACTIVE, E_CIRCLE_NOT_ACTIVE);

        // Grace period must have passed
        let now = clock::timestamp_ms(clock);
        assert!(now >= circle.round_deadline_ms + circle.grace_period_ms, E_GRACE_PERIOD);

        // Mark misses for non-payers
        let size = vec_map::length(&circle.members);
        let mut i = 0;
        while (i < size) {
            let (_, member) = vec_map::get_entry_by_idx_mut(&mut circle.members, i);
            if (!member.paid_this_round && !member.ejected) {
                member.misses = member.misses + 1;
                if (member.misses >= MAX_MISSES) {
                    member.ejected = true;
                };
            };
            i = i + 1;
        };

        // Find winner for this slot
        let winner_addr = *vector::borrow(&circle.slot_order, circle.current_slot);
        let winner_member = vec_map::get_mut(&mut circle.members, &winner_addr);
        winner_member.received_payout = true;

        // Calculate pool and pay out
        let pool = balance::value(&circle.balance);
        let pool_balance = balance::split(&mut circle.balance, pool);
        let pool_coin = coin::from_balance(pool_balance, ctx);

        // Deduct 2% fee
        let net_coin = protocol_fee::deduct_fee(treasury, pool_coin, ctx);
        circle.total_paid_out = circle.total_paid_out + coin::value(&net_coin);

        transfer::public_transfer(net_coin, winner_addr);

        // Advance to next round
        circle.current_slot = circle.current_slot + 1;
        circle.current_round = circle.current_round + 1;

        // Reset paid status for next round
        let size2 = vec_map::length(&circle.members);
        let mut j = 0;
        while (j < size2) {
            let (_, member) = vec_map::get_entry_by_idx_mut(&mut circle.members, j);
            member.paid_this_round = false;
            j = j + 1;
        };

        // Check if all slots done
        if (circle.current_slot >= vector::length(&circle.slot_order)) {
            circle.status = STATUS_COMPLETE;
        };
    }

    // ── Return stake to member after circle completes ──
    #[allow(lint(self_transfer))]
    public fun claim_stake<T>(
        circle: &mut SavingsCircle<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(circle.status == STATUS_COMPLETE, E_CIRCLE_NOT_ACTIVE);
        assert!(vec_map::contains(&circle.members, &sender), E_NOT_MEMBER);

        let member = vec_map::get_mut(&mut circle.members, &sender);
        assert!(!member.ejected, E_ALREADY_EJECTED);
        assert!(member.stake > 0, E_NOT_MEMBER);

        let stake_amount = member.stake;
        member.stake = 0;

        let stake_balance = balance::split(&mut circle.stake_balance, stake_amount);
        let stake_coin = coin::from_balance(stake_balance, ctx);
        transfer::public_transfer(stake_coin, sender);
    }

    // ── Getters ──
    public fun pool_balance<T>(circle: &SavingsCircle<T>): u64 {
        balance::value(&circle.balance)
    }

    public fun current_round<T>(circle: &SavingsCircle<T>): u64 {
        circle.current_round
    }

    public fun status<T>(circle: &SavingsCircle<T>): u8 {
        circle.status
    }

    public fun member_count<T>(circle: &SavingsCircle<T>): u64 {
        vec_map::length(&circle.members)
    }

    public fun is_member<T>(circle: &SavingsCircle<T>, addr: address): bool {
        vec_map::contains(&circle.members, &addr)
    }
}
