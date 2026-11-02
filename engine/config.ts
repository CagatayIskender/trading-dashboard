import type { AssetClass, Currency, Instrument, Sleeve } from "./types.ts";

/**
 * All tunables live here so the web panel can edit them (stored as JSON in the
 * `settings` table). Nothing should be hard-coded in strategies.
 */
export interface EngineConfig {
  startingCapitalEur: number;
  /** Share of equity each strategy layer may use. Must sum to <= 1. */
  sleeveWeights: Record<Sleeve, number>;
  fees: {
    perOrderEur: number; // Trade Republic: 1 EUR per order
    slippageBps: number; // assumed price impact per fill
  };
  allowFractional: boolean;
  risk: {
    minOrderEur: number; // below this the fixed fee is too large a share
    cashBufferPct: number; // always keep this share of equity in cash
    maxPositionPctOfSleeve: number;
    dailyLossLimitPct: number; // stop new buys for the rest of the day
    maxDrawdownPct: number; // stop all new buys after this fall from the peak
    /** Days the drawdown brake stays on before buying resumes by itself (0 = only a manual reset). */
    drawdownPauseDays: number;
    swingStopAtr: number; // initial stop distance in ATRs
    tacticalStopAtr: number;
    trailingStopPct: number; // tactical trailing stop from peak
  };
  core: {
    targets: Record<string, number>; // symbol -> weight inside the core sleeve
    driftThresholdPct: number; // rebalance only when a weight drifts this far
    minDaysBetweenRebalance: number;
  };
  swing: {
    maxPositions: number;
    momentumLookbackDays: number;
    skipRecentDays: number; // classic 12-1 style momentum skips the last month
    trendSma: number;
    aiWeight: number; // 0..1, how much the AI signal moves the ranking
    rebalanceEveryDays: number;
    /** Extra rank places a held name may slip before it is sold (0 = sell as soon as it leaves the top). */
    holdBuffer?: number;
  };
  tactical: {
    maxPositions: number;
    fastEma: number;
    slowEma: number;
    rsiMax: number; // do not chase overbought moves
    aiWeight: number;
    /** Only enter when price is above this long average (0 turns the filter off). */
    regimeSma: number;
    /** Days to wait after an exit before buying the same symbol again. */
    cooldownDays: number;
    /** Days a position is held before a trend exit may close it (stops still apply). */
    minHoldDays: number;
    /** Asset classes this layer may trade. */
    assetClasses: AssetClass[];
  };
  universe: Instrument[];
  benchmark: string; // symbol used to judge performance
}

export const DEFAULT_UNIVERSE: Instrument[] = [
  // Core: broad, cheap UCITS ETFs traded on Xetra in EUR.
  { symbol: "EUNL.DE", name: "iShares Core MSCI World", assetClass: "etf", currency: "EUR", sleeves: ["core"] },
  { symbol: "IS3N.DE", name: "iShares Core MSCI EM IMI", assetClass: "etf", currency: "EUR", sleeves: ["core"] },
  // Swing: liquid large caps across the US and Europe.
  { symbol: "AAPL", name: "Apple", assetClass: "stock", currency: "USD", sleeves: ["swing", "tactical"] },
  { symbol: "MSFT", name: "Microsoft", assetClass: "stock", currency: "USD", sleeves: ["swing", "tactical"] },
  { symbol: "NVDA", name: "NVIDIA", assetClass: "stock", currency: "USD", sleeves: ["swing", "tactical"] },
  { symbol: "GOOGL", name: "Alphabet", assetClass: "stock", currency: "USD", sleeves: ["swing", "tactical"] },
  { symbol: "AMZN", name: "Amazon", assetClass: "stock", currency: "USD", sleeves: ["swing", "tactical"] },
  { symbol: "JPM", name: "JPMorgan Chase", assetClass: "stock", currency: "USD", sleeves: ["swing"] },
  { symbol: "ASML.AS", name: "ASML", assetClass: "stock", currency: "EUR", sleeves: ["swing", "tactical"] },
  { symbol: "SAP.DE", name: "SAP", assetClass: "stock", currency: "EUR", sleeves: ["swing"] },
  { symbol: "SIE.DE", name: "Siemens", assetClass: "stock", currency: "EUR", sleeves: ["swing"] },
  { symbol: "MC.PA", name: "LVMH", assetClass: "stock", currency: "EUR", sleeves: ["swing"] },
  { symbol: "NOVO-B.CO", name: "Novo Nordisk", assetClass: "stock", currency: "DKK", sleeves: ["swing"] },
  // Tactical: crypto, traded 24/7.
  { symbol: "BTC-EUR", name: "Bitcoin", assetClass: "crypto", currency: "EUR", sleeves: ["tactical"] },
  { symbol: "ETH-EUR", name: "Ethereum", assetClass: "crypto", currency: "EUR", sleeves: ["tactical"] },
];

export const DEFAULT_CONFIG: EngineConfig = {
  startingCapitalEur: 2000,
  sleeveWeights: { core: 0.7, swing: 0.2, tactical: 0.1 },
  fees: { perOrderEur: 1, slippageBps: 10 },
  allowFractional: true,
  risk: {
    minOrderEur: 50,
    cashBufferPct: 0.02,
    maxPositionPctOfSleeve: 0.4,
    dailyLossLimitPct: 0.03,
    // Chosen from ~115 backtests 2014-2026 (2026-11-02): the brake lifts itself, which mattered most.
    maxDrawdownPct: 0.2,
    drawdownPauseDays: 20,
    swingStopAtr: 3,
    tacticalStopAtr: 3,
    trailingStopPct: 0.15,
  },
  core: {
    targets: { "EUNL.DE": 0.9, "IS3N.DE": 0.1 },
    driftThresholdPct: 0.05,
    minDaysBetweenRebalance: 30,
  },
  swing: {
    maxPositions: 3,
    momentumLookbackDays: 126,
    skipRecentDays: 21,
    trendSma: 200,
    aiWeight: 0.4,
    // Fewer swaps: reviewed every two weeks and a held name may slip two places before it is sold.
    rebalanceEveryDays: 14,
    holdBuffer: 2,
  },
  tactical: {
    maxPositions: 2,
    fastEma: 20,
    slowEma: 50,
    rsiMax: 85,
    aiWeight: 0.3,
    // Chosen from 5y and 10y backtests (2026-11-02): fewer, better short-term trades.
    regimeSma: 200,
    cooldownDays: 10,
    minHoldDays: 0,
    assetClasses: ["etf", "stock", "crypto"],
  },
  universe: DEFAULT_UNIVERSE,
  benchmark: "EUNL.DE",
};

/** Yahoo FX symbols quoting units of each currency per 1 EUR. */
export const FX_SYMBOLS: Record<Exclude<Currency, "EUR">, string> = {
  USD: "EURUSD=X",
  DKK: "EURDKK=X",
};
/** Kept for callers that only need the USD rate. */
export const FX_SYMBOL = FX_SYMBOLS.USD;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer _U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Deep-merges settings from the panel (or a backtest variant) over a base config. Arrays are replaced. */
export function mergeConfig(base: EngineConfig, overrides: DeepPartial<EngineConfig> | undefined): EngineConfig {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const walk = (target: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      const cur = target[k];
      if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
        walk(cur as Record<string, unknown>, v as Record<string, unknown>);
      } else if (v !== undefined) {
        target[k] = structuredClone(v);
      }
    }
  };
  if (overrides) walk(out, overrides as Record<string, unknown>);
  return out as unknown as EngineConfig;
}
