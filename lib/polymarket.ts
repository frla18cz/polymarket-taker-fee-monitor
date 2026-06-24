import {
  aggregateRebateReport,
  buildRealizedPnl,
  type ActivityEvent,
  type GammaEvent,
  type PolymarketPosition,
  type PolymarketTrade,
  type RebateReport,
  type ReportRange
} from "@/lib/rebate";

const DATA_API_BASE = "https://data-api.polymarket.com";
const LB_API_BASE = "https://lb-api.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const TRADE_PAGE_LIMIT = 1_000;
const POSITION_PAGE_LIMIT = 500;
const ACTIVITY_PAGE_LIMIT = 500;
const MAX_DATA_API_OFFSET = 10_000;
const EVENT_CONCURRENCY = 16;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function buildRebateReport(input: {
  wallet: string;
  range: ReportRange;
  fetchImpl?: FetchLike;
  generatedAt?: Date;
}): Promise<RebateReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const [tradeResult, positionsResult, activityResult, profitResult] = await Promise.all([
    fetchTakerTrades({
      wallet: input.wallet,
      startSec: input.range.startSec,
      fetchImpl
    }),
    fetchPositions({ wallet: input.wallet, fetchImpl }),
    fetchActivity({ wallet: input.wallet, fetchImpl }),
    fetchProfileProfit({ wallet: input.wallet, fetchImpl })
  ]);
  const windowTrades = tradeResult.trades.filter(
    (trade) => trade.timestamp >= input.range.startSec && trade.timestamp <= input.range.endSec
  );
  const eventResult = await fetchEventsForTrades(windowTrades, fetchImpl);

  return aggregateRebateReport({
    wallet: input.wallet,
    trades: windowTrades,
    eventsBySlug: eventResult.eventsBySlug,
    range: input.range,
    positions: positionsResult.positions,
    realized: buildRealizedPnl(activityResult.events, positionsResult.positions),
    profitTotal: profitResult.profitTotal,
    generatedAt: input.generatedAt,
    extraWarnings: [
      ...eventResult.warnings,
      ...positionsResult.warnings,
      ...activityResult.warnings,
      ...profitResult.warnings
    ],
    api: {
      tradePages: tradeResult.tradePages,
      tradesFetched: tradeResult.trades.length,
      eventFetches: eventResult.eventFetches,
      incomplete: tradeResult.incomplete,
      oldestFetchedTimestamp: tradeResult.oldestFetchedTimestamp
    }
  });
}

export async function fetchTakerTrades(input: {
  wallet: string;
  startSec: number;
  fetchImpl?: FetchLike;
}): Promise<{
  trades: PolymarketTrade[];
  tradePages: number;
  incomplete: boolean;
  oldestFetchedTimestamp: number | null;
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const trades: PolymarketTrade[] = [];
  let tradePages = 0;
  let offset = 0;
  let incomplete = false;
  let oldestFetchedTimestamp: number | null = null;

  while (offset <= MAX_DATA_API_OFFSET) {
    const url = new URL("/trades", DATA_API_BASE);
    url.searchParams.set("user", input.wallet);
    url.searchParams.set("takerOnly", "true");
    url.searchParams.set("limit", String(TRADE_PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));

    const page = await fetchJson<PolymarketTrade[]>(url, fetchImpl);
    if (!Array.isArray(page)) {
      throw new Error("Unexpected Data API response: trades payload was not an array.");
    }

    tradePages += 1;
    trades.push(...page);

    for (const trade of page) {
      if (Number.isFinite(trade.timestamp)) {
        oldestFetchedTimestamp =
          oldestFetchedTimestamp === null ? trade.timestamp : Math.min(oldestFetchedTimestamp, trade.timestamp);
      }
    }

    const oldestPageTimestamp = page.reduce<number | null>((oldest, trade) => {
      if (!Number.isFinite(trade.timestamp)) {
        return oldest;
      }
      return oldest === null ? trade.timestamp : Math.min(oldest, trade.timestamp);
    }, null);

    if (page.length < TRADE_PAGE_LIMIT || oldestPageTimestamp === null || oldestPageTimestamp < input.startSec) {
      break;
    }

    offset += TRADE_PAGE_LIMIT;
    if (offset > MAX_DATA_API_OFFSET) {
      incomplete = true;
      break;
    }
  }

  return {
    trades,
    tradePages,
    incomplete,
    oldestFetchedTimestamp
  };
}

