// Optional convenience default so the dashboard can auto-load on first paint.
// Set NEXT_PUBLIC_DEFAULT_WALLET in .env.local; when unset the user pastes a wallet.
export const DEFAULT_WALLET = (process.env.NEXT_PUBLIC_DEFAULT_WALLET ?? "").trim().toLowerCase();

export const DAY_SECONDS = 86_400;

export type RangeMode = "live" | "checkpoint" | "custom";

export type TradeSide = "BUY" | "SELL" | string;

export interface PolymarketTrade {
  proxyWallet: string;
  side: TradeSide;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  icon?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  transactionHash?: string;
}

export interface GammaTag {
  label?: string | null;
  slug?: string | null;
}

export interface GammaMarket {
  id?: string;
  conditionId?: string | null;
  slug?: string | null;
  question?: string | null;
  category?: string | null;
  feesEnabled?: boolean | null;
  takerBaseFee?: number | string | null;
  feeType?: string | null;
}

export interface GammaEvent {
  id?: string;
  slug?: string | null;
  title?: string | null;
  category?: string | null;
  tags?: GammaTag[] | null;
  markets?: GammaMarket[] | null;
}

export const CATEGORY_CONFIG = {
  sports: { label: "Sports", weight: 1.0, takerFeeRate: 0.03 },
  politics: { label: "Politics", weight: 1.3, takerFeeRate: 0.04 },
  finance: { label: "Finance", weight: 1.3, takerFeeRate: 0.04 },
  mentions: { label: "Mentions", weight: 1.3, takerFeeRate: 0.04 },
  tech: { label: "Tech", weight: 1.3, takerFeeRate: 0.04 },
  economics: { label: "Economics", weight: 1.7, takerFeeRate: 0.05 },
  culture: { label: "Culture", weight: 1.7, takerFeeRate: 0.05 },
  weather: { label: "Weather", weight: 1.7, takerFeeRate: 0.05 },
  other: { label: "Other", weight: 1.7, takerFeeRate: 0.05 },
  crypto: { label: "Crypto", weight: 2.3, takerFeeRate: 0.07 },
  geopolitics: { label: "Geopolitics / free", weight: 0, takerFeeRate: 0 }
} as const;

export type CategoryKey = keyof typeof CATEGORY_CONFIG;

export type CategorySource = "event" | "market" | "tag" | "fee_disabled" | "fallback";

export interface CategoryInference {
  category: CategoryKey;
  source: CategorySource;
  matchedText?: string;
}

export interface CalculatedTrade extends PolymarketTrade {
  eventTitle: string;
  eventSlugKey: string;
  rawVolume: number;
  upside: number;
  category: CategoryKey;
  categoryLabel: string;
  categoryWeight: number;
  categorySource: CategorySource;
  takerFeeRate: number;
  takerFee: number;
  weightedVolume: number;
  feesEnabled: boolean | null;
}

export interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  realizedPnl: number;
  percentRealizedPnl?: number;
  curPrice: number;
  redeemable: boolean;
  title: string;
  slug?: string;
  icon?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  endDate?: string;
}

export interface PnlPoint {
  t: number;
  p: number;
}

export interface ActivityEvent {
  type: string;
  side?: string;
  conditionId?: string;
  usdcSize?: number;
  timestamp?: number;
  title?: string;
}

// One resolved market with its net realized cashflow and resolution time.
// conditionId lets us join back to the originating trades for asset/direction/entry.
export interface ResolvedMarket {
  conditionId: string;
  pnl: number;
  resolvedAt: number;
}

export interface RealizedPnl {
  series: PnlPoint[];
  realizedTotal: number;
  resolvedMarkets: number;
  losingMarkets: number;
  markets: ResolvedMarket[];
}

export type TradeDirection = "Up" | "Down" | "Yes" | "No" | "Other";

