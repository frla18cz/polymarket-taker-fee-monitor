import { describe, expect, it, vi } from "vitest";

import { buildRebateReport, type FetchLike } from "@/lib/polymarket";
import type { GammaEvent, PolymarketPosition, PolymarketTrade } from "@/lib/rebate";

describe("polymarket public API aggregation", () => {
  it("builds a report from mocked Data API trades and Gamma event metadata", async () => {
    const trade: PolymarketTrade = {
      proxyWallet: "0xad476391891f228f7f009fc9b93d5a8b71bbba74",
      side: "BUY",
      asset: "asset",
      conditionId: "0x3951ba147147c24acfdd0b7522c78b325822ecf092ff195a65d5d76dca5abf27",
      size: 50,
      price: 0.5,
      timestamp: 1_780_354_000,
      title: "Bitcoin Up or Down",
      slug: "btc-updown-5m-1780353900",
      eventSlug: "btc-updown-5m-1780353900",
      outcome: "Up",
      transactionHash: "0xhash"
    };
    const event: GammaEvent = {
      slug: trade.eventSlug,
      title: trade.title,
      category: null,
      tags: [{ label: "Crypto", slug: "crypto" }],
      markets: [
        {
          conditionId: trade.conditionId,
          slug: trade.slug,
          feesEnabled: true,
          takerBaseFee: 1000
        }
      ]
    };

    const position: PolymarketPosition = {
      proxyWallet: trade.proxyWallet,
      asset: trade.asset,
      conditionId: trade.conditionId,
      size: 50,
      avgPrice: 0.5,
      initialValue: 25,
      currentValue: 40,
      cashPnl: 15,
      percentPnl: 60,
      realizedPnl: 5,
      curPrice: 0.8,
      redeemable: false,
      title: trade.title,
      slug: trade.slug,
      outcome: "Up"
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.startsWith("https://data-api.polymarket.com/trades")) {
        return Response.json([trade]);
      }

      if (url.startsWith("https://data-api.polymarket.com/positions")) {
        return Response.json([position]);
      }

      if (url.startsWith("https://data-api.polymarket.com/activity")) {
        return Response.json([
          {
            type: "TRADE",
            side: "BUY",
            conditionId: trade.conditionId,
            usdcSize: 25,
            timestamp: trade.timestamp - 100,
            transactionHash: "0xbuy",
            asset: "asset",
            size: 50
          },
          {
            type: "REDEEM",
            conditionId: trade.conditionId,
            usdcSize: 30,
            timestamp: trade.timestamp - 50,
            transactionHash: "0xredeem",
            asset: "",
            size: 30
          }
        ]);
      }

      if (url.startsWith("https://lb-api.polymarket.com/profit")) {
        return Response.json([{ proxyWallet: trade.proxyWallet, amount: 12.75 }]);
      }

      if (url.startsWith("https://gamma-api.polymarket.com/events/slug/")) {
        return Response.json(event);
      }

      return new Response("Not found", { status: 404 });
    }) as FetchLike;

    const report = await buildRebateReport({
      wallet: trade.proxyWallet,
      range: {
        startSec: trade.timestamp - 60,
        endSec: trade.timestamp + 60,
        mode: "custom",
        days: 1
      },
      generatedAt: new Date("2026-06-01T23:00:00Z"),
      fetchImpl: fetchMock
    });

    expect(report.totals.tradeCount).toBe(1);
    expect(report.totals.rawVolume).toBe(25);
    expect(report.totals.weightedVolume).toBeCloseTo(28.75);
    expect(report.totals.takerFeesPaid).toBeCloseTo(0.875);
    expect(report.api.tradePages).toBe(1);
    expect(report.api.eventFetches).toBe(1);
    expect(report.positions?.totals.unrealizedPnl).toBe(15);
    expect(report.positions?.totals.openCount).toBe(1);
    expect(report.positions?.totals.resolvedExcluded).toBe(0);
    expect(report.realizedTotal).toBe(5);
    expect(report.resolvedMarkets).toBe(1);
    expect(report.losingMarkets).toBe(0);
    expect(report.pnlHistory).toHaveLength(1);
    expect(report.pnlHistory?.[0].p).toBe(5);
    expect(report.profitTotal).toBe(12.75);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("keeps the report usable when the positions endpoint fails", async () => {
    const trade: PolymarketTrade = {
      proxyWallet: "0xad476391891f228f7f009fc9b93d5a8b71bbba74",
      side: "BUY",
      asset: "asset",
      conditionId: "0x3951ba147147c24acfdd0b7522c78b325822ecf092ff195a65d5d76dca5abf27",
      size: 50,
      price: 0.5,
      timestamp: 1_780_354_000,
      title: "Bitcoin Up or Down",
      slug: "btc-updown-5m-1780353900",
      eventSlug: "btc-updown-5m-1780353900",
      outcome: "Up",
      transactionHash: "0xhash"
    };
    const event: GammaEvent = {
      slug: trade.eventSlug,
      title: trade.title,
      tags: [{ label: "Crypto", slug: "crypto" }],
      markets: [{ conditionId: trade.conditionId, slug: trade.slug, feesEnabled: true, takerBaseFee: 1000 }]
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.startsWith("https://data-api.polymarket.com/trades")) {
        return Response.json([trade]);
      }

      if (url.startsWith("https://data-api.polymarket.com/positions")) {
        return new Response("Server error", { status: 500 });
      }

      if (url.startsWith("https://gamma-api.polymarket.com/events/slug/")) {
        return Response.json(event);
      }

      return new Response("Not found", { status: 404 });
    }) as FetchLike;

    const report = await buildRebateReport({
      wallet: trade.proxyWallet,
      range: { startSec: trade.timestamp - 60, endSec: trade.timestamp + 60, mode: "custom", days: 1 },
      generatedAt: new Date("2026-06-01T23:00:00Z"),
      fetchImpl: fetchMock
    });

    expect(report.totals.tradeCount).toBe(1);
    expect(report.positions).toBeNull();
    expect(report.warnings.some((warning) => warning.includes("Positions could not be loaded"))).toBe(true);
  });
});