export async function fetchPositions(input: {
  wallet: string;
  fetchImpl?: FetchLike;
}): Promise<{ positions: PolymarketPosition[] | null; warnings: string[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const positions: PolymarketPosition[] = [];
  let offset = 0;

  try {
    while (offset <= MAX_DATA_API_OFFSET) {
      const url = new URL("/positions", DATA_API_BASE);
      url.searchParams.set("user", input.wallet);
      url.searchParams.set("sizeThreshold", "1");
      url.searchParams.set("limit", String(POSITION_PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));

      const page = await fetchJson<PolymarketPosition[]>(url, fetchImpl);
      if (!Array.isArray(page)) {
        throw new Error("Unexpected Data API response: positions payload was not an array.");
      }

      positions.push(...page);

      if (page.length < POSITION_PAGE_LIMIT) {
        break;
      }

      offset += POSITION_PAGE_LIMIT;
    }

    return { positions, warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      positions: null,
      warnings: [`Positions could not be loaded (P/L unavailable): ${message}`]
    };
  }
}

export async function fetchActivity(input: {
  wallet: string;
  fetchImpl?: FetchLike;
}): Promise<{ events: ActivityEvent[]; warnings: string[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const seen = new Set<string>();
  const events: ActivityEvent[] = [];
  let offset = 0;
  let incomplete = false;

  try {
    while (offset <= MAX_DATA_API_OFFSET) {
      const url = new URL("/activity", DATA_API_BASE);
      url.searchParams.set("user", input.wallet);
      url.searchParams.set("limit", String(ACTIVITY_PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));

      const page = await fetchJson<Array<ActivityEvent & { transactionHash?: string; asset?: string; size?: number }>>(
        url,
        fetchImpl
      );
      if (!Array.isArray(page)) {
        throw new Error("Unexpected Data API response: activity payload was not an array.");
      }

      for (const event of page) {
        const key = `${event.transactionHash ?? ""}|${event.asset ?? ""}|${event.type}|${event.timestamp ?? ""}|${event.size ?? ""}|${event.side ?? ""}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        events.push(event);
      }

      if (page.length < ACTIVITY_PAGE_LIMIT) {
        break;
      }

      offset += ACTIVITY_PAGE_LIMIT;
      if (offset > MAX_DATA_API_OFFSET) {
        incomplete = true;
      }
    }

    return {
      events,
      warnings: incomplete
        ? ["Activity history reached the public Data API offset limit; realized P/L may be incomplete."]
        : []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      events,
      warnings: [`Realized P/L could not be loaded: ${message}`]
    };
  }
}

interface ProfitRow {
  proxyWallet?: string;
  amount?: number;
}

export async function fetchProfileProfit(input: {
  wallet: string;
  fetchImpl?: FetchLike;
}): Promise<{ profitTotal: number | null; warnings: string[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const url = new URL("/profit", LB_API_BASE);
    url.searchParams.set("window", "all");
    url.searchParams.set("address", input.wallet);

    const rows = await fetchJson<ProfitRow[]>(url, fetchImpl);
    const amount = Array.isArray(rows) ? rows[0]?.amount : undefined;

    return {
      profitTotal: Number.isFinite(amount) ? (amount as number) : null,
      warnings: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      profitTotal: null,
      warnings: [`Profile P/L could not be loaded: ${message}`]
    };
  }
}

export async function fetchEventsForTrades(
  trades: PolymarketTrade[],
  fetchImpl: FetchLike = fetch
): Promise<{
  eventsBySlug: Record<string, GammaEvent | null>;
  eventFetches: number;
  warnings: string[];
}> {
  const slugs = Array.from(
    new Set(trades.map((trade) => trade.eventSlug ?? trade.slug).filter((slug): slug is string => Boolean(slug)))
  );
  const results = await mapWithConcurrency(slugs, EVENT_CONCURRENCY, async (slug) => {
    try {
      return {
        slug,
        event: await fetchEventBySlug(slug, fetchImpl),
        error: null
      };
    } catch (error) {
      return {
        slug,
        event: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  const eventsBySlug: Record<string, GammaEvent | null> = {};
  const warnings: string[] = [];

  for (const result of results) {
    eventsBySlug[result.slug] = result.event;
    if (result.error) {
      warnings.push(`Gamma metadata fetch failed for ${result.slug}: ${result.error}`);
    }
  }

  return {
    eventsBySlug,
    eventFetches: slugs.length,
    warnings
  };
}

export async function fetchEventBySlug(slug: string, fetchImpl: FetchLike = fetch): Promise<GammaEvent | null> {
  const url = new URL(`/events/slug/${encodeURIComponent(slug)}`, GAMMA_API_BASE);
  const event = await fetchJson<GammaEvent | null>(url, fetchImpl);

  if (!event || typeof event !== "object") {
    return null;
  }

  return event;
}

async function fetchJson<T>(url: URL, fetchImpl: FetchLike): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "Upstream request failed"}`);
  }

  return response.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}
