import { NextResponse } from "next/server";

import { DAY_SECONDS, DEFAULT_WALLET, type RangeMode, type ReportRange, validateWallet } from "@/lib/rebate";
import { buildRebateReport } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 365;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const wallet = (url.searchParams.get("wallet") || DEFAULT_WALLET).trim().toLowerCase();

  if (!validateWallet(wallet)) {
    return NextResponse.json({ error: "Wallet must be a 0x-prefixed 40-hex address." }, { status: 400 });
  }

  const rangeResult = parseRange(url.searchParams, new Date());
  if ("error" in rangeResult) {
    return NextResponse.json({ error: rangeResult.error }, { status: 400 });
  }

  try {
    const report = await buildRebateReport({
      wallet,
      range: rangeResult.range
    });

    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to build rebate report."
      },
      { status: 502 }
    );
  }
}

function parseRange(
  searchParams: URLSearchParams,
  now: Date
): { range: ReportRange } | { error: string } {
  const explicitStart = parseUnixSecond(searchParams.get("start"));
  const explicitEnd = parseUnixSecond(searchParams.get("end"));

  if ((explicitStart === null) !== (explicitEnd === null)) {
    return { error: "Provide both start and end when using a custom range." };
  }

  if (explicitStart !== null && explicitEnd !== null) {
    if (explicitStart >= explicitEnd) {
      return { error: "Custom range start must be before end." };
    }

    const days = Math.ceil((explicitEnd - explicitStart) / DAY_SECONDS);
    if (days > MAX_RANGE_DAYS) {
      return { error: `Custom range cannot exceed ${MAX_RANGE_DAYS} days.` };
    }

    return {
      range: {
        startSec: explicitStart,
        endSec: explicitEnd,
        mode: "custom",
        days
      }
    };
  }

  const mode = parseMode(searchParams.get("mode"));
  if (!mode) {
    return { error: "Mode must be live or checkpoint." };
  }

  const days = parseDays(searchParams.get("days"));
  if (!days || days < 1 || days > MAX_RANGE_DAYS) {
    return { error: `Days must be an integer from 1 to ${MAX_RANGE_DAYS}.` };
  }

  const endSec = mode === "checkpoint" ? lastUtcMidnightSec(now) : Math.floor(now.getTime() / 1000);

  return {
    range: {
      startSec: endSec - days * DAY_SECONDS,
      endSec,
      mode,
      days
    }
  };
}

function parseMode(value: string | null): Exclude<RangeMode, "custom"> | null {
  if (value === null || value === "live") {
    return "live";
  }

  if (value === "checkpoint") {
    return "checkpoint";
  }

  return null;
}

function parseDays(value: string | null): number | null {
  if (value === null || value === "") {
    return 30;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseUnixSecond(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function lastUtcMidnightSec(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}
