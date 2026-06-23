<div align="center">

# 📊 Polymarket Taker Rebate & P/L Monitor

**See your real Polymarket performance — taker rebates, tier progress, and an honest realized-P/L curve — for any wallet. No keys. No setup. Public APIs only.**

[![CI](https://github.com/frla18cz/polymarket-taker-fee-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/frla18cz/polymarket-taker-fee-monitor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
![No API keys](https://img.shields.io/badge/API_keys-none_required-success)

</div>

---

## Why this exists

Polymarket's built-in P/L chart marks open positions to market — so if you trade fast-resolving markets (like the 5-minute crypto up/down markets), it shows wild swings into deep negative and back that **never actually happened**. Add the fact that auto-redeemed winners silently drop out of the positions API, and the numbers get confusing fast.

This dashboard fixes that. It reconstructs **realized P/L per resolved market** — pairing every buy to its redeem — so the curve only moves when money is actually won or lost. The result is a clean, truthful equity curve plus the rebate-tier metrics Polymarket doesn't surface well.

> ⚠️ **Estimates only.** Official tiers, rebate rates, category weights, and fee formulas can change without notice. Treat every number as an estimate, not an official statement.

## ✨ Features

| | |
| --- | --- |
| 🎯 **Rebate tracker** | Weighted volume, estimated tier, gap to next tier, and gross taker fees at a glance. |
| 📈 **Realized P/L curve** | Per-market realized P/L (buys paired to redeems) — **no mark-to-market noise**. Recent wins/losses fold in at their real resolution time. |
| ⏱️ **Time-scaled & interactive** | Hourly-resolution chart with hover tooltips showing exact time and value. |
| 💳 **Honest P/L cards** | Total (Polymarket profile figure), realized, unrealized, and open value — reconciled, not double-counted. |
| 📂 **Open positions** | Live positions only; resolved/auto-redeemed rows are filtered out so you see what's actually open. |
| 🔎 **Trades explorer** | Search, side & category filters, sortable columns, paging. |
| ⬇️ **CSV export** | Export trades (respects active filters) and positions for your own analysis. |
| 🔒 **Zero trust required** | Read-only, public APIs. No private keys, no CLOB credentials, no wallet connection, no database. |

## 🚀 Quick start

```bash
git clone https://github.com/frla18cz/polymarket-taker-fee-monitor.git
cd polymarket-taker-fee-monitor
npm install
cp .env.example .env.local   # optional: set a default wallet
npm run dev
```

Open **http://localhost:3000** and paste any Polymarket wallet address.

### Configuration

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_DEFAULT_WALLET` | *Optional.* Wallet the dashboard auto-loads on first paint. Leave unset to start with an empty field. |

`.env.local` is git-ignored — your wallet never gets committed.

## 🧮 How the numbers work

Built entirely on public endpoints: `data-api.polymarket.com` (`/trades`, `/positions`, `/activity`), `gamma-api.polymarket.com` (event metadata), and `lb-api.polymarket.com/profit` (profile P/L).

- **Weighted volume** — `size × price × (1 − price) × categoryWeight`.
- **Estimated taker fee** — `size × feeRate × price × (1 − price)`, rounded per trade to 5 decimals.
- **Categories** — enriched from Gamma metadata; inferred from event tags when missing (unresolved cases are flagged).
- **Realized P/L** — reconstructed per market (`conditionId`) as redeem/sell proceeds minus buy cost, ordered by resolution time. Capital sitting in still-open positions is **not** counted as a loss.
- **Total P/L** — taken from Polymarket's own profile figure so it matches the website; may differ slightly from the reconstructed realized total due to fees and activity-feed pagination.

## ⚠️ Caveats

- The public activity feed is paginated — very high-volume wallets can hit the offset limit, and the dashboard warns when realized P/L may be incomplete.
- Losing positions are often never auto-redeemed (nothing to claim) and only appear as redeemable rows; these are folded into realized P/L from the positions snapshot.

## 🛠️ Tech

Next.js (App Router) · React · TypeScript (strict) · Recharts · Vitest — public APIs only.

```bash
npm run typecheck   # types
npm test            # unit tests
npm run build       # production build
```

## 📄 License

[MIT](LICENSE) — free to use, fork, and build on.
