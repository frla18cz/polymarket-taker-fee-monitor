import type { CalculatedTrade, PolymarketPosition } from "@/lib/rebate";

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }

  return lines.join("\n");
}

function utcIso(timestampSec: number): string {
  return new Date(timestampSec * 1000).toISOString();
}

export function tradesToCsv(trades: CalculatedTrade[]): string {
  const headers = [
    "time_utc",
    "market",
    "side",
    "outcome",
    "category",
    "size",
    "price",
    "taker_fee",
    "raw_volume",
    "weighted_volume",
    "transaction_hash"
  ];

  const rows = trades.map((trade) => [
    utcIso(trade.timestamp),
    trade.title,
    trade.side,
    trade.outcome ?? "",
    trade.categoryLabel,
    trade.size,
    trade.price,
    trade.takerFee,
    trade.rawVolume,
    trade.weightedVolume,
    trade.transactionHash ?? ""
  ]);

  return toCsv(headers, rows);
}

export function positionsToCsv(items: PolymarketPosition[]): string {
  const headers = [
    "market",
    "outcome",
    "size",
    "avg_price",
    "cur_price",
    "initial_value",
    "current_value",
    "cash_pnl",
    "percent_pnl",
    "realized_pnl",
    "redeemable"
  ];

  const rows = items.map((item) => [
    item.title,
    item.outcome ?? "",
    item.size,
    item.avgPrice,
    item.curPrice,
    item.initialValue,
    item.currentValue,
    item.cashPnl,
    item.percentPnl,
    item.realizedPnl,
    item.redeemable ? "yes" : "no"
  ]);

  return toCsv(headers, rows);
}
