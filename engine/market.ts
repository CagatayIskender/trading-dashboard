import { FX_SYMBOLS } from "./config.ts";
import type { Bar, Currency, Instrument, MarketData } from "./types.ts";

/**
 * A point-in-time view of market data. Strategies only ever see bars up to `asOf`,
 * which is what keeps backtests free of look-ahead bias.
 */
/**
 * Bars a view exposes per symbol. Every indicator in the engine looks back at most ~300 bars
 * (SMA 200, 12-month momentum), and EMAs have fully converged long before 600, so capping the
 * window keeps a multi-year backtest linear in time instead of quadratic.
 */
export const VIEW_WINDOW_BARS = 600;

export class MarketView {
  private cache = new Map<string, Bar[]>();
  private closeCache = new Map<string, number[]>();
  private bySymbol: Map<string, Instrument>;

  constructor(
    private data: MarketData,
    universe: Instrument[],
    public readonly asOf: number,
  ) {
    this.bySymbol = new Map(universe.map((i) => [i.symbol, i]));
  }

  instrument(symbol: string): Instrument | undefined {
    return this.bySymbol.get(symbol);
  }

  /** Bars up to and including asOf, in the instrument's own currency. */
  bars(symbol: string): Bar[] {
    const hit = this.cache.get(symbol);
    if (hit) return hit;
    const all = this.data[symbol] ?? [];
    const end = upperBound(all, this.asOf);
    const out = all.slice(Math.max(0, end - VIEW_WINDOW_BARS), end);
    this.cache.set(symbol, out);
    return out;
  }

  /** Units of `currency` per 1 EUR as of now, or null when FX data is missing. */
  perEur(currency: Exclude<Currency, "EUR">): number | null {
    const fx = this.bars(FX_SYMBOLS[currency]);
    return fx.length ? fx[fx.length - 1]!.c : null;
  }

  /** Converts a price in the instrument's currency to EUR. */
  toEur(symbol: string, price: number): number | null {
    const inst = this.bySymbol.get(symbol);
    if (!inst || inst.currency === "EUR") return price;
    const rate = this.perEur(inst.currency);
    return rate ? price / rate : null;
  }

  /** Latest close in EUR, or null if there is no usable data. */
  priceEur(symbol: string): number | null {
    const b = this.bars(symbol);
    if (!b.length) return null;
    return this.toEur(symbol, b[b.length - 1]!.c);
  }

  /** Close series in the instrument's own currency (indicators are currency-neutral). */
  closes(symbol: string): number[] {
    const hit = this.closeCache.get(symbol);
    if (hit) return hit;
    const out = this.bars(symbol).map((b) => b.c);
    this.closeCache.set(symbol, out);
    return out;
  }

  /** True when the latest bar is no older than `maxAgeMs` (filters halted or delisted data). */
  isFresh(symbol: string, maxAgeMs = 5 * 86_400_000): boolean {
    const b = this.bars(symbol);
    return b.length > 0 && this.asOf - b[b.length - 1]!.t <= maxAgeMs;
  }
}

/** Index of the first bar with t > asOf. */
function upperBound(bars: Bar[], asOf: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid]!.t <= asOf) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
