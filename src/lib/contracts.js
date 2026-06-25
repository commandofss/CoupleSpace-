import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

// ── Network ──
export const client = new SuiClient({ url: getFullnodeUrl("testnet") });

// ── Contract addresses ──
export const PACKAGE_ID =
  "0xc238fad3b2aff0808fad37ec6d653bf85f6f1ca529cc47ff5a6b51fd09b72f3e";

// ── Sui Clock object (always 0x6 on all networks) ──
export const CLOCK_ID = "0x6";

// ── FeeTreasury object ID for SUI type ──
// You MUST replace this with the real FeeTreasury object ID from your deployment.
// Find it on Sui Explorer: search your package ID → look for a shared object
// of type couplespace::protocol_fee::FeeTreasury<0x2::sui::SUI>
export const FEE_TREASURY_ID = "0x5f7f2901409ecc4d5921fe8602bf6d1df1b32517eb6abeb95bf3d2a8dc1a7c1e";

// ── Type argument for SUI coin ──
const SUI_TYPE = "0x2::sui::SUI";


// ══════════════════════════════════════════════════════════════
// COUPLE VAULT
// ══════════════════════════════════════════════════════════════

/**
 * Create a new couple vault (shared object, both partners can see it).
 *
 * @param {object} params
 * @param {string} params.partnerB     - Partner B's full Sui address
 * @param {number} params.target       - Savings target in MIST (1 SUI = 1_000_000_000 MIST)
 * @param {number} params.triggerType  - 0 = percent reached, 1 = date/time
 * @param {number} params.triggerValue - If TRIGGER_PERCENT: percentage (e.g. 100 = 100%).
 *                                       If TRIGGER_DATE: Unix timestamp in milliseconds.
 * @param {string} params.label        - Human-readable label for the goal
 * @param {string} params.destination  - Address that receives funds on release
 */
export function txCreateCoupleVault({
  partnerB,
  target,
  triggerType,
  triggerValue,
  label,
  destination,
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::couple_vault::create`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.pure.address(partnerB),
      tx.pure.u64(target),
      tx.pure.u8(triggerType),
      tx.pure.u64(triggerValue),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(label))),
      tx.pure.address(destination),
    ],
  });
  return tx;
}

/**
 * Contribute SUI to an existing couple vault.
 * Caller must be partner_a or partner_b.
 *
 * @param {object} params
 * @param {string} params.vaultId - Object ID of the CoupleVault
 * @param {number} params.amount  - Amount in MIST to contribute
 */
export function txContributeCoupleVault({ vaultId, amount }) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::couple_vault::contribute`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(vaultId), coin],
  });
  return tx;
}

/**
 * Release funds from a couple vault to its destination.
 * Trigger condition must be met first.
 * Caller must be partner_a or partner_b.
 *
 * @param {object} params
 * @param {string} params.vaultId    - Object ID of the CoupleVault
 * @param {string} params.treasuryId - Object ID of the FeeTreasury<SUI> (shared object)
 */
export function txReleaseCoupleVault({ vaultId, treasuryId = FEE_TREASURY_ID }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::couple_vault::release`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.object(vaultId),
      tx.object(treasuryId),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}


// ══════════════════════════════════════════════════════════════
// PERSONAL VAULT
// ══════════════════════════════════════════════════════════════

/**
 * Create a new personal vault (owned object, only you can see it).
 *
 * @param {object} params
 * @param {number} params.target       - Savings target in MIST
 * @param {number} params.triggerType  - 0 = amount threshold, 1 = date/time
 * @param {number} params.triggerValue - If TRIGGER_AMOUNT: MIST threshold.
 *                                       If TRIGGER_DATE: Unix timestamp in milliseconds.
 * @param {string} params.label        - Human-readable label
 * @param {string} params.destination  - Address that receives funds on release
 */
export function txCreatePersonalVault({
  target,
  triggerType,
  triggerValue,
  label,
  destination,
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::personal_vault::create`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.pure.u64(target),
      tx.pure.u8(triggerType),
      tx.pure.u64(triggerValue),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(label))),
      tx.pure.address(destination),
    ],
  });
  return tx;
}

/**
 * Contribute SUI to your personal vault.
 * Caller must be the vault owner.
 *
 * @param {object} params
 * @param {string} params.vaultId - Object ID of the PersonalVault
 * @param {number} params.amount  - Amount in MIST to contribute
 */
export function txContributePersonalVault({ vaultId, amount }) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::personal_vault::contribute`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(vaultId), coin],
  });
  return tx;
}

/**
 * Release funds from your personal vault.
 * Trigger condition must be met first.
 *
 * @param {object} params
 * @param {string} params.vaultId    - Object ID of the PersonalVault
 * @param {string} params.treasuryId - Object ID of the FeeTreasury<SUI>
 */
export function txReleasePersonalVault({ vaultId, treasuryId = FEE_TREASURY_ID }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::personal_vault::release`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.object(vaultId),
      tx.object(treasuryId),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}


// ══════════════════════════════════════════════════════════════
// SAVINGS CIRCLE (AJO)
// ══════════════════════════════════════════════════════════════

