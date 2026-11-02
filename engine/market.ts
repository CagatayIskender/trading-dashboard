import { FX_SYMBOL } from "./config.ts";
import type { Bar, Instrument, MarketData } from "./types.ts";

/**
 * A point-in-time view of market data. Strategies only ever see bars up to `asOf`,
 * which is what keeps backtests free of look-ahead bias.
 */
export class MarketView {
  private cache = new Map<string, Bar[]>();
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
    const out = all.slice(0, upperBound(all, this.asOf));
    this.cache.set(symbol, out);
    return out;
  }

  /** USD per 1 EUR as of now, or null when FX data is missing. */
  usdPerEur(): number | null {
    const fx = this.bars(FX_SYMBOL);
    return fx.length ? fx[fx.length - 1]!.c : null;
  }

  /** Converts a price in the instrument's currency to EUR. */
  toEur(symbol: string, price: number): number | null {
    const inst = this.bySymbol.get(symbol);
    if (!inst || inst.currency === "EUR") return price;
    const rate = this.usdPerEur();
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
    return this.bars(symbol).map((b) => b.c);
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
