import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

// ── Network ──
export const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet") });

// ── Contract addresses ──
export const PACKAGE_ID =
  "0xc238fad3b2aff0808fad37ec6d653bf85f6f1ca529cc47ff5a6b51fd09b72f3e";

// ══════════════════════════════════════════════════════
// Transaction builders — these only BUILD the tx, they
// don't sign or submit it. Signing/submitting happens via
// signAndExecute() below, which talks to our backend.
// ══════════════════════════════════════════════════════

export function txCreateCoupleVault({
  partnerB,
  target,
  triggerType, // 0 = percent, 1 = date
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
// signAndExecute — the bridge to our backend.
// Takes a built Transaction + the signed-in zkUser,
// asks our /api/sponsor and /api/execute routes to do
// the actual signing/submission via Enoki.
// ══════════════════════════════════════════════════════

export async function signAndExecute(tx, zkUser) {
  if (!zkUser?.address || !zkUser?.jwt) {
    throw new Error("Not signed in — missing zkLogin session");
  }

  // 1. Build the transaction kind bytes (unsigned)
  const txBytes = await tx.build({ client, onlyTransactionKind: true });
  const txBytesBase64 = btoa(String.fromCharCode(...txBytes));

  // 2. Ask our backend to sponsor it via Enoki
  const sponsorRes = await fetch("/api/sponsor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      network: "testnet",
      sender: zkUser.address,
      transactionKindBytes: txBytesBase64,
    }),
  });
  if (!sponsorRes.ok) {
    const err = await sponsorRes.text();
    throw new Error(`Sponsor failed: ${err}`);
  }
  const sponsored = await sponsorRes.json();
  // sponsored = { digest, bytes }

  // 3. Sign the sponsored transaction with zkLogin
  //    (Enoki's flow signs using the ephemeral key + zk proof
  //     tied to the user's JWT — this step uses the Enoki SDK
  //     on the frontend, see EnokiFlow usage in App.jsx)
  // NOTE: actual signing happens in App.jsx via useEnokiFlow()
  //       this function just returns the sponsored digest for now
  return sponsored;
}

// ── Fetch couple vault data ──
export async function fetchVault(vaultId) {
  const obj = await client.getObject({
    id: vaultId,
    options: { showContent: true },
  });
  return obj?.data?.content?.fields ?? null;
}