/**
 * Create a new savings circle (shared object).
 * Caller becomes the admin.
 *
 * @param {object} params
 * @param {string} params.name           - Circle name
 * @param {number} params.maxSize        - Maximum number of members
 * @param {number} params.contribution   - Per-round contribution in MIST
 *                                         (also used as stake amount to join)
 * @param {number} params.gracePeriodMs  - Grace period in milliseconds before payout
 */
export function txCreateSavingsCircle({
  name,
  maxSize,
  contribution,
  gracePeriodMs,
}) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::create`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(name))),
      tx.pure.u64(maxSize),
      tx.pure.u64(contribution),
      tx.pure.u64(gracePeriodMs),
    ],
  });
  return tx;
}

/**
 * Join an existing savings circle by paying stake.
 * Stake amount must equal the circle's contribution amount.
 *
 * @param {object} params
 * @param {string} params.circleId - Object ID of the SavingsCircle
 * @param {number} params.stake    - Stake amount in MIST (must equal circle.contribution)
 */
export function txJoinSavingsCircle({ circleId, stake }) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(stake)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::join`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(circleId), coin],
  });
  return tx;
}

/**
 * Admin starts the circle (moves it from PENDING to ACTIVE).
 *
 * @param {object} params
 * @param {string} params.circleId    - Object ID of the SavingsCircle
 * @param {number} params.deadlineMs  - Round deadline as Unix timestamp in milliseconds
 */
export function txStartSavingsCircle({ circleId, deadlineMs }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::start`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.object(circleId),
      tx.pure.u64(deadlineMs),
    ],
  });
  return tx;
}

/**
 * Member pays their round contribution.
 * Amount must equal circle's contribution value.
 *
 * @param {object} params
 * @param {string} params.circleId - Object ID of the SavingsCircle
 * @param {number} params.amount   - Contribution amount in MIST
 */
export function txPayRound({ circleId, amount }) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::pay_round`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(circleId), coin],
  });
  return tx;
}

/**
 * Admin triggers payout to the current slot winner.
 * Grace period must have passed.
 *
 * @param {object} params
 * @param {string} params.circleId   - Object ID of the SavingsCircle
 * @param {string} params.treasuryId - Object ID of the FeeTreasury<SUI>
 */
export function txPayoutSavingsCircle({ circleId, treasuryId = FEE_TREASURY_ID }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::payout`,
    typeArguments: [SUI_TYPE],
    arguments: [
      tx.object(circleId),
      tx.object(treasuryId),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Member claims their stake back after circle completes.
 *
 * @param {object} params
 * @param {string} params.circleId - Object ID of the SavingsCircle
 */
export function txClaimStake({ circleId }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::savings_circle::claim_stake`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(circleId)],
  });
  return tx;
}


// ══════════════════════════════════════════════════════════════
// ENOKI EXECUTOR
// ══════════════════════════════════════════════════════════════

/**
 * Signs and executes a transaction using Enoki's gas sponsorship.
 * User must be signed in via zkLogin.
 *
 * @param {Transaction} tx         - Built transaction from any tx* function above
 * @param {object}      enokiFlow  - enokiFlow instance from useEnokiFlow()
 * @returns {Promise<object>}      - Transaction result from Sui
 */
export async function executeWithEnoki(tx, enokiFlow) {
  if (!enokiFlow) {
    throw new Error("enokiFlow not available — user not signed in");
  }
  const result = await enokiFlow.sponsorAndExecuteTransaction({
    transaction: tx,
    network: "testnet",
  });
  return result;
}


// ══════════════════════════════════════════════════════════════
// READ HELPERS
// ══════════════════════════════════════════════════════════════

/**
 * Fetch fields of any vault or circle object from chain.
 *
 * @param {string} objectId - Object ID to fetch
 * @returns {object|null}   - The fields object or null if not found
 */
export async function fetchObject(objectId) {
  const obj = await client.getObject({
    id: objectId,
    options: { showContent: true },
  });
  return obj?.data?.content?.fields ?? null;
}

// Keep old name working for any existing calls in App.jsx
export const fetchVault = fetchObject;

/**
 * Fetch all objects owned by an address for a given type.
 * Useful for finding personal vaults (owned objects).
 *
 * @param {string} ownerAddress - The wallet address
 * @param {string} structType   - Full Move type, e.g.
 *   "0xPKG::personal_vault::PersonalVault<0x2::sui::SUI>"
 * @returns {Array}             - Array of objects with their fields
 */
export async function fetchOwnedObjects(ownerAddress, structType) {
  const res = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: structType },
    options: { showContent: true },
  });
  return res.data.map((item) => ({
    id: item.data?.objectId,
    fields: item.data?.content?.fields ?? {},
  }));
}

/**
 * Convenience: fetch all PersonalVault<SUI> objects owned by an address.
 */
export async function fetchPersonalVaults(ownerAddress) {
  const type = `${PACKAGE_ID}::personal_vault::PersonalVault<${SUI_TYPE}>`;
  return fetchOwnedObjects(ownerAddress, type);
}