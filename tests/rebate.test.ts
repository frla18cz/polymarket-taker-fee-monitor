import { describe, expect, it } from "vitest";

import {
  aggregatePositions,
  aggregateRebateReport,
  buildClosedPositions,
  buildRealizedPnl,
  calculateTrade,
  getTier,
  inferTradeCategory,
  parseCryptoAsset,
  pnlTotal,
  type ActivityEvent,
  type GammaEvent,
  type PolymarketPosition,
  type PolymarketTrade
} from "@/lib/rebate";

const cryptoTrade: PolymarketTrade = {
  proxyWallet: "0xad476391891f228f7f009fc9b93d5a8b71bbba74",
  side: "BUY",
  asset: "105849665155253726791263554024599817399455074291360543118555639376691673555833",
  conditionId: "0x3951ba147147c24acfdd0b7522c78b325822ecf092ff195a65d5d76dca5abf27",
  size: 18,
  price: 0.94,
  timestamp: 1_780_354_042,
  title: "Bitcoin Up or Down - June 1, 6:45PM-6:50PM ET",
  slug: "btc-updown-5m-1780353900",
  eventSlug: "btc-updown-5m-1780353900",
  outcome: "Up",
  transactionHash: "0x61cc235f353190deb34ef9800e3a6da9f993094d37cc241f76011b1539c41632"
};

const cryptoEvent: GammaEvent = {
  slug: "btc-updown-5m-1780353900",
  title: "Bitcoin Up or Down - June 1, 6:45PM-6:50PM ET",
  category: null,
  tags: [
    { label: "Bitcoin", slug: "bitcoin" },
    { label: "Crypto Prices", slug: "crypto-prices" },
    { label: "Crypto", slug: "crypto" }
  ],
  markets: [
    {
      conditionId: cryptoTrade.conditionId,
      slug: cryptoTrade.slug,
      feesEnabled: true,
      takerBaseFee: 1000
    }
  ]
};

describe("rebate math", () => {
  it("calculates weighted volume from the public trade fields", () => {
    const calculated = calculateTrade(cryptoTrade, cryptoEvent);

    expect(calculated).not.toBeNull();
    expect(calculated?.rawVolume).toBeCloseTo(16.92);
    expect(calculated?.upside).toBeCloseTo(0.06);
    expect(calculated?.category).toBe("crypto");
    expect(calculated?.categoryWeight).toBe(2.3);
    expect(calculated?.takerFeeRate).toBe(0.07);
    expect(calculated?.takerFee).toBeCloseTo(0.07106);
    expect(calculated?.weightedVolume).toBeCloseTo(2.33496);
  });

  it("returns zero weighted volume for fee-disabled markets", () => {
    const freeEvent: GammaEvent = {
      slug: "world-event",
      category: "Politics",
      markets: [
        {
          conditionId: cryptoTrade.conditionId,
          feesEnabled: false,
          takerBaseFee: 0
        }
      ]
    };

    const category = inferTradeCategory(cryptoTrade, freeEvent);
    const calculated = calculateTrade(cryptoTrade, freeEvent);

    expect(category.category).toBe("geopolitics");
    expect(category.source).toBe("fee_disabled");
    expect(calculated?.takerFee).toBe(0);
    expect(calculated?.weightedVolume).toBe(0);
  });

  it("falls back to Other when no category metadata is usable", () => {
    const category = inferTradeCategory(cryptoTrade, {
      slug: cryptoTrade.slug,
      tags: [{ label: "Recurring", slug: "recurring" }],
      markets: []
    });

    expect(category.category).toBe("other");
    expect(category.source).toBe("fallback");
  });
});

describe("tiers", () => {
  it("maps weighted volume to the current and next tier", () => {
    expect(getTier(1_999).current.name).toBe("None");
    expect(getTier(2_000).current.name).toBe("Bronze");
    expect(getTier(20_000).current.name).toBe("Silver");
    expect(getTier(10_000_000).current.name).toBe("Obsidian");
    expect(getTier(10_000_000).next).toBeNull();
  });
});

