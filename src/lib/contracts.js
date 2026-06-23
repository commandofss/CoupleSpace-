import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

// ── Network ──
export const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet") });

// ── Contract addresses ──
export const PACKAGE_ID =
  "0xc238fad3b2aff0808fad37ec6d653bf85f6f1ca529cc47ff5a6b51fd09b72f3e";

// ══════════════════════════════════════════════════════
// Transaction builders — these only BUILD the tx.
// Signing/submitting happens via enokiFlow in App.jsx.
// ══════════════════════════════════════════════════════

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
    typeArguments: ["0x2::sui::SUI"],
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

export function txContributeCoupleVault({ vaultId, amount }) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::couple_vault::contribute`,
    typeArguments: ["0x2::sui::SUI"],
    arguments: [tx.object(vaultId), coin],
  });
  return tx;
}

export function txReleaseCoupleVault({ vaultId, treasuryId, clockId }) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::couple_vault::release`,
    typeArguments: ["0x2::sui::SUI"],
    arguments: [
      tx.object(vaultId),
      tx.object(treasuryId),
      tx.object(clockId || "0x6"),
    ],
  });
  return tx;
}

// ══════════════════════════════════════════════════════
// executeWithEnoki — uses enokiFlow to sponsor, sign,
// and execute the transaction in one call.
// ══════════════════════════════════════════════════════

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

// ── Fetch couple vault data ──
export async function fetchVault(vaultId) {
  const obj = await client.getObject({
    id: vaultId,
    options: { showContent: true },
  });
  return obj?.data?.content?.fields ?? null;
}