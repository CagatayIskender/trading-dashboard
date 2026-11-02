import type { Bar } from "../types.ts";

/**
 * Free daily history from Yahoo Finance's public chart endpoint. Unofficial, so the
 * fetcher is isolated here and can be swapped (e.g. for Stooq or a paid feed) without
 * touching the engine. Works in Node 18+ and Deno, which both have global fetch.
 */
export async function fetchDailyBars(symbol: string, range = "5y", fetchImpl: typeof fetch = fetch): Promise<Bar[]> {
  // `range` is a Yahoo range ("5y", "10y") or a start date ("2014-01-01") for daily bars from then on.
  const span = /^\d{4}-\d{2}-\d{2}$/.test(range)
    ? `period1=${Math.floor(Date.parse(range) / 1000)}&period2=${Math.floor(Date.now() / 1000)}`
    : `range=${range}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${span}&interval=1d&includeAdjustedClose=true`;
  const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 trading-system" } });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  return parseChart(await res.json());
}

interface ChartJson {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
        adjclose?: { adjclose: (number | null)[] }[];
      };
    }[];
    error?: { description?: string } | null;
  };
}

/** Converts Yahoo's column arrays into bars, using adjusted closes so splits and dividends don't look like crashes. */
export function parseChart(json: unknown): Bar[] {
  const chart = (json as ChartJson).chart;
  if (chart.error) throw new Error(chart.error.description ?? "Yahoo error");
  const r = chart.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0]!;
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const bars: Bar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close[i];
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    if (c == null || o == null || h == null || l == null || c <= 0) continue;
    const factor = adj?.[i] != null ? adj[i]! / c : 1;
    const day = new Date(r.timestamp[i]! * 1000);
    bars.push({
      t: Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
      o: o * factor,
      h: h * factor,
      l: l * factor,
      c: c * factor,
      v: q.volume[i] ?? 0,
    });
  }
  // Yahoo occasionally repeats the last day; keep the latest bar per day.
  const byDay = new Map<number, Bar>();
  for (const b of bars) byDay.set(b.t, b);
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}
