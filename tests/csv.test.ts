import { describe, expect, it } from "vitest";

import { positionsToCsv, tradesToCsv } from "@/lib/csv";
import type { CalculatedTrade, PolymarketPosition } from "@/lib/rebate";

const trade: CalculatedTrade = {
  proxyWallet: "0xwallet",
  side: "BUY",
  asset: "asset",
  conditionId: "c1",
  size: 10,
  price: 0.5,
  timestamp: 1_780_354_000,
  title: 'Will "X, Inc" win?',
  slug: "slug",
  outcome: "Yes",
  transactionHash: "0xhash",
  eventTitle: 'Will "X, Inc" win?',
  eventSlugKey: "slug",
  rawVolume: 5,
  upside: 0.5,
  category: "crypto",
  categoryLabel: "Crypto",
  categoryWeight: 2.3,
  categorySource: "tag",
  takerFeeRate: 0.07,
  takerFee: 0.0875,
  weightedVolume: 5.75,
  feesEnabled: true
};

describe("csv export", () => {
  it("escapes quotes and commas in trade rows", () => {
    const csv = tradesToCsv([trade]);
    const lines = csv.split("\n");

    expect(lines[0]).toContain("time_utc");
    expect(lines).toHaveLength(2);
    // Title with quotes and comma must be wrapped and quotes doubled.
    expect(lines[1]).toContain('"Will ""X, Inc"" win?"');
    expect(lines[1]).toContain("2026-06-01T22:46:40.000Z");
    expect(lines[1]).toContain("BUY");
  });

  it("serializes positions with a header and rows", () => {
    const position: PolymarketPosition = {
      proxyWallet: "0xwallet",
      asset: "a1",
      conditionId: "c1",
      size: 100,
      avgPrice: 0.4,
      initialValue: 40,
      currentValue: 60,
      cashPnl: 20,
      percentPnl: 50,
      realizedPnl: 5,
      curPrice: 0.6,
      redeemable: true,
      title: "Market A",
      outcome: "Yes"
    };

    const csv = positionsToCsv([position]);
    const lines = csv.split("\n");

    expect(lines[0]).toContain("cash_pnl");
    expect(lines[1]).toContain("Market A");
    expect(lines[1]).toContain("yes");
  });
});
