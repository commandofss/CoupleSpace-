# 💜 CoupleSpace

> **Sui Overflow 2026 Hackathon Submission**

CoupleSpace is a relationship-focused DeFi app built on the Sui blockchain. It lets couples and communities save money together using on-chain smart contracts — not frontend promises. Every rule is enforced by Move smart contracts deployed on Sui Testnet.

---

## 🔗 Links

| | |
|---|---|
| 🌐 **Live Demo** | [couplespace-eight.vercel.app](https://couplespace-eight.vercel.app) |
| 📦 **Package ID** | `0xc238fad3b2aff0808fad37ec6d653bf85f6f1ca529cc47ff5a6b51fd09b72f3e` |
| 🏦 **FeeTreasury** | `0x5f7f2901409ecc4d5921fe8602bf6d1df1b32517eb6abeb95bf3d2a8dc1a7c1e` |
| 🔍 **Explorer** | [View on Sui Testnet Explorer](https://suiexplorer.com/object/0xc238fad3b2aff0808fad37ec6d653bf85f6f1ca529cc47ff5a6b51fd09b72f3e?network=testnet) |
| 🌍 **Network** | Sui Testnet |

---

## 🎯 What It Does

CoupleSpace has three core on-chain features:

### 💑 Couple Savings Pool
A shared savings vault between two partners. Both can contribute SUI. Funds are locked until a programmable trigger is met — either a funding percentage or a date — then released to a pre-agreed destination with a 2% protocol fee deducted automatically.

### 🔒 Personal Vault
A private solo savings vault, invisible to your partner. You set a target amount or unlock date. When the trigger fires, your funds are released back to you. Only the owner can see and interact with this vault.

### 🔄 Savings Circle (Ajo / Esusu)
A rotating savings group inspired by the African Ajo/Esusu tradition. Members join by paying a stake, contribute each round, and take turns receiving the full pool. Late payers are tracked — two missed rounds leads to automatic ejection. Stakes are returned after the circle completes.

---

## ✅ On-Chain Feature Summary

| Feature | On-Chain | Description |
|---------|----------|-------------|
| Couple Savings Pool | ✅ | Shared vault with percent or date trigger |
| Personal Vault | ✅ | Private owned object, only you can see it |
| Savings Circle | ✅ | Rotating Ajo/Esusu with staking and ejection |
| 2% Protocol Fee | ✅ | Auto-deducted on every release via FeeTreasury |
| zkLogin Auth | ✅ | Sign in with Google — no seed phrase needed |
| Gas Sponsorship | ✅ | Enoki sponsors all transactions for users |

---

## 🏗 Architecture

```
User Browser (React + Vite)
       │
       ├── zkLogin via Enoki (Google OAuth → Sui address)
       ├── Transaction builders (src/lib/contracts.js)
       └── EnokiFlow.sponsorAndExecuteTransaction()
       │
       ▼
Sui Testnet (Move Smart Contracts)
       ├── protocol_fee.move   → 2% fee treasury
       ├── couple_vault.move   → shared savings pool
       ├── personal_vault.move → private solo vault
       └── savings_circle.move → Ajo/Esusu rotation
       
Supabase (off-chain)
       ├── Chat messages
       └── Memory/media storage
```

---

## 📁 Project Structure

```
CoupleSpace/
├── public/                   # PWA assets (manifest, icons, sw.js)
├── src/
│   ├── App.jsx               # Main React app (all screens)
│   ├── main.jsx              # Entry point with providers
│   ├── index.css             # Global styles
│   └── lib/
│       ├── contracts.js      # Sui transaction builders
│       └── supabaseClient.js # Supabase config
├── contracts/
│   ├── Move.toml             # Move package config
│   └── sources/
│       ├── protocol_fee.move
│       ├── couple_vault.move
│       ├── personal_vault.move
│       └── savings_circle.move
├── index.html                # PWA-enabled HTML entry
├── package.json
├── vite.config.js
└── README.md
```

---

## 🔐 Smart Contracts (Move)

All contracts are deployed and verified on Sui Testnet.

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `protocol_fee` | 2% fee treasury, shared object | `create_treasury()`, `deduct_fee()`, `withdraw_fees()` |
| `couple_vault` | Shared savings for 2 partners | `create()`, `contribute()`, `release()` |
| `personal_vault` | Private solo savings vault | `create()`, `contribute()`, `release()` |
| `savings_circle` | Ajo/Esusu rotating savings | `create()`, `join()`, `start()`, `pay_round()`, `payout()`, `claim_stake()` |

### Release Triggers

**Couple Vault:**
- `TRIGGER_PERCENT (0)` — releases when balance reaches X% of target
- `TRIGGER_DATE (1)` — releases after a Unix timestamp (ms)

**Personal Vault:**
- `TRIGGER_AMOUNT (0)` — releases when balance reaches target amount
- `TRIGGER_DATE (1)` — releases after a Unix timestamp (ms)

### Fee Structure
- 2% fee deducted on every `release()` and `payout()`
- Fee goes to the shared `FeeTreasury` object
- Admin can withdraw collected fees via `withdraw_fees()`

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite 5 |
| Auth | zkLogin via Enoki (Google OAuth) |
| Sui SDK | `@mysten/sui` v2.19, `@mysten/enoki` v1.0.8, `@mysten/dapp-kit` v1.1.1 |
| Smart Contracts | Move (Sui 2024 edition) |
| Database | Supabase (chat, memories) |
| Hosting | Vercel |
| PWA | Web Manifest + Service Worker |

---

## 🚀 Run Locally

```bash
# 1. Clone the repo
git clone https://github.com/commandofss/CoupleSpace-.git
cd CoupleSpace-

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
# Fill in your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start dev server
npm run dev
# Opens at http://localhost:3000
```

---

## 🔑 Environment Variables

Create a `.env` file in the root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The Enoki API key and Google Client ID are currently in the source for demo purposes.

---

## 👤 Team

| | |
|---|---|
| **Builder** | @commandofss |
| **Deployer Wallet** | `0xfe7f21df1b4267f709861bf688ab7f1e87457c3c2b7f30f982e7fab3a9edff4c` |

---

## 📜 License

MIT