describe("report aggregation", () => {
  it("filters the selected interval and groups daily, category, and event stats", () => {
    const outsideTrade: PolymarketTrade = {
      ...cryptoTrade,
      timestamp: cryptoTrade.timestamp - 90_000,
      transactionHash: "0xoutside"
    };

    const report = aggregateRebateReport({
      wallet: cryptoTrade.proxyWallet,
      trades: [outsideTrade, cryptoTrade],
      eventsBySlug: {
        [cryptoTrade.eventSlug ?? cryptoTrade.slug]: cryptoEvent
      },
      range: {
        startSec: cryptoTrade.timestamp - 60,
        endSec: cryptoTrade.timestamp + 60,
        days: 1,
        mode: "custom"
      },
      generatedAt: new Date("2026-06-01T22:55:00Z")
    });

    expect(report.totals.tradeCount).toBe(1);
    expect(report.totals.weightedVolume).toBeCloseTo(2.33496);
    expect(report.totals.takerFeesPaid).toBeCloseTo(0.07106);
    expect(report.categories).toHaveLength(1);
    expect(report.categories[0].category).toBe("crypto");
    expect(report.topEvents[0].eventSlug).toBe(cryptoTrade.eventSlug);
    expect(report.daily.some((day) => day.tradeCount === 1)).toBe(true);
    expect(report.daily.find((day) => day.tradeCount === 1)?.takerFee).toBeCloseTo(0.07106);
    expect(report.positions).toBeNull();
  });
});

describe("positions aggregation", () => {
  const basePosition: PolymarketPosition = {
    proxyWallet: "0xad476391891f228f7f009fc9b93d5a8b71bbba74",
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
    redeemable: false,
    title: "Market A"
  };

  it("sums only open positions and excludes resolved/redeemed ones", () => {
    const openSmall: PolymarketPosition = {
      ...basePosition,
      asset: "a2",
      conditionId: "c2",
      currentValue: 10,
      initialValue: 8,
      cashPnl: 2,
      redeemable: false,
      title: "Market B"
    };
    const resolvedLoser: PolymarketPosition = {
      ...basePosition,
      asset: "a3",
      conditionId: "c3",
      curPrice: 0,
      currentValue: 0,
      cashPnl: -40,
      redeemable: true,
      title: "Resolved loser"
    };

    const summary = aggregatePositions([openSmall, basePosition, resolvedLoser]);

    expect(summary.items).toHaveLength(2);
    expect(summary.items.some((item) => item.title === "Resolved loser")).toBe(false);
    expect(summary.items[0].title).toBe("Market A");
    expect(summary.totals.currentValue).toBe(70);
    expect(summary.totals.unrealizedPnl).toBe(22);
    expect(summary.totals.openCount).toBe(2);
    expect(summary.totals.resolvedExcluded).toBe(1);
  });

  it("ignores zero-size positions", () => {
    const summary = aggregatePositions([basePosition, { ...basePosition, asset: "a4", size: 0 }]);
    expect(summary.totals.openCount).toBe(1);
  });
});

describe("pnl history", () => {
  it("returns the last cumulative point as the total P/L", () => {
    expect(pnlTotal([{ t: 1, p: 5 }, { t: 2, p: -3.5 }])).toBe(-3.5);
    expect(pnlTotal([])).toBeNull();
    expect(pnlTotal(null)).toBeNull();
  });
});

describe("realized pnl from activity", () => {
  it("pairs buys to redeems per market and ignores still-open positions", () => {
    const events: ActivityEvent[] = [
      // Won market: bought 99, redeemed 100 -> +1
      { type: "TRADE", side: "BUY", conditionId: "win", usdcSize: 99, timestamp: 100 },
      { type: "REDEEM", conditionId: "win", usdcSize: 100, timestamp: 200 },
      // Lost market: bought 30, redeemed 0 -> -30
      { type: "TRADE", side: "BUY", conditionId: "loss", usdcSize: 30, timestamp: 150 },
      { type: "REDEEM", conditionId: "loss", usdcSize: 0, timestamp: 250 },
      // Still-open market: only a buy, must NOT count as a loss
      { type: "TRADE", side: "BUY", conditionId: "open", usdcSize: 40, timestamp: 300 }
    ];

    const realized = buildRealizedPnl(events);

    expect(realized.resolvedMarkets).toBe(2);
    expect(realized.losingMarkets).toBe(1);
    expect(realized.realizedTotal).toBeCloseTo(-29);
    // Cumulative, ordered by resolution time: +1 then -30.
    expect(realized.series.map((point) => point.p)).toEqual([1, -29]);
    expect(realized.series[0].t).toBe(200);
  });

  it("folds in settled-but-unredeemed positions and avoids double counting", () => {
    const events: ActivityEvent[] = [
      { type: "TRADE", side: "BUY", conditionId: "win", usdcSize: 99, timestamp: 100 },
      { type: "REDEEM", conditionId: "win", usdcSize: 100, timestamp: 200 }
    ];
    const base = {
      proxyWallet: "0x1",
      asset: "a",
      size: 50,
      avgPrice: 0.99,
      currentValue: 0,
      cashPnl: 0,
      percentPnl: 0,
      realizedPnl: 0,
      redeemable: true,
      title: "t"
    };
    const positions: PolymarketPosition[] = [
      // Recent losing market, resolved but not yet auto-redeemed (no REDEEM event).
      { ...base, conditionId: "pending-loss", curPrice: 0, initialValue: 49.5, endDate: "2026-06-23T10:00:00Z" },
      // Already redeemed market also present in /positions must NOT be counted twice.
      { ...base, conditionId: "win", curPrice: 1, initialValue: 99, endDate: "2026-06-23T09:00:00Z" }
    ];

    const realized = buildRealizedPnl(events, positions);

    expect(realized.resolvedMarkets).toBe(2);
    expect(realized.losingMarkets).toBe(1);
    // +1 from the redeemed win, -49.5 from the pending loss.
    expect(realized.realizedTotal).toBeCloseTo(-48.5);
  });
});

