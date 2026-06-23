# Polymarket Taker Rebate & P/L Monitor

A local-first Next.js dashboard for any Polymarket wallet. It estimates **taker-rebate weighted volume** and **tier progress**, and reconstructs **realized P/L over time** — all from public Polymarket APIs. No private keys, no CLOB credentials, no database.

> ⚠️ Estimates only. Official tiers, rebate rates, category weights, and fee formulas can change without notice. Treat every number here as an estimate, not an official statement.

## Features

- **Taker rebate estimate** — weighted volume, estimated tier, gap to next tier, gross taker fees.
- **Interactive activity chart** — daily weighted volume / raw volume / fees / trade count, with a cumulative line and hover tooltips.
- **Cumulative realized P/L chart** — realized P/L per resolved market (buys paired to their redeems), so there is no mark-to-market noise. Settled-but-not-yet-redeemed markets are folded in at their real resolution time, so recent wins/losses show up. Time-scaled x-axis with hourly hover.
- **P/L cards** — total P/L (Polymarket profile figure), realized P/L, unrealized P/L, open value.
- **Open positions table** — live positions only (resolved/redeemed rows are excluded since Polymarket drops auto-redeemed winners from the positions snapshot).
- **Trades table** — search, side/category filters, sortable columns, paging.
- **CSV export** — trades (respects active filters) and positions.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: set a default wallet
npm run dev
```

Open `http://localhost:3000` and paste a wallet address (or set one in `.env.local`).

### Configuration

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_DEFAULT_WALLET` | Optional. Wallet the dashboard auto-loads on first paint. Leave unset to start with an empty field. |

`.env.local` is git-ignored, so your wallet never gets committed.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## How the numbers are computed

Public APIs used: `data-api.polymarket.com` (`/trades`, `/positions`, `/activity`), `gamma-api.polymarket.com` (event metadata), and `lb-api.polymarket.com/profit` (profile P/L).

- **Weighted volume:** `size * price * (1 - price) * categoryWeight`.
- **Estimated taker fee:** `size * feeRate * price * (1 - price)`, rounded per trade to 5 decimals.
- **Categories** are enriched from Gamma event metadata; when missing, inferred from event tags (unresolved cases are flagged as warnings).
- **Realized P/L** is reconstructed per market (`conditionId`) as redeem/sell proceeds minus buy cost, ordered by resolution time. Capital sitting in still-open positions is *not* counted as a loss.
- **Total P/L** is taken from Polymarket's own profile figure (`lb-api/profit`), so it matches the website. It can differ slightly from the reconstructed realized total because of fees and the public activity feed's pagination limits.

## Caveats

- The public activity feed is paginated; very high-volume wallets may hit the offset limit (the dashboard shows a warning when that happens), which makes the realized P/L curve incomplete.
- Losing positions are sometimes never auto-redeemed (nothing to claim) and only appear as redeemable rows in the positions snapshot; these are folded into realized P/L from that snapshot.

## Tech

Next.js (App Router) · React · TypeScript · Recharts · Vitest. Public APIs only.