// A resolved market enriched with the metadata needed to analyse a strategy:
// the crypto asset, the direction bet, the average entry price and realized P/L.
export interface ClosedPosition {
  conditionId: string;
  title: string;
  slug: string | null;
  asset: string;
  isCrypto: boolean;
  category: CategoryKey;
  categoryLabel: string;
  direction: TradeDirection;
  entryPrice: number | null;
  cost: number;
  proceeds: number;
  realizedPnl: number;
  openedAt: number;
  resolvedAt: number;
  tradeCount: number;
}

const REALIZED_INCOME_TYPES = new Set(["REDEEM", "REWARD", "MAKER_REBATE"]);

// Reconstructs realized P/L per resolved market from raw activity, pairing buys to
// their redeem/sell proceeds (conditionId-grouped net cashflow). This avoids the
// mark-to-market swings of the user-pnl endpoint: capital deployed into still-open
// positions is not counted as a loss, only resolved markets contribute.
//
// Markets that have resolved but are not yet auto-redeemed have no REDEEM event, so
// recent (esp. losing) outcomes are still folded in from the redeemable positions
// snapshot — valued at their settled price (size * curPrice - cost). Already-redeemed
// markets leave /positions, so this does not double count.
export function buildRealizedPnl(events: ActivityEvent[], positions?: PolymarketPosition[] | null): RealizedPnl {
  const net = new Map<string, number>();
  const resolvedAt = new Map<string, number>();

  for (const event of events) {
    const conditionId = event.conditionId;
    if (!conditionId) {
      continue;
    }

    const usdc = Number.isFinite(event.usdcSize) ? (event.usdcSize as number) : 0;
    const timestamp = Number.isFinite(event.timestamp) ? (event.timestamp as number) : 0;

    if (event.type === "TRADE") {
      net.set(conditionId, (net.get(conditionId) ?? 0) + (event.side === "BUY" ? -usdc : usdc));
      if (event.side === "SELL") {
        resolvedAt.set(conditionId, Math.max(resolvedAt.get(conditionId) ?? 0, timestamp));
      }
    } else if (REALIZED_INCOME_TYPES.has(event.type)) {
      net.set(conditionId, (net.get(conditionId) ?? 0) + usdc);
      if (event.type === "REDEEM") {
        resolvedAt.set(conditionId, Math.max(resolvedAt.get(conditionId) ?? 0, timestamp));
      }
    }
  }

  const markets: ResolvedMarket[] = Array.from(resolvedAt.entries()).map(([conditionId, t]) => ({
    conditionId,
    resolvedAt: t,
    pnl: net.get(conditionId) ?? 0
  }));

  const nowSec = Math.floor(Date.now() / 1000);
  for (const position of positions ?? []) {
    const conditionId = position.conditionId;
    if (
      !conditionId ||
      !position.redeemable ||
      resolvedAt.has(conditionId) ||
      !Number.isFinite(position.size) ||
      position.size === 0
    ) {
      continue;
    }
    // Settled but not redeemed: realize at the settled price (0 for losers, 1 for winners).
    // Place each at its real resolution time parsed from the slug (e.g. "btc-updown-5m-
    // 1782222300" → market open unix + the 5-minute window). endDate is only date-precise
    // and would wrongly stack these mid-history; nowSec would wrongly stack them at the end.
    const settledValue = (position.size ?? 0) * (position.curPrice ?? 0);
    const pnl = settledValue - (position.initialValue ?? 0);
    const resolvedSec = parseSlugTimeSec(position.slug) ?? nowSec;
    resolvedAt.set(conditionId, resolvedSec);
    markets.push({ conditionId, resolvedAt: resolvedSec, pnl });
  }

  markets.sort((a, b) => a.resolvedAt - b.resolvedAt);

  let cumulative = 0;
  const series: PnlPoint[] = markets.map((market) => {
    cumulative += market.pnl;
    return { t: market.resolvedAt, p: cumulative };
  });

  return {
    series,
    realizedTotal: cumulative,
    resolvedMarkets: markets.length,
    losingMarkets: markets.filter((market) => market.pnl < 0).length,
    markets
  };
}

