"use client";

import { AlertTriangle, CalendarDays, Clock, Download, RefreshCw, Search, Wallet } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { tradesToCsv, positionsToCsv, closedPositionsToCsv } from "@/lib/csv";
import {
  DEFAULT_WALLET,
  pnlTotal,
  validateWallet,
  type ClosedPosition,
  type RebateReport
} from "@/lib/rebate";

type RangeValue = "7" | "14" | "30" | "90" | "custom";
type PresetMode = "live" | "checkpoint";
type TabValue = "overview" | "crypto";

type DailyMetric = "weightedVolume" | "rawVolume" | "takerFee" | "tradeCount";
type ChartMetric = DailyMetric | "pnl";

const CHART_METRICS: Array<{ value: ChartMetric; label: string }> = [
  { value: "weightedVolume", label: "Weighted" },
  { value: "rawVolume", label: "Raw" },
  { value: "takerFee", label: "Fees" },
  { value: "tradeCount", label: "Trades" },
  { value: "pnl", label: "P/L" }
];

type TradeSortKey = "timestamp" | "size" | "price" | "takerFee" | "rawVolume" | "weightedVolume";

const TRADES_PAGE_SIZE = 50;

const RANGE_OPTIONS: Array<{ value: RangeValue; label: string }> = [
  { value: "7", label: "7D" },
  { value: "14", label: "14D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "custom", label: "Custom" }
];

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2
});

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0
});

// Display timezone is user-selectable. The "Local" option defaults to NEXT_PUBLIC_DEFAULT_TZ
// (set in .env.local) and otherwise to the viewer's own browser timezone; the repo default
// stays UTC so a fresh checkout is timezone-neutral.
const ENV_DEFAULT_TZ = (process.env.NEXT_PUBLIC_DEFAULT_TZ ?? "").trim();

const TimeZoneContext = createContext<string>("UTC");

