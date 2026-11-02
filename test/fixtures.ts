import { DEFAULT_CONFIG, FX_SYMBOL, type EngineConfig } from "../engine/config.ts";
import type { Bar, MarketData } from "../engine/types.ts";

/** Deterministic PRNG so tests are repeatable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export const T0 = Date.UTC(2020, 0, 1);
export const DAY = 86_400_000;

/** Geometric random walk with drift, one bar per calendar day. */
export function walk(days: number, opts: { start?: number; drift?: number; vol?: number; seed?: number } = {}): Bar[] {
  const r = rng(opts.seed ?? 1);
  let p = opts.start ?? 100;
  const drift = opts.drift ?? 0.0003;
  const vol = opts.vol ?? 0.01;
  const bars: Bar[] = [];
  for (let i = 0; i < days; i++) {
    const shock = (r() + r() + r() - 1.5) * 2 * vol; // ~normal
    const o = p;
    p = Math.max(0.01, p * (1 + drift + shock));
    const h = Math.max(o, p) * (1 + vol * 0.3);
    const l = Math.min(o, p) * (1 - vol * 0.3);
    bars.push({ t: T0 + i * DAY, o, h, l, c: p, v: 1000 });
  }
  return bars;
}

export function flat(days: number, price: number): Bar[] {
  return Array.from({ length: days }, (_, i) => ({ t: T0 + i * DAY, o: price, h: price, l: price, c: price, v: 1 }));
}

export function syntheticMarket(days = 700): MarketData {
  const data: MarketData = { [FX_SYMBOL]: flat(days, 1.1) };
  DEFAULT_CONFIG.universe.forEach((inst, i) => {
    data[inst.symbol] = walk(days, { seed: 100 + i, drift: 0.0001 + (i % 5) * 0.0002, vol: inst.assetClass === "crypto" ? 0.03 : 0.012 });
  });
  return data;
}

export function config(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return structuredClone({ ...DEFAULT_CONFIG, ...overrides });
}