describe("crypto asset parsing", () => {
  it("extracts the token from updown slugs and maps known symbols", () => {
    expect(parseCryptoAsset("btc-updown-5m-1782222300")).toEqual({ asset: "BTC", isCrypto: true });
    expect(parseCryptoAsset("hype-updown-5m-1782222300")).toEqual({ asset: "HYPE", isCrypto: true });
    expect(parseCryptoAsset("doge-updown-5m-1782222300")).toEqual({ asset: "DOGE", isCrypto: true });
  });

  it("uppercases unknown updown tokens instead of failing", () => {
    expect(parseCryptoAsset("ada-updown-5m-1")).toEqual({ asset: "ADA", isCrypto: true });
    expect(parseCryptoAsset("wif-updown-5m-1")).toEqual({ asset: "WIF", isCrypto: true });
  });

  it("flags non-crypto markets", () => {
    expect(parseCryptoAsset("will-trump-win-2028")).toEqual({ asset: "—", isCrypto: false });
    expect(parseCryptoAsset(null)).toEqual({ asset: "—", isCrypto: false });
  });
});

describe("closed positions", () => {
  it("enriches resolved markets with asset, direction, entry price and proceeds", () => {
    const trades: PolymarketTrade[] = [
      { ...cryptoTrade, conditionId: "win", slug: "eth-updown-5m-1", eventSlug: "eth-updown-5m-1", outcome: "Up", size: 100, price: 0.99 },
      { ...cryptoTrade, conditionId: "loss", slug: "doge-updown-5m-2", eventSlug: "doge-updown-5m-2", outcome: "Down", size: 50, price: 0.98 }
    ];
    const markets = [
      { conditionId: "win", pnl: 1, resolvedAt: 200 },
      { conditionId: "loss", pnl: -49, resolvedAt: 250 }
    ];

    const closed = buildClosedPositions(markets, trades);

    expect(closed).toHaveLength(2);
    // Sorted by resolvedAt desc.
    const win = closed.find((position) => position.conditionId === "win");
    expect(win?.asset).toBe("ETH");
    expect(win?.direction).toBe("Up");
    expect(win?.isCrypto).toBe(true);
    expect(win?.entryPrice).toBeCloseTo(0.99);
    expect(win?.cost).toBeCloseTo(99);
    expect(win?.proceeds).toBeCloseTo(100);
    expect(win?.realizedPnl).toBe(1);

    const loss = closed.find((position) => position.conditionId === "loss");
    expect(loss?.asset).toBe("DOGE");
    expect(loss?.direction).toBe("Down");
    expect(loss?.realizedPnl).toBe(-49);
  });

  it("falls back to the positions snapshot when trades are missing", () => {
    const position: PolymarketPosition = {
      proxyWallet: "0x1",
      asset: "a",
      conditionId: "orphan",
      size: 40,
      avgPrice: 0.95,
      initialValue: 38,
      currentValue: 0,
      cashPnl: 0,
      percentPnl: 0,
      realizedPnl: 0,
      curPrice: 0,
      redeemable: true,
      title: "Solana Up or Down",
      slug: "sol-updown-5m-9",
      outcome: "Up"
    };

    const closed = buildClosedPositions([{ conditionId: "orphan", pnl: -38, resolvedAt: 500 }], [], [position]);

    expect(closed[0].asset).toBe("SOL");
    expect(closed[0].entryPrice).toBeCloseTo(0.95);
    expect(closed[0].cost).toBeCloseTo(38);
    expect(closed[0].tradeCount).toBe(0);
  });
});
