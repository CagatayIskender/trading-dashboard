import type { EngineConfig } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { MarketView } from "./market.ts";
import { newPortfolio } from "./portfolio.ts";
import type { EngineEvent, Fill, MarketData, Signal } from "./types.ts";

export interface EquityPoint {
  t: number;
  equity: number;
  benchmark: number;
}

export interface Metrics {
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  sharpe: number;
  trades: number;
  feesEur: number;
  winRate: number | null;
  benchmarkReturn: number;
  benchmarkCagr: number;
  benchmarkMaxDrawdown: number;
}

export interface BacktestResult {
  curve: EquityPoint[];
  fills: Fill[];
  events: EngineEvent[];
  metrics: Metrics;
}

/**
 * Replays history one trading day at a time through the exact same runCycle used
 * live. Warm-up days give indicators (e.g. the 200-day average) enough history.
 */
export function backtest(data: MarketData, config: EngineConfig, opts: { warmupDays?: number; signals?: Signal[] } = {}): BacktestResult {
  const warmup = opts.warmupDays ?? 220;
  const bench = data[config.benchmark] ?? [];
  if (bench.length <= warmup + 1) throw new Error(`Not enough ${config.benchmark} history for a backtest`);
  // Benchmark trading days drive the calendar; crypto weekend bars are picked up on the next day.
  const days = bench.slice(warmup).map((b) => b.t);
  const state = newPortfolio(config, "demo", days[0]!);
  const curve: EquityPoint[] = [];
  const fills: Fill[] = [];
  const events: EngineEvent[] = [];
  const benchStart = bench[warmup]!.c;

  for (const t of days) {
    const r = runCycle({ state, data, config, signals: opts.signals ?? [], t, runStrategies: true });
    fills.push(...r.fills);
    events.push(...r.events);
    const bpx = new MarketView(data, config.universe, t).bars(config.benchmark).at(-1)!.c;
    curve.push({ t, equity: r.equityEur, benchmark: (config.startingCapitalEur * bpx) / benchStart });
  }
  return { curve, fills, events, metrics: computeMetrics(curve, fills, config.startingCapitalEur) };
}

export function computeMetrics(curve: EquityPoint[], fills: Fill[], start: number): Metrics {
  const years = curve.length > 1 ? (curve.at(-1)!.t - curve[0]!.t) / (365.25 * 86_400_000) : 0;
  const end = curve.at(-1)?.equity ?? start;
  const bEnd = curve.at(-1)?.benchmark ?? start;
  const sells = fills.filter((f) => f.side === "sell" && f.realizedPnlEur !== null);
  return {
    startEquity: start,
    endEquity: end,
    totalReturn: end / start - 1,
    cagr: cagr(start, end, years),
    maxDrawdown: maxDrawdown(curve.map((p) => p.equity)),
    sharpe: sharpe(curve.map((p) => p.equity)),
    trades: fills.length,
    feesEur: fills.reduce((s, f) => s + f.feeEur, 0),
    winRate: sells.length ? sells.filter((f) => f.realizedPnlEur! > 0).length / sells.length : null,
    benchmarkReturn: bEnd / start - 1,
    benchmarkCagr: cagr(start, bEnd, years),
    benchmarkMaxDrawdown: maxDrawdown(curve.map((p) => p.benchmark)),
  };
}

export interface SleeveStats {
  trades: number;
  feesEur: number;
  realizedEur: number; // after fees on both legs
  winRate: number | null;
}

/** Trade count and realised result per strategy layer. */
export function sleeveStats(fills: Fill[]): Record<string, SleeveStats> {
  const out: Record<string, SleeveStats & { wins: number; sells: number }> = {};
  for (const f of fills) {
    const s = (out[f.sleeve] ??= { trades: 0, feesEur: 0, realizedEur: 0, winRate: null, wins: 0, sells: 0 });
    s.trades++;
    s.feesEur += f.feeEur;
    if (f.side === "buy") s.realizedEur -= f.feeEur; // buy fee is not inside realizedPnl
    if (f.side === "sell" && f.realizedPnlEur !== null) {
      s.realizedEur += f.realizedPnlEur;
      s.sells++;
      if (f.realizedPnlEur > 0) s.wins++;
    }
  }
  const res: Record<string, SleeveStats> = {};
  for (const [k, { wins, sells, ...s }] of Object.entries(out)) res[k] = { ...s, winRate: sells ? wins / sells : null };
  return res;
}

function cagr(start: number, end: number, years: number): number {
  return years > 0 && start > 0 ? (end / start) ** (1 / years) - 1 : 0;
}

export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    worst = Math.max(worst, 1 - v / peak);
  }
  return worst;
}

function sharpe(values: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i]! / values[i - 1]! - 1);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}