// Friendly symbols for the recurring crypto up/down markets. Unknown tokens fall back
// to the uppercased slug segment, so a new ticker (e.g. "ada-updown-5m") still shows
// as "ADA" without a code change.
const CRYPTO_SLUG_SYMBOLS: Record<string, string> = {
  btc: "BTC",
  bitcoin: "BTC",
  eth: "ETH",
  ethereum: "ETH",
  sol: "SOL",
  solana: "SOL",
  xrp: "XRP",
  ripple: "XRP",
  doge: "DOGE",
  dogecoin: "DOGE",
  bnb: "BNB",
  hype: "HYPE",
  hyperliquid: "HYPE",
  ada: "ADA",
  cardano: "ADA",
  ltc: "LTC",
  litecoin: "LTC",
  avax: "AVAX",
  avalanche: "AVAX",
  link: "LINK",
  chainlink: "LINK",
  matic: "MATIC",
  polygon: "MATIC",
  dot: "DOT",
  polkadot: "DOT",
  trx: "TRX",
  tron: "TRX",
  shib: "SHIB",
  pepe: "PEPE",
  sui: "SUI",
  apt: "APT",
  ton: "TON",
  near: "NEAR"
};

// Extracts the crypto asset and whether a market is a crypto up/down market. Recurring
// markets encode the token as the leading slug segment, e.g. "hype-updown-5m-…".
export function parseCryptoAsset(slug: string | null | undefined): { asset: string; isCrypto: boolean } {
  if (slug) {
    const updown = slug.match(/^([a-z0-9]+)-updown(?:-|$)/);
    if (updown) {
      const token = updown[1];
      return { asset: CRYPTO_SLUG_SYMBOLS[token] ?? token.toUpperCase(), isCrypto: true };
    }

    const leading = slug.match(/^([a-z0-9]+)(?:-|$)/);
    if (leading && CRYPTO_SLUG_SYMBOLS[leading[1]]) {
      return { asset: CRYPTO_SLUG_SYMBOLS[leading[1]], isCrypto: true };
    }
  }

  return { asset: "—", isCrypto: false };
}

function normalizeDirection(outcome: string | null | undefined): TradeDirection {
  switch ((outcome ?? "").trim().toLowerCase()) {
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "yes":
      return "Yes";
    case "no":
      return "No";
    default:
      return "Other";
  }
}

// Joins each resolved market (net realized cashflow) back to its originating trades to
// recover asset, direction and average entry price. Falls back to the positions snapshot
// for markets whose trades are outside the fetched window.
export function buildClosedPositions(
  markets: ResolvedMarket[],
  trades: PolymarketTrade[],
  positions?: PolymarketPosition[] | null,
  eventsBySlug?: Record<string, GammaEvent | null>
): ClosedPosition[] {
  const tradesByCondition = new Map<string, PolymarketTrade[]>();
  for (const trade of trades) {
    if (!trade.conditionId) {
      continue;
    }
    const list = tradesByCondition.get(trade.conditionId);
    if (list) {
      list.push(trade);
    } else {
      tradesByCondition.set(trade.conditionId, [trade]);
    }
  }

  const positionByCondition = new Map<string, PolymarketPosition>();
  for (const position of positions ?? []) {
    if (position.conditionId) {
      positionByCondition.set(position.conditionId, position);
    }
  }

  const closed: ClosedPosition[] = [];
  for (const market of markets) {
    const marketTrades = tradesByCondition.get(market.conditionId) ?? [];
    const buys = marketTrades.filter((trade) => trade.side === "BUY");
    const position = positionByCondition.get(market.conditionId);

    const sample = marketTrades[0];
    const slug = sample?.eventSlug ?? sample?.slug ?? position?.slug ?? null;
    const title = sample?.title ?? position?.title ?? market.conditionId;
    const outcome = sample?.outcome ?? position?.outcome;

    let cost: number;
    let entryPrice: number | null;
    if (buys.length > 0) {
      const sizeSum = sum(buys, (trade) => trade.size);
      cost = sum(buys, (trade) => trade.size * trade.price);
      entryPrice = sizeSum > 0 ? cost / sizeSum : null;
    } else {
      cost = position?.initialValue ?? 0;
      entryPrice = Number.isFinite(position?.avgPrice) ? (position?.avgPrice as number) : null;
    }

    const { asset, isCrypto } = parseCryptoAsset(slug);
    const event = eventsBySlug?.[slug ?? ""];
    const inference = sample ? inferTradeCategory(sample, event) : null;
    const category: CategoryKey = inference?.category ?? (isCrypto ? "crypto" : "other");
    const openedAt = marketTrades.reduce<number>(
      (min, trade) => (Number.isFinite(trade.timestamp) ? Math.min(min, trade.timestamp) : min),
      market.resolvedAt
    );

    closed.push({
      conditionId: market.conditionId,
      title,
      slug,
      asset,
      isCrypto,
      category,
      categoryLabel: CATEGORY_CONFIG[category].label,
      direction: normalizeDirection(outcome),
      entryPrice,
      cost,
      proceeds: market.pnl + cost,
      realizedPnl: market.pnl,
      openedAt,
      resolvedAt: market.resolvedAt,
      tradeCount: marketTrades.length
    });
  }

  closed.sort((a, b) => b.resolvedAt - a.resolvedAt);
  return closed;
}

