// api/execute.js
// Runs on Vercel's server — never exposed to the browser.
// Takes the sponsored transaction digest + the user's zkLogin signature,
// and asks Enoki to execute it on-chain.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { digest, signature } = req.body;

  if (!digest || !signature) {
    return res.status(400).json({ error: "Missing digest or signature" });
  }

  try {
    const response = await fetch(
      `https://api.enoki.mystenlabs.com/v1/transaction-blocks/sponsor/${digest}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.ENOKI_PRIVATE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signature }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Enoki execute error:", errText);
      return res.status(response.status).json({ error: "Enoki execute failed", detail: errText });
    }

    const data = await response.json();
    return res.status(200).json(data.data);
  } catch (err) {
    console.error("execute.js error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}