function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(kind: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${kind}|${timeZone}`;
  let formatter = dateTimeFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, { ...options, timeZone });
    dateTimeFormatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

// en-US so the short weekday is stable ("Mon") for mapping to an index, independent of locale.
const zonedPartsCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedPartsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" });
    zonedPartsCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function Dashboard(): React.ReactElement {
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [rangeValue, setRangeValue] = useState<RangeValue>("30");
  const [mode, setMode] = useState<PresetMode>("live");
  const [customStart, setCustomStart] = useState(() => toDateInput(addDaysUtc(new Date(), -30)));
  const [customEnd, setCustomEnd] = useState(() => toDateInput(new Date()));
  const [report, setReport] = useState<RebateReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("weightedVolume");
  const [activeTab, setActiveTab] = useState<TabValue>("overview");
  // Local timezone for the "Local" toggle: env override first, then the browser tz (resolved
  // after mount to avoid an SSR/client hydration mismatch).
  const [localTz, setLocalTz] = useState(ENV_DEFAULT_TZ || "UTC");
  const [useUtc, setUseUtc] = useState(!ENV_DEFAULT_TZ || ENV_DEFAULT_TZ.toUpperCase() === "UTC");

  useEffect(() => {
    if (!ENV_DEFAULT_TZ) {
      try {
        const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (resolved) {
          setLocalTz(resolved);
        }
      } catch {
        // keep UTC fallback
      }
    }
  }, []);

  const timeZone = useUtc ? "UTC" : localTz;
  const localTzLabel = localTz === "UTC" ? "Local" : (localTz.split("/").pop() ?? localTz).replace(/_/g, " ");

  const rangeLabel = useMemo(() => {
    if (!report) {
      return "No range loaded";
    }

    return `${formatZonedDateTime(report.range.startSec, timeZone)} to ${formatZonedDateTime(report.range.endSec, timeZone)}`;
  }, [report, timeZone]);

  async function loadReport(): Promise<void> {
    const trimmedWallet = wallet.trim();
    if (!validateWallet(trimmedWallet)) {
      setReport(null);
      setError("Enter a 0x-prefixed 40-hex wallet address.");
      return;
    }

    const params = new URLSearchParams({
      wallet: trimmedWallet
    });

    if (rangeValue === "custom") {
      params.set("start", String(dateInputToStartSecond(customStart)));
      params.set("end", String(dateInputToEndSecond(customEnd)));
    } else {
      params.set("days", rangeValue);
      params.set("mode", mode);
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/rebates?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as RebateReport | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Request failed.");
      }

      setReport(payload as RebateReport);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load report.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Auto-load only when a default wallet is configured (NEXT_PUBLIC_DEFAULT_WALLET);
    // otherwise wait for the user to paste one.
    if (validateWallet(wallet.trim())) {
      void loadReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TimeZoneContext.Provider value={timeZone}>
    <main className="shell">
      <section className="toolbar" aria-label="Report controls">
        <div className="titleBlock">
          <div className="eyebrow">Polymarket</div>
          <h1>Taker rebate monitor</h1>
          <p>{rangeLabel}</p>
        </div>

        <form
          className="controls"
          onSubmit={(event) => {
            event.preventDefault();
            void loadReport();
          }}
        >
          <label className="field walletField">
            <span>
              <Wallet size={16} aria-hidden="true" />
              Wallet
            </span>
            <input
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
            />
          </label>

          <div className="controlGroup" role="group" aria-label="Range">
            {RANGE_OPTIONS.map((option) => (
              <button
                className={rangeValue === option.value ? "segmented active" : "segmented"}
                key={option.value}
                onClick={() => setRangeValue(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="controlGroup" role="group" aria-label="Mode">
            <button
              className={mode === "live" ? "segmented active" : "segmented"}
              onClick={() => setMode("live")}
              type="button"
            >
              Live
            </button>
            <button
              className={mode === "checkpoint" ? "segmented active" : "segmented"}
              onClick={() => setMode("checkpoint")}
              type="button"
            >
              Midnight UTC
            </button>
          </div>

          <div className="controlGroup" role="group" aria-label="Timezone">
            <button
              className={useUtc ? "segmented active" : "segmented"}
              onClick={() => setUseUtc(true)}
              type="button"
              title="Show all times in UTC"
            >
              <Clock size={14} aria-hidden="true" />
              UTC
            </button>
            <button
              className={!useUtc ? "segmented active" : "segmented"}
              onClick={() => setUseUtc(false)}
              type="button"
              title={`Show all times in ${localTz}`}
            >
              {localTzLabel}
            </button>
          </div>

          {rangeValue === "custom" ? (
            <div className="dateRow">
              <label className="field">
                <span>
                  <CalendarDays size={16} aria-hidden="true" />
                  Start
                </span>
                <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              </label>
              <label className="field">
                <span>
                  <CalendarDays size={16} aria-hidden="true" />
                  End
                </span>
                <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </label>
            </div>
          ) : null}

          <button className="primaryButton" type="submit" disabled={isLoading}>
            <RefreshCw size={18} aria-hidden="true" className={isLoading ? "spin" : undefined} />
            Refresh
          </button>
        </form>
      </section>

      {error ? (
        <section className="warningPanel" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
        </section>
      ) : null}

      {report?.warnings.length ? (
        <section className="warningPanel" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            {report.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="controlGroup tabSwitcher" role="tablist" aria-label="View">
        <button
          className={activeTab === "overview" ? "segmented active" : "segmented"}
          onClick={() => setActiveTab("overview")}
          role="tab"
          aria-selected={activeTab === "overview"}
          type="button"
        >
          Overview
        </button>
        <button
          className={activeTab === "crypto" ? "segmented active" : "segmented"}
          onClick={() => setActiveTab("crypto")}
          role="tab"
          aria-selected={activeTab === "crypto"}
          type="button"
        >
          Crypto strategy
        </button>
      </div>

      {activeTab === "crypto" ? (
        <CryptoStrategyTab report={report} isLoading={isLoading} />
      ) : (
      <>
      <section className="metricGrid" aria-busy={isLoading}>
        <MetricCard label="Estimated weighted volume" value={formatUsd(report?.totals.weightedVolume)} detail="Rolling wV" />
        <MetricCard
          label="Estimated tier"
          value={report?.tier.current.name ?? "-"}
          detail={`${formatPercent(report?.tier.current.rebateRate)} rebate`}
        />
        <MetricCard
          label="Taker fees paid"
          value={formatUsd(report?.totals.takerFeesPaid)}
          detail="Gross estimate"
        />
        <MetricCard label="Gap to next tier" value={formatUsd(report?.tier.remainingToNext)} detail={nextTierLabel(report)} />
        <MetricCard label="Raw taker volume" value={formatUsd(report?.totals.rawVolume)} detail="Shares x price" />
        <MetricCard label="Trades" value={formatNumber(report?.totals.tradeCount)} detail={sideCountLabel(report)} />
      </section>

      <section className="contentGrid">
        <div className="panel widePanel">
          <div className="panelHeader">
            <div>
              <h2>{chartMetric === "pnl" ? "Cumulative realized P/L" : "Daily activity"}</h2>
              {chartMetric === "pnl" ? (
                <p className="panelNote">
                  Realized per resolved market (buys paired to redeems) — no mark-to-market noise. Hover for time &amp; value.
                </p>
              ) : null}
            </div>
            <div className="controlGroup" role="group" aria-label="Chart metric">
              {CHART_METRICS.map((option) => (
                <button
                  className={chartMetric === option.value ? "segmented active" : "segmented"}
                  key={option.value}
                  onClick={() => setChartMetric(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {chartMetric === "pnl" ? (
            <PnlChart report={report} />
          ) : (
            <DailyChart report={report} metric={chartMetric} />
          )}
        </div>

        <div className="panel">
          <PanelHeader title="Tier progress" meta={report?.tier.next?.name ?? "Top tier"} />
          <TierProgress report={report} />
        </div>
      </section>

      <section className="contentGrid">
        <div className="panel">
          <PanelHeader title="Category breakdown" meta="By inferred category" />
          <CategoryBreakdown report={report} />
        </div>

        <div className="panel">
          <PanelHeader title="Top events" meta="By wV" />
          <TopEvents report={report} />
        </div>
      </section>

      <section className="panel">
        <TradesTable report={report} />
      </section>

      <PositionsSection report={report} />

      <section className="panel">
        <ClosedPositionsTable report={report} cryptoOnly={false} />
      </section>
      </>
      )}
    </main>
    </TimeZoneContext.Provider>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "pos" | "neg" | "";
}): React.ReactElement {
  return (
    <article className="metricCard">
      <div>{label}</div>
      <strong className={tone ? `metricValue ${tone}` : undefined}>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function PanelHeader({ title, meta }: { title: string; meta?: string }): React.ReactElement {
  return (
    <div className="panelHeader">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function DailyChart({ report, metric }: { report: RebateReport | null; metric: DailyMetric }): React.ReactElement {
  const data = useMemo(() => {
    if (!report) {
      return [];
    }

    let cumulative = 0;
    return report.daily.map((day) => {
      const value = day[metric];
      cumulative += value;
      return {
        date: day.date,
        label: day.date.slice(5),
        value,
        cumulative
      };
    });
  }, [report, metric]);

  if (!report || data.length === 0) {
    return <div className="emptyState">No trades loaded.</div>;
  }

  const isCount = metric === "tradeCount";
  const formatValue = (value: number): string => (isCount ? formatNumber(value) : formatUsd(value));
  const metricLabel = CHART_METRICS.find((option) => option.value === metric)?.label ?? "";

  return (
    <div className="chartWrap">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--chart-axis)" tick={{ fontSize: 11 }} minTickGap={16} />
          <YAxis
            stroke="var(--chart-axis)"
            tick={{ fontSize: 11 }}
            width={48}
            tickFormatter={(value: number) => (isCount ? compactFormatter.format(value) : `$${compactFormatter.format(value)}`)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--chart-grid)",
              borderRadius: 10,
              fontSize: 12
            }}
            labelStyle={{ color: "var(--chart-axis)" }}
            formatter={(value, name) => [formatValue(Number(value)), name === "cumulative" ? "Cumulative" : metricLabel]}
          />
          <Bar dataKey="value" fill="var(--chart-bar)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line type="monotone" dataKey="cumulative" stroke="var(--chart-line)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TierProgress({ report }: { report: RebateReport | null }): React.ReactElement {
  const progress = report?.tier.progressToNext ?? 0;

  return (
    <div className="tierBox">
      <div className="tierLine">
        <span>{report?.tier.current.name ?? "-"}</span>
        <strong>{report?.tier.next?.name ?? "Max tier"}</strong>
      </div>
      <div className="progressTrack" aria-label="Tier progress">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="tierStats">
        <span>{formatPercent(progress)} complete</span>
        <span>{formatUsd(report?.tier.remainingToNext)} remaining</span>
      </div>
    </div>
  );
}

function CategoryBreakdown({ report }: { report: RebateReport | null }): React.ReactElement {
  const maxValue = Math.max(...(report?.categories.map((category) => category.weightedVolume) ?? [0]), 0);

  if (!report || report.categories.length === 0) {
    return <div className="emptyState">No category data.</div>;
  }

  return (
    <div className="stackedRows">
      {report.categories.map((category) => (
        <div className="breakdownRow" key={category.category}>
          <div>
            <strong>{category.label}</strong>
            <span>{category.tradeCount} trades · {category.weight}x</span>
          </div>
          <div className="inlineBar">
            <span style={{ width: `${maxValue > 0 ? (category.weightedVolume / maxValue) * 100 : 0}%` }} />
          </div>
          <strong>{formatUsd(category.weightedVolume)}</strong>
        </div>
      ))}
    </div>
  );
}

function TopEvents({ report }: { report: RebateReport | null }): React.ReactElement {
  if (!report || report.topEvents.length === 0) {
    return <div className="emptyState">No event data.</div>;
  }

  return (
    <div className="eventList">
      {report.topEvents.map((event) => (
        <article className="eventRow" key={event.eventSlug}>
          {event.icon ? <img alt="" src={event.icon} /> : <span className="eventIconFallback" />}
          <div>
            <strong>{event.title}</strong>
            <span>{event.categoryLabel} · {event.tradeCount} trades</span>
          </div>
          <strong>{formatUsd(event.weightedVolume)}</strong>
        </article>
      ))}
    </div>
  );
}

function TradesTable({ report }: { report: RebateReport | null }): React.ReactElement {
  const timeZone = useTimeZone();
  const [query, setQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "BUY" | "SELL">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<TradeSortKey>("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCount, setVisibleCount] = useState(TRADES_PAGE_SIZE);

  const categories = useMemo(() => report?.categories ?? [], [report]);

  const filtered = useMemo(() => {
    if (!report) {
      return [];
    }

    const needle = query.trim().toLowerCase();
    const rows = report.trades.filter((trade) => {
      if (sideFilter !== "all" && trade.side !== sideFilter) {
        return false;
      }
      if (categoryFilter !== "all" && trade.category !== categoryFilter) {
        return false;
      }
      if (needle) {
        const haystack = `${trade.title} ${trade.outcome ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });

    const direction = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (a[sortKey] - b[sortKey]) * direction);
  }, [report, query, sideFilter, categoryFilter, sortKey, sortDir]);

  useEffect(() => {
    setVisibleCount(TRADES_PAGE_SIZE);
  }, [query, sideFilter, categoryFilter, sortKey, sortDir, report]);

  function toggleSort(key: TradeSortKey): void {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: TradeSortKey): string {
    if (sortKey !== key) {
      return "";
    }
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const total = report?.trades.length ?? 0;
  const visible = filtered.slice(0, visibleCount);

  return (
    <div>
      <div className="panelHeader">
        <h2>Taker trades</h2>
        <span>
          {filtered.length} of {total} trades
        </span>
      </div>

      <div className="tableControls">
        <label className="field searchField">
          <span>
            <Search size={16} aria-hidden="true" />
            Search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Market or outcome"
            spellCheck={false}
          />
        </label>

        <div className="controlGroup" role="group" aria-label="Side filter">
          {(["all", "BUY", "SELL"] as const).map((value) => (
            <button
              className={sideFilter === value ? "segmented active" : "segmented"}
              key={value}
              onClick={() => setSideFilter(value)}
              type="button"
            >
              {value === "all" ? "All" : value}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.category} value={category.category}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="ghostButton"
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(tradesToCsv(filtered), csvName(report, "trades"))}
        >
          <Download size={16} aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {!report || total === 0 ? (
        <div className="emptyState">No trades in this range.</div>
      ) : filtered.length === 0 ? (
        <div className="emptyState">No trades match the current filters.</div>
      ) : (
        <>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort("timestamp")}>Time{sortIndicator("timestamp")}</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Outcome</th>
                  <th>Category</th>
                  <th className="sortable" onClick={() => toggleSort("size")}>Size{sortIndicator("size")}</th>
                  <th className="sortable" onClick={() => toggleSort("price")}>Price{sortIndicator("price")}</th>
                  <th className="sortable" onClick={() => toggleSort("takerFee")}>Fee{sortIndicator("takerFee")}</th>
                  <th className="sortable" onClick={() => toggleSort("rawVolume")}>Raw{sortIndicator("rawVolume")}</th>
                  <th className="sortable" onClick={() => toggleSort("weightedVolume")}>wV{sortIndicator("weightedVolume")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <tr key={`${trade.transactionHash}-${trade.asset}-${trade.timestamp}-${trade.size}`}>
                    <td>{formatZonedDateTime(trade.timestamp, timeZone)}</td>
                    <td className="marketCell">{trade.title}</td>
                    <td>
                      <span className={trade.side === "BUY" ? "side buy" : "side sell"}>{trade.side}</span>
                    </td>
                    <td>{trade.outcome ?? "-"}</td>
                    <td>{trade.categoryLabel}</td>
                    <td>{formatNumber(trade.size)}</td>
                    <td>{formatNumber(trade.price)}</td>
                    <td>{formatUsd(trade.takerFee)}</td>
                    <td>{formatUsd(trade.rawVolume)}</td>
                    <td>{formatUsd(trade.weightedVolume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleCount < filtered.length ? (
            <div className="loadMore">
              <button
                className="ghostButton"
                type="button"
                onClick={() => setVisibleCount((count) => count + TRADES_PAGE_SIZE)}
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PositionsSection({ report }: { report: RebateReport | null }): React.ReactElement {
  const positions = report?.positions ?? null;
  const total = report?.profitTotal ?? null;
  const realized = report?.realizedTotal ?? pnlTotal(report?.pnlHistory);
  const unrealized = positions?.totals.unrealizedPnl ?? null;
  const resolved = report?.resolvedMarkets ?? 0;
  const losing = report?.losingMarkets ?? 0;

  return (
    <>
      <section className="metricGrid pnlGrid">
        <MetricCard
          label="Total P/L"
          value={formatSignedUsd(total)}
          detail="Profile total (Polymarket)"
          tone={pnlTone(total)}
        />
        <MetricCard
          label="Realized P/L"
          value={formatSignedUsd(realized)}
          detail={resolved ? `${resolved} resolved · ${losing} losing` : "Reconstructed"}
          tone={pnlTone(realized)}
        />
        <MetricCard
          label="Unrealized P/L"
          value={formatSignedUsd(unrealized)}
          detail={positions ? `${positions.totals.openCount} open positions` : "Open positions"}
          tone={pnlTone(unrealized)}
        />
        <MetricCard
          label="Open value"
          value={formatUsd(positions?.totals.currentValue)}
          detail="Current mark"
        />
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Open positions</h2>
            <p className="panelNote">
              Live positions only. Resolved / auto-redeemed markets are excluded — their P/L is already in the totals above.
            </p>
          </div>
          {positions && positions.items.length > 0 ? (
            <button
              className="ghostButton"
              type="button"
              onClick={() => downloadCsv(positionsToCsv(positions.items), csvName(report, "positions"))}
            >
              <Download size={16} aria-hidden="true" />
              Export CSV
            </button>
          ) : null}
        </div>
        <PositionsTable report={report} />
      </section>
    </>
  );
}

function PnlChart({ report }: { report: RebateReport | null }): React.ReactElement {
  const timeZone = useTimeZone();
  const history = report?.pnlHistory ?? null;
  const data = useMemo(() => (history ?? []).map((point) => ({ t: point.t, p: point.p })), [history]);

  if (!report) {
    return <div className="emptyState">No P/L history loaded.</div>;
  }

  if (!history) {
    return <div className="emptyState">P/L history could not be loaded for this wallet.</div>;
  }

  if (data.length === 0) {
    return <div className="emptyState">No P/L history in this range.</div>;
  }

  const spanDays = (data[data.length - 1].t - data[0].t) / 86_400;
  const intraday = spanDays <= 3;
  const positive = data[data.length - 1].p >= 0;
  const stroke = positive ? "var(--green)" : "var(--red)";

  return (
    <div className="chartWrap">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            stroke="var(--chart-axis)"
            tick={{ fontSize: 11 }}
            minTickGap={56}
            tickFormatter={(value: number) => (intraday ? formatZonedTime(value, timeZone) : formatZonedDate(value, timeZone))}
          />
          <YAxis
            stroke="var(--chart-axis)"
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={(value: number) => `$${compactFormatter.format(value)}`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--chart-grid)",
              borderRadius: 10,
              fontSize: 12
            }}
            labelStyle={{ color: "var(--chart-axis)" }}
            labelFormatter={(value) => formatZonedDateTime(Number(value), timeZone)}
            formatter={(value) => [formatSignedUsd(Number(value)), "Realized P/L"]}
          />
          <ReferenceLine y={0} stroke="var(--chart-axis)" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="p"
            stroke={stroke}
            strokeWidth={2}
            fill="url(#pnlFill)"
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 1.5, fill: stroke }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionsTable({ report }: { report: RebateReport | null }): React.ReactElement {
  if (!report) {
    return <div className="emptyState">No positions loaded.</div>;
  }

  if (!report.positions) {
    return <div className="emptyState">Positions could not be loaded for this wallet.</div>;
  }

  if (report.positions.items.length === 0) {
    return <div className="emptyState">No open positions.</div>;
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Market</th>
            <th>Outcome</th>
            <th>Size</th>
            <th>Avg → Cur</th>
            <th>Value</th>
            <th>P/L</th>
            <th>P/L %</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {report.positions.items.map((position) => (
            <tr key={`${position.conditionId}-${position.asset}`}>
              <td className="marketCell">{position.title}</td>
              <td>{position.outcome ?? "-"}</td>
              <td>{formatNumber(position.size)}</td>
              <td>
                {formatNumber(position.avgPrice)} → {formatNumber(position.curPrice)}
              </td>
              <td>{formatUsd(position.currentValue)}</td>
              <td className={pnlTone(position.cashPnl)}>{formatSignedUsd(position.cashPnl)}</td>
              <td className={pnlTone(position.cashPnl)}>{formatPercent(position.percentPnl / 100)}</td>
              <td>{position.redeemable ? <span className="badge redeemable">Redeemable</span> : "Open"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ClosedSortKey = "resolvedAt" | "realizedPnl" | "entryPrice" | "cost";

const CLOSED_PAGE_SIZE = 50;

function ClosedPositionsTable({
  report,
  cryptoOnly
}: {
  report: RebateReport | null;
  cryptoOnly: boolean;
}): React.ReactElement {
  const timeZone = useTimeZone();
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "Up" | "Down">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss">("all");
  const [sortKey, setSortKey] = useState<ClosedSortKey>("resolvedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCount, setVisibleCount] = useState(CLOSED_PAGE_SIZE);

  const base = useMemo(() => {
    const all = report?.closedPositions ?? [];
    return cryptoOnly ? all.filter((position) => position.isCrypto) : all;
  }, [report, cryptoOnly]);

  const assets = useMemo(() => {
    return Array.from(new Set(base.map((position) => position.asset))).sort();
  }, [base]);

  const filtered = useMemo(() => {
    const rows = base.filter((position) => {
      if (assetFilter !== "all" && position.asset !== assetFilter) {
        return false;
      }
      if (directionFilter !== "all" && position.direction !== directionFilter) {
        return false;
      }
      if (resultFilter === "win" && position.realizedPnl <= 0) {
        return false;
      }
      if (resultFilter === "loss" && position.realizedPnl >= 0) {
        return false;
      }
      return true;
    });

    const direction = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * direction);
  }, [base, assetFilter, directionFilter, resultFilter, sortKey, sortDir]);

  useEffect(() => {
    setVisibleCount(CLOSED_PAGE_SIZE);
  }, [assetFilter, directionFilter, resultFilter, sortKey, sortDir, base]);

  function toggleSort(key: ClosedSortKey): void {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: ClosedSortKey): string {
    if (sortKey !== key) {
      return "";
    }
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const total = base.length;
  const visible = filtered.slice(0, visibleCount);
  const heading = cryptoOnly ? "Closed crypto positions" : "Closed positions";

  return (
    <div>
      <div className="panelHeader">
        <div>
          <h2>{heading}</h2>
          <p className="panelNote">
            Realized P/L per resolved market (buys paired to redeem / sell proceeds). Same data as the P/L curve — broken
            out per position.
          </p>
        </div>
        <span>
          {filtered.length} of {total}
        </span>
      </div>

      <div className="tableControls">
        <label className="field">
          <span>Asset</span>
          <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="all">All assets</option>
            {assets.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </label>

        <div className="controlGroup" role="group" aria-label="Direction filter">
          {(["all", "Up", "Down"] as const).map((value) => (
            <button
              className={directionFilter === value ? "segmented active" : "segmented"}
              key={value}
              onClick={() => setDirectionFilter(value)}
              type="button"
            >
              {value === "all" ? "All" : value}
            </button>
          ))}
        </div>

        <div className="controlGroup" role="group" aria-label="Result filter">
          {(["all", "win", "loss"] as const).map((value) => (
            <button
              className={resultFilter === value ? "segmented active" : "segmented"}
              key={value}
              onClick={() => setResultFilter(value)}
              type="button"
            >
              {value === "all" ? "All" : value === "win" ? "Wins" : "Losses"}
            </button>
          ))}
        </div>

        <button
          className="ghostButton"
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(closedPositionsToCsv(filtered), csvName(report, "closed-positions"))}
        >
          <Download size={16} aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {total === 0 ? (
        <div className="emptyState">No closed positions in this range.</div>
      ) : filtered.length === 0 ? (
        <div className="emptyState">No closed positions match the current filters.</div>
      ) : (
        <>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort("resolvedAt")}>Resolved{sortIndicator("resolvedAt")}</th>
                  <th>Asset</th>
                  <th>Market</th>
                  <th>Direction</th>
                  <th className="sortable" onClick={() => toggleSort("entryPrice")}>Entry{sortIndicator("entryPrice")}</th>
                  <th className="sortable" onClick={() => toggleSort("cost")}>Cost{sortIndicator("cost")}</th>
                  <th>Proceeds</th>
                  <th className="sortable" onClick={() => toggleSort("realizedPnl")}>P/L{sortIndicator("realizedPnl")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((position) => (
                  <tr key={position.conditionId}>
                    <td>{formatZonedDateTime(position.resolvedAt, timeZone)}</td>
                    <td>{position.asset}</td>
                    <td className="marketCell">{position.title}</td>
                    <td>
                      <span className={position.direction === "Up" ? "side buy" : position.direction === "Down" ? "side sell" : "side"}>
                        {position.direction}
                      </span>
                    </td>
                    <td>{position.entryPrice === null ? "-" : formatNumber(position.entryPrice)}</td>
                    <td>{formatUsd(position.cost)}</td>
                    <td>{formatUsd(position.proceeds)}</td>
                    <td className={pnlTone(position.realizedPnl)}>{formatSignedUsd(position.realizedPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleCount < filtered.length ? (
            <div className="loadMore">
              <button
                className="ghostButton"
                type="button"
                onClick={() => setVisibleCount((count) => count + CLOSED_PAGE_SIZE)}
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

interface GroupStat {
  key: string;
  pnl: number;
  count: number;
  wins: number;
  winRate: number;
  avgPnl: number;
}

function groupPnl(items: ClosedPosition[], keyOf: (item: ClosedPosition) => string): GroupStat[] {
  const buckets = new Map<string, { pnl: number; count: number; wins: number }>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key) ?? { pnl: 0, count: 0, wins: 0 };
    bucket.pnl += item.realizedPnl;
    bucket.count += 1;
    if (item.realizedPnl > 0) {
      bucket.wins += 1;
    }
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([key, bucket]) => ({
    key,
    pnl: bucket.pnl,
    count: bucket.count,
    wins: bucket.wins,
    winRate: bucket.count > 0 ? bucket.wins / bucket.count : 0,
    avgPnl: bucket.count > 0 ? bucket.pnl / bucket.count : 0
  }));
}

const ENTRY_PRICE_BUCKETS: Array<{ label: string; test: (price: number) => boolean }> = [
  { label: "<0.90", test: (price) => price < 0.9 },
  { label: "0.90–0.95", test: (price) => price >= 0.9 && price < 0.95 },
  { label: "0.95–0.98", test: (price) => price >= 0.95 && price < 0.98 },
  { label: "0.98–0.99", test: (price) => price >= 0.98 && price < 0.99 },
  { label: "≥0.99", test: (price) => price >= 0.99 }
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function entryPriceBucket(price: number | null): string {
  if (price === null || !Number.isFinite(price)) {
    return "unknown";
  }
  return ENTRY_PRICE_BUCKETS.find((bucket) => bucket.test(price))?.label ?? "unknown";
}

function CryptoStrategyTab({
  report,
  isLoading
}: {
  report: RebateReport | null;
  isLoading: boolean;
}): React.ReactElement {
  const timeZone = useTimeZone();
  const tzLabel = timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const crypto = useMemo(() => (report?.closedPositions ?? []).filter((position) => position.isCrypto), [report]);

  const stats = useMemo(() => {
    const count = crypto.length;
    const pnl = crypto.reduce((total, position) => total + position.realizedPnl, 0);
    const wins = crypto.filter((position) => position.realizedPnl > 0).length;
    return {
      count,
      pnl,
      wins,
      winRate: count > 0 ? wins / count : 0,
      avgPnl: count > 0 ? pnl / count : 0
    };
  }, [crypto]);

  const byAsset = useMemo(
    () => groupPnl(crypto, (item) => item.asset).sort((a, b) => b.pnl - a.pnl),
    [crypto]
  );
  const byDirection = useMemo(() => groupPnl(crypto, (item) => item.direction), [crypto]);
  const byHour = useMemo(() => {
    const stats = groupPnl(crypto, (item) => String(zonedHourWeekday(item.openedAt, timeZone).hour));
    const byKey = new Map(stats.map((stat) => [stat.key, stat]));
    return Array.from({ length: 24 }, (_, hour) => {
      const stat = byKey.get(String(hour));
      return {
        key: `${String(hour).padStart(2, "0")}h`,
        pnl: stat?.pnl ?? 0,
        count: stat?.count ?? 0,
        wins: stat?.wins ?? 0,
        winRate: stat?.winRate ?? 0,
        avgPnl: stat?.avgPnl ?? 0
      };
    });
  }, [crypto, timeZone]);
  const byWeekday = useMemo(() => {
    const stats = groupPnl(crypto, (item) => String(zonedHourWeekday(item.openedAt, timeZone).weekday));
    const byKey = new Map(stats.map((stat) => [stat.key, stat]));
    return WEEKDAY_LABELS.map((label, day) => {
      const stat = byKey.get(String(day));
      return {
        key: label,
        pnl: stat?.pnl ?? 0,
        count: stat?.count ?? 0,
        wins: stat?.wins ?? 0,
        winRate: stat?.winRate ?? 0,
        avgPnl: stat?.avgPnl ?? 0
      };
    });
  }, [crypto, timeZone]);
  const byEntryPrice = useMemo(() => {
    const stats = groupPnl(crypto, (item) => entryPriceBucket(item.entryPrice));
    const order = new Map(ENTRY_PRICE_BUCKETS.map((bucket, index) => [bucket.label, index]));
    return [...stats].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }, [crypto]);

  return (
    <div aria-busy={isLoading}>
      <section className="metricGrid pnlGrid">
        <MetricCard
          label="Crypto realized P/L"
          value={formatSignedUsd(stats.pnl)}
          detail={`${stats.count} closed markets`}
          tone={pnlTone(stats.pnl)}
        />
        <MetricCard
          label="Win rate"
          value={stats.count > 0 ? formatPercent(stats.winRate) : "-"}
          detail={`${stats.wins} wins · ${stats.count - stats.wins} losses`}
        />
        <MetricCard
          label="Avg P/L per market"
          value={formatSignedUsd(stats.avgPnl)}
          detail="Per resolved market"
          tone={pnlTone(stats.avgPnl)}
        />
        <MetricCard
          label="Best / worst asset"
          value={byAsset.length > 0 ? byAsset[0].key : "-"}
          detail={byAsset.length > 0 ? `worst ${byAsset[byAsset.length - 1].key}` : "By total P/L"}
        />
      </section>

      {crypto.length === 0 ? (
        <section className="panel">
          <div className="emptyState">No closed crypto positions in this range.</div>
        </section>
      ) : (
        <>
          <section className="contentGrid">
            <div className="panel">
              <PanelHeader title="P/L by asset" meta="Realized, this range" />
              <PnlByGroupChart data={byAsset} />
            </div>
            <div className="panel">
              <PanelHeader title="P/L by direction" meta="Up vs Down" />
              <PnlByGroupChart data={byDirection} />
            </div>
          </section>

          <section className="contentGrid">
            <div className="panel">
              <PanelHeader title={`P/L by hour (${tzLabel})`} meta="Entry time" />
              <PnlByGroupChart data={byHour} />
            </div>
            <div className="panel">
              <PanelHeader title="P/L by entry price" meta="Buy price bucket" />
              <PnlByGroupChart data={byEntryPrice} />
            </div>
          </section>

          <section className="panel">
            <PanelHeader title={`P/L by weekday (${tzLabel})`} meta="Entry day" />
            <PnlByGroupChart data={byWeekday} />
          </section>

          <section className="panel">
            <ClosedPositionsTable report={report} cryptoOnly />
          </section>
        </>
      )}
    </div>
  );
}

function PnlByGroupChart({ data }: { data: GroupStat[] }): React.ReactElement {
  if (data.length === 0) {
    return <div className="emptyState">No data.</div>;
  }

  return (
    <div className="chartWrap">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="key" stroke="var(--chart-axis)" tick={{ fontSize: 11 }} minTickGap={4} interval={0} />
          <YAxis
            stroke="var(--chart-axis)"
            tick={{ fontSize: 11 }}
            width={48}
            tickFormatter={(value: number) => `$${compactFormatter.format(value)}`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--chart-grid)",
              borderRadius: 10,
              fontSize: 12
            }}
            labelStyle={{ color: "var(--chart-axis)" }}
            formatter={(value, _name, item) => {
              const stat = item?.payload as GroupStat | undefined;
              const winRate = stat ? ` · ${percentFormatter.format(stat.winRate)} win` : "";
              const count = stat ? ` · ${stat.count} mkts` : "";
              return [`${formatSignedUsd(Number(value))}${count}${winRate}`, "Realized P/L"];
            }}
          />
          <ReferenceLine y={0} stroke="var(--chart-axis)" strokeDasharray="3 3" />
          <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={entry.pnl >= 0 ? "var(--green)" : "var(--red)"} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function nextTierLabel(report: RebateReport | null): string {
  if (!report) {
    return "Next threshold";
  }

  return report.tier.next ? `to ${report.tier.next.name}` : "Top tier reached";
}

function sideCountLabel(report: RebateReport | null): string {
  if (!report) {
    return "Buy / sell split";
  }

  return `${report.totals.buyCount} buy · ${report.totals.sellCount} sell`;
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (Math.abs(value) >= 100_000) {
    return `$${compactFormatter.format(value)}`;
  }

  return `$${numberFormatter.format(value)}`;
}

function formatSignedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function pnlTone(value: number | null | undefined): "pos" | "neg" | "" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "";
  }
  return value > 0 ? "pos" : "neg";
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvName(report: RebateReport | null, kind: string): string {
  const wallet = report?.wallet ? report.wallet.slice(0, 10) : "wallet";
  const stamp = new Date().toISOString().slice(0, 10);
  return `polymarket-${kind}-${wallet}-${stamp}.csv`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return numberFormatter.format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return percentFormatter.format(value);
}

function formatZonedDateTime(timestampSec: number, timeZone: string): string {
  return zonedFormatter("datetime", timeZone, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(timestampSec * 1000));
}

function formatZonedDate(timestampSec: number, timeZone: string): string {
  return zonedFormatter("date", timeZone, { month: "short", day: "numeric" }).format(new Date(timestampSec * 1000));
}

function formatZonedTime(timestampSec: number, timeZone: string): string {
  return zonedFormatter("time", timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(timestampSec * 1000)
  );
}

function zonedHourWeekday(timestampSec: number, timeZone: string): { hour: number; weekday: number } {
  const parts = zonedParts(timeZone).formatToParts(new Date(timestampSec * 1000));
  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  // hourCycle h23 renders midnight as "24"; normalise it to 0.
  const hour = Number(hourPart) % 24;
  return { hour: Number.isFinite(hour) ? hour : 0, weekday: WEEKDAY_INDEX[weekdayPart] ?? 0 };
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function dateInputToStartSecond(value: string): number {
  return Math.floor(new Date(`${value}T00:00:00.000Z`).getTime() / 1000);
}

function dateInputToEndSecond(value: string): number {
  return Math.floor(new Date(`${value}T23:59:59.000Z`).getTime() / 1000);
}
