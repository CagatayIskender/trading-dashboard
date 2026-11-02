import type { Bar } from "./types.ts";

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!;
  return sum / period;
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, then roll forward.
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i]!;
  e /= period;
  for (let i = period; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/**
 * Wilder smoothing forgets old data geometrically: after 20 periods the weight left on the
 * seed is below 1e-6 of a typical move, so RSI and ATR only read this many recent bars.
 */
const WILDER_TAIL_PERIODS = 20;

/** Wilder's RSI. */
export function rsi(all: number[], period = 14): number | null {
  const values = all.length > period * WILDER_TAIL_PERIODS ? all.slice(-period * WILDER_TAIL_PERIODS) : all;
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Wilder's Average True Range. */
export function atr(all: Bar[], period = 14): number | null {
  const bars = all.length > period * WILDER_TAIL_PERIODS ? all.slice(-period * WILDER_TAIL_PERIODS) : all;
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const prevClose = bars[i - 1]!.c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose)));
  }
  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i]!;
  a /= period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]!) / period;
  return a;
}

/** Total return from `lookback` days ago to `skip` days ago. */
export function momentum(values: number[], lookback: number, skip = 0): number | null {
  const end = values.length - 1 - skip;
  const start = end - lookback;
  if (start < 0 || end < 0) return null;
  const from = values[start]!;
  if (from <= 0) return null;
  return values[end]! / from - 1;
}

/** Annualised volatility of daily returns over the last `period` days. */
export function volatility(values: number[], period = 63, periodsPerYear = 252): number | null {
  if (values.length < period + 1) return null;
  const rets: number[] = [];
  for (let i = values.length - period; i < values.length; i++) {
    rets.push(values[i]! / values[i - 1]! - 1);
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}
