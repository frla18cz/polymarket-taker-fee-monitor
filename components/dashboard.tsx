"use client";

import { AlertTriangle, CalendarDays, Download, RefreshCw, Search, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { tradesToCsv, positionsToCsv } from "@/lib/csv";
import { DEFAULT_WALLET, pnlTotal, validateWallet, type RebateReport } from "@/lib/rebate";

type RangeValue = "7" | "14" | "30" | "90" | "custom";
type PresetMode = "live" | "checkpoint";

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

const utcDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

const utcDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

const utcTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23"
});

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

  const rangeLabel = useMemo(() => {
    if (!report) {
      return "No range loaded";
    }

    return `${formatUtcDateTime(report.range.startSec)} to ${formatUtcDateTime(report.range.endSec)}`;
  }, [report]);

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
    </main>
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
                    <td>{formatUtcDateTime(trade.timestamp)}</td>
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
            tickFormatter={(value: number) => (intraday ? formatUtcTime(value) : formatUtcDate(value))}
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
            labelFormatter={(value) => formatUtcDateTime(Number(value))}
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

function formatUtcDateTime(timestampSec: number): string {
  return utcDateTimeFormatter.format(new Date(timestampSec * 1000));
}

function formatUtcDate(timestampSec: number): string {
  return utcDateFormatter.format(new Date(timestampSec * 1000));
}

function formatUtcTime(timestampSec: number): string {
  return utcTimeFormatter.format(new Date(timestampSec * 1000));
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