const FIVE_MINUTES = 300;

// Recurring crypto markets encode their open time in the slug, e.g.
// "btc-updown-5m-1782222300". Returns the window end (open + 5 minutes) in seconds.
function parseSlugTimeSec(slug: string | undefined): number | null {
  if (!slug) {
    return null;
  }
  const match = slug.match(/-(\d{10})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) + FIVE_MINUTES;
}

export interface PositionsSummary {
  // Only genuinely open positions (resolved/redeemable rows are excluded because
  // Polymarket drops auto-redeemed winners from /positions, leaving a misleading
  // loss-only snapshot). Authoritative realized/total P/L comes from pnlHistory.
  items: PolymarketPosition[];
  totals: {
    currentValue: number;
    initialValue: number;
    unrealizedPnl: number;
    openCount: number;
    resolvedExcluded: number;
  };
}

export interface Tier {
  rank: number;
  name: string;
  threshold: number;
  rebateRate: number;
  levelUpBonus: number;
}

export const TIERS: Tier[] = [
  { rank: 0, name: "None", threshold: 0, rebateRate: 0, levelUpBonus: 0 },
  { rank: 1, name: "Bronze", threshold: 2_000, rebateRate: 0.03, levelUpBonus: 10 },
  { rank: 2, name: "Silver", threshold: 20_000, rebateRate: 0.08, levelUpBonus: 50 },
  { rank: 3, name: "Gold", threshold: 200_000, rebateRate: 0.18, levelUpBonus: 250 },
  { rank: 4, name: "Platinum", threshold: 1_000_000, rebateRate: 0.32, levelUpBonus: 1_500 },
  { rank: 5, name: "Diamond", threshold: 4_000_000, rebateRate: 0.44, levelUpBonus: 7_500 },
  { rank: 6, name: "Obsidian", threshold: 10_000_000, rebateRate: 0.5, levelUpBonus: 25_000 }
];

export interface TierProgress {
  current: Tier;
  next: Tier | null;
  remainingToNext: number;
  progressToNext: number;
}

export interface ReportRange {
  startSec: number;
  endSec: number;
  mode: RangeMode;
  days: number;
}

