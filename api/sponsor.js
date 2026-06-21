// api/sponsor.js
// Runs on Vercel's server — never exposed to the browser.
// Takes a built transaction (kind bytes) from the frontend, asks Enoki to
// sponsor it (pay gas), and returns the sponsored transaction info.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { network, sender, transactionKindBytes, allowedAddresses, allowedMoveCallTargets } = req.body;

  if (!sender || !transactionKindBytes) {
    return res.status(400).json({ error: "Missing sender or transactionKindBytes" });
  }

  try {
    const response = await fetch("https://api.enoki.mystenlabs.com/v1/transaction-blocks/sponsor", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.ENOKI_PRIVATE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        network: network || "testnet",
        sender,
        transactionKindBytes,
        allowedAddresses: allowedAddresses || [sender],
        allowedMoveCallTargets: allowedMoveCallTargets || [],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Enoki sponsor error:", errText);
      return res.status(response.status).json({ error: "Enoki sponsor failed", detail: errText });
    }

    const data = await response.json();
    return res.status(200).json(data.data);
  } catch (err) {
    console.error("sponsor.js error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}