export interface RebateReport {
  wallet: string;
  generatedAt: string;
  range: ReportRange;
  totals: {
    weightedVolume: number;
    takerFeesPaid: number;
    rawVolume: number;
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    averagePrice: number;
    averageWeightedVolume: number;
  };
  tier: TierProgress;
  daily: Array<{
    date: string;
    weightedVolume: number;
    rawVolume: number;
    takerFee: number;
    tradeCount: number;
  }>;
  categories: Array<{
    category: CategoryKey;
    label: string;
    weight: number;
    weightedVolume: number;
    rawVolume: number;
    tradeCount: number;
  }>;
  topEvents: Array<{
    eventSlug: string;
    title: string;
    icon?: string;
    categoryLabel: string;
    weightedVolume: number;
    rawVolume: number;
    tradeCount: number;
  }>;
  trades: CalculatedTrade[];
  positions: PositionsSummary | null;
  pnlHistory: PnlPoint[] | null;
  profitTotal: number | null;
  realizedTotal: number | null;
  resolvedMarkets: number;
  losingMarkets: number;
  closedPositions: ClosedPosition[];
  warnings: string[];
  api: {
    tradePages: number;
    tradesFetched: number;
    eventFetches: number;
    incomplete: boolean;
    oldestFetchedTimestamp: number | null;
  };
}

const CATEGORY_ALIASES: Record<string, CategoryKey> = {
  sport: "sports",
  sports: "sports",
  politics: "politics",
  political: "politics",
  elections: "politics",
  election: "politics",
  finance: "finance",
  financials: "finance",
  mentions: "mentions",
  mention: "mentions",
  tech: "tech",
  technology: "tech",
  "science tech": "tech",
  economics: "economics",
  economy: "economics",
  culture: "culture",
  weather: "weather",
  other: "other",
  crypto: "crypto",
  cryptocurrency: "crypto",
  "crypto prices": "crypto",
  geopolitics: "geopolitics",
  geopolitical: "geopolitics",
  "world events": "geopolitics",
  "world event": "geopolitics"
};

const CATEGORY_CONTAINS: Array<[RegExp, CategoryKey]> = [
  [/\bgeopolitics?\b/, "geopolitics"],
  [/\bworld events?\b/, "geopolitics"],
  [/\bcrypto\b/, "crypto"],
  [/\bsports?\b/, "sports"],
  [/\bpolitics?\b/, "politics"],
  [/\belections?\b/, "politics"],
  [/\bfinance\b/, "finance"],
  [/\bfinancials?\b/, "finance"],
  [/\bmentions?\b/, "mentions"],
  [/\btech\b/, "tech"],
  [/\btechnology\b/, "tech"],
  [/\beconom(?:y|ics)\b/, "economics"],
  [/\bculture\b/, "culture"],
  [/\bweather\b/, "weather"],
  [/\bother\b/, "other"]
];

export function validateWallet(wallet: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(wallet);
}

export function getTier(weightedVolume: number): TierProgress {
  const current = [...TIERS].reverse().find((tier) => weightedVolume >= tier.threshold) ?? TIERS[0];
  const currentIndex = TIERS.findIndex((tier) => tier.rank === current.rank);
  const next = TIERS[currentIndex + 1] ?? null;
  const remainingToNext = next ? Math.max(0, next.threshold - weightedVolume) : 0;
  const progressToNext = next
    ? clamp((weightedVolume - current.threshold) / (next.threshold - current.threshold), 0, 1)
    : 1;

  return {
    current,
    next,
    remainingToNext,
    progressToNext
  };
}

export function inferTradeCategory(trade: PolymarketTrade, event: GammaEvent | null | undefined): CategoryInference {
  const market = findMatchingMarket(trade, event);
  const takerBaseFee = toNumber(market?.takerBaseFee);

  if (market?.feesEnabled === false || takerBaseFee === 0) {
    return {
      category: "geopolitics",
      source: "fee_disabled",
      matchedText: market?.slug ?? event?.slug ?? trade.slug
    };
  }

  const eventCategory = categoryFromText(event?.category);
  if (eventCategory) {
    return {
      category: eventCategory,
      source: "event",
      matchedText: event?.category ?? undefined
    };
  }

  const marketCategory = categoryFromText(market?.category);
  if (marketCategory) {
    return {
      category: marketCategory,
      source: "market",
      matchedText: market?.category ?? undefined
    };
  }

  for (const tag of event?.tags ?? []) {
    const tagCategory = categoryFromText(tag.slug) ?? categoryFromText(tag.label);
    if (tagCategory) {
      return {
        category: tagCategory,
        source: "tag",
        matchedText: tag.label ?? tag.slug ?? undefined
      };
    }
  }

  return {
    category: "other",
    source: "fallback"
  };
}

export function calculateTrade(
  trade: PolymarketTrade,
  event: GammaEvent | null | undefined,
  bonusMultiplier = 1
): CalculatedTrade | null {
  if (!isFinitePositive(trade.size) || !Number.isFinite(trade.price) || trade.price < 0 || trade.price > 1) {
    return null;
  }

  const categoryInference = inferTradeCategory(trade, event);
  const categoryConfig = CATEGORY_CONFIG[categoryInference.category];
  const rawVolume = trade.size * trade.price;
  const upside = 1 - trade.price;
  const weightedVolume = rawVolume * upside * categoryConfig.weight * bonusMultiplier;
  const takerFee = calculateTakerFee(trade.size, trade.price, categoryConfig.takerFeeRate);
  const market = findMatchingMarket(trade, event);

  return {
    ...trade,
    eventTitle: event?.title ?? trade.title,
    eventSlugKey: event?.slug ?? trade.eventSlug ?? trade.slug,
    rawVolume,
    upside,
    category: categoryInference.category,
    categoryLabel: categoryConfig.label,
    categoryWeight: categoryConfig.weight,
    categorySource: categoryInference.source,
    takerFeeRate: categoryConfig.takerFeeRate,
    takerFee,
    weightedVolume,
    feesEnabled: market?.feesEnabled ?? null
  };
}

export function aggregateRebateReport(input: {
  wallet: string;
  trades: PolymarketTrade[];
  eventsBySlug: Record<string, GammaEvent | null>;
  range: ReportRange;
  positions?: PolymarketPosition[] | null;
  realized?: RealizedPnl | null;
  profitTotal?: number | null;
  generatedAt?: Date;
  api?: Partial<RebateReport["api"]>;
  extraWarnings?: string[];
}): RebateReport {
  const filteredTrades = input.trades.filter(
    (trade) => trade.timestamp >= input.range.startSec && trade.timestamp <= input.range.endSec
  );
  const uniqueTrades = dedupeTrades(filteredTrades);
  const calculatedTrades: CalculatedTrade[] = [];
  let invalidTradeCount = 0;

  for (const trade of uniqueTrades) {
    const slug = trade.eventSlug ?? trade.slug;
    const calculatedTrade = calculateTrade(trade, input.eventsBySlug[slug]);
    if (calculatedTrade) {
      calculatedTrades.push(calculatedTrade);
    } else {
      invalidTradeCount += 1;
    }
  }

  calculatedTrades.sort((a, b) => b.timestamp - a.timestamp);

  const rawVolume = sum(calculatedTrades, (trade) => trade.rawVolume);
  const weightedVolume = sum(calculatedTrades, (trade) => trade.weightedVolume);
  const takerFeesPaid = sum(calculatedTrades, (trade) => trade.takerFee);
  const buyCount = calculatedTrades.filter((trade) => trade.side === "BUY").length;
  const sellCount = calculatedTrades.filter((trade) => trade.side === "SELL").length;
  const fallbackCount = calculatedTrades.filter((trade) => trade.categorySource === "fallback").length;
  const missingEventCount = calculatedTrades.filter((trade) => !input.eventsBySlug[trade.eventSlug ?? trade.slug]).length;
  const warnings = [...(input.extraWarnings ?? [])];

  if (invalidTradeCount > 0) {
    warnings.push(`${invalidTradeCount} trade(s) were skipped because size or price was invalid.`);
  }

  if (fallbackCount > 0) {
    warnings.push(`${fallbackCount} trade(s) used the Other weight because no known category was found in Gamma metadata.`);
  }

  if (missingEventCount > 0) {
    warnings.push(`${missingEventCount} trade(s) could not be enriched with event metadata.`);
  }

  if (input.api?.incomplete) {
    warnings.push("Trade pagination reached the public Data API offset limit; totals may be incomplete.");
  }

  return {
    wallet: input.wallet,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    range: input.range,
    totals: {
      weightedVolume,
      takerFeesPaid,
      rawVolume,
      tradeCount: calculatedTrades.length,
      buyCount,
      sellCount,
      averagePrice: calculatedTrades.length > 0 ? sum(calculatedTrades, (trade) => trade.price) / calculatedTrades.length : 0,
      averageWeightedVolume: calculatedTrades.length > 0 ? weightedVolume / calculatedTrades.length : 0
    },
    tier: getTier(weightedVolume),
    daily: buildDailyBuckets(calculatedTrades, input.range),
    categories: buildCategoryBreakdown(calculatedTrades),
    topEvents: buildTopEvents(calculatedTrades),
    trades: calculatedTrades,
    positions: input.positions ? aggregatePositions(input.positions) : null,
    pnlHistory: input.realized ? input.realized.series : null,
    profitTotal: input.profitTotal ?? null,
    realizedTotal: input.realized ? input.realized.realizedTotal : null,
    resolvedMarkets: input.realized?.resolvedMarkets ?? 0,
    losingMarkets: input.realized?.losingMarkets ?? 0,
    closedPositions: input.realized
      ? buildClosedPositions(input.realized.markets, input.trades, input.positions, input.eventsBySlug).filter(
          (position) => position.resolvedAt >= input.range.startSec && position.resolvedAt <= input.range.endSec
        )
      : [],
    warnings: Array.from(new Set(warnings)),
    api: {
      tradePages: input.api?.tradePages ?? 0,
      tradesFetched: input.api?.tradesFetched ?? input.trades.length,
      eventFetches: input.api?.eventFetches ?? Object.keys(input.eventsBySlug).length,
      incomplete: input.api?.incomplete ?? false,
      oldestFetchedTimestamp: input.api?.oldestFetchedTimestamp ?? null
    }
  };
}

export function isOpenPosition(item: PolymarketPosition): boolean {
  // Resolved markets come back as redeemable with curPrice pinned to 0 or 1.
  // Treat anything not yet redeemed as an open (unrealized) position.
  return Number.isFinite(item.size) && item.size !== 0 && !item.redeemable;
}

export function aggregatePositions(items: PolymarketPosition[]): PositionsSummary {
  const open = items.filter(isOpenPosition);
  const resolvedExcluded = items.filter((item) => Number.isFinite(item.size) && item.size !== 0 && item.redeemable).length;
  const sorted = [...open].sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));

  return {
    items: sorted,
    totals: {
      currentValue: sum(sorted, (item) => item.currentValue ?? 0),
      initialValue: sum(sorted, (item) => item.initialValue ?? 0),
      unrealizedPnl: sum(sorted, (item) => item.cashPnl ?? 0),
      openCount: sorted.length,
      resolvedExcluded
    }
  };
}

export function pnlTotal(history: PnlPoint[] | null | undefined): number | null {
  if (!history || history.length === 0) {
    return null;
  }
  const last = history[history.length - 1]?.p;
  return Number.isFinite(last) ? last : null;
}

function findMatchingMarket(trade: PolymarketTrade, event: GammaEvent | null | undefined): GammaMarket | undefined {
  return event?.markets?.find((market) => market.conditionId === trade.conditionId || market.slug === trade.slug);
}

function categoryFromText(value: string | null | undefined): CategoryKey | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeLookup(value);
  const exactMatch = CATEGORY_ALIASES[normalized];
  if (exactMatch) {
    return exactMatch;
  }

  for (const [pattern, category] of CATEGORY_CONTAINS) {
    if (pattern.test(normalized)) {
      return category;
    }
  }

  return null;
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeTrades(trades: PolymarketTrade[]): PolymarketTrade[] {
  const seen = new Set<string>();
  const unique: PolymarketTrade[] = [];

  for (const trade of trades) {
    const key = [
      trade.transactionHash ?? "",
      trade.asset,
      trade.conditionId,
      trade.side,
      trade.timestamp,
      trade.size,
      trade.price
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trade);
    }
  }

  return unique;
}

function buildDailyBuckets(trades: CalculatedTrade[], range: ReportRange): RebateReport["daily"] {
  const buckets = new Map<string, { weightedVolume: number; rawVolume: number; takerFee: number; tradeCount: number }>();
  const startDate = utcDayStart(range.startSec);
  const endDate = utcDayStart(range.endSec);

  for (let date = startDate; date <= endDate; date += DAY_SECONDS) {
    buckets.set(formatUtcDate(date), {
      weightedVolume: 0,
      rawVolume: 0,
      takerFee: 0,
      tradeCount: 0
    });
  }

  for (const trade of trades) {
    const date = formatUtcDate(trade.timestamp);
    const bucket = buckets.get(date) ?? {
      weightedVolume: 0,
      rawVolume: 0,
      takerFee: 0,
      tradeCount: 0
    };
    bucket.weightedVolume += trade.weightedVolume;
    bucket.rawVolume += trade.rawVolume;
    bucket.takerFee += trade.takerFee;
    bucket.tradeCount += 1;
    buckets.set(date, bucket);
  }

  return Array.from(buckets.entries()).map(([date, bucket]) => ({
    date,
    ...bucket
  }));
}

function buildCategoryBreakdown(trades: CalculatedTrade[]): RebateReport["categories"] {
  const buckets = new Map<CategoryKey, { weightedVolume: number; rawVolume: number; tradeCount: number }>();

  for (const trade of trades) {
    const bucket = buckets.get(trade.category) ?? {
      weightedVolume: 0,
      rawVolume: 0,
      tradeCount: 0
    };
    bucket.weightedVolume += trade.weightedVolume;
    bucket.rawVolume += trade.rawVolume;
    bucket.tradeCount += 1;
    buckets.set(trade.category, bucket);
  }

  return Array.from(buckets.entries())
    .map(([category, bucket]) => ({
      category,
      label: CATEGORY_CONFIG[category].label,
      weight: CATEGORY_CONFIG[category].weight,
      ...bucket
    }))
    .sort((a, b) => b.weightedVolume - a.weightedVolume);
}

function buildTopEvents(trades: CalculatedTrade[]): RebateReport["topEvents"] {
  const buckets = new Map<
    string,
    {
      title: string;
      icon?: string;
      categoryLabel: string;
      weightedVolume: number;
      rawVolume: number;
      tradeCount: number;
    }
  >();

  for (const trade of trades) {
    const eventSlug = trade.eventSlugKey || trade.eventSlug || trade.slug || trade.conditionId;
    const bucket = buckets.get(eventSlug) ?? {
      title: trade.eventTitle,
      icon: trade.icon,
      categoryLabel: trade.categoryLabel,
      weightedVolume: 0,
      rawVolume: 0,
      tradeCount: 0
    };
    bucket.weightedVolume += trade.weightedVolume;
    bucket.rawVolume += trade.rawVolume;
    bucket.tradeCount += 1;
    buckets.set(eventSlug, bucket);
  }

  return Array.from(buckets.entries())
    .map(([eventSlug, bucket]) => ({
      eventSlug,
      ...bucket
    }))
    .sort((a, b) => b.weightedVolume - a.weightedVolume)
    .slice(0, 12);
}

function utcDayStart(timestampSec: number): number {
  const date = new Date(timestampSec * 1000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000);
}

function formatUtcDate(timestampSec: number): string {
  return new Date(utcDayStart(timestampSec) * 1000).toISOString().slice(0, 10);
}

function calculateTakerFee(size: number, price: number, takerFeeRate: number): number {
  const fee = size * takerFeeRate * price * (1 - price);
  return Math.round((fee + Number.EPSILON) * 100_000) / 100_000;
}

function sum<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
