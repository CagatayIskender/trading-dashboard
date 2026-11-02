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

/**
 * The medium-term layer picks from a wide list on purpose: today's winners (NVIDIA, Microsoft)
 * next to the giants of 2014 that later lagged (GE, IBM, Intel, Bayer, Exxon). A short list of
 * names we already know did well makes backtests look far better than the future will be.
 */
const stock = (symbol: string, name: string, currency: Currency, tactical = false): Instrument =>
  ({ symbol, name, assetClass: "stock", currency, sleeves: tactical ? ["swing", "tactical"] : ["swing"] });

export const DEFAULT_UNIVERSE: Instrument[] = [
  // Core: broad, cheap UCITS ETFs traded on Xetra in EUR.
  { symbol: "EUNL.DE", name: "iShares Core MSCI World", assetClass: "etf", currency: "EUR", sleeves: ["core"] },
  { symbol: "IS3N.DE", name: "iShares Core MSCI EM IMI", assetClass: "etf", currency: "EUR", sleeves: ["core"] },
  // Swing (and some tactical): large caps in the US.
  stock("AAPL", "Apple", "USD", true),
  stock("MSFT", "Microsoft", "USD", true),
  stock("NVDA", "NVIDIA", "USD", true),
  stock("GOOGL", "Alphabet", "USD", true),
  stock("AMZN", "Amazon", "USD", true),
  stock("META", "Meta Platforms", "USD"),
  stock("BRK-B", "Berkshire Hathaway", "USD"),
  stock("JPM", "JPMorgan Chase", "USD"),
  stock("BAC", "Bank of America", "USD"),
  stock("WFC", "Wells Fargo", "USD"),
  stock("V", "Visa", "USD"),
  stock("JNJ", "Johnson & Johnson", "USD"),
  stock("PFE", "Pfizer", "USD"),
  stock("MRK", "Merck & Co.", "USD"),
  stock("UNH", "UnitedHealth", "USD"),
  stock("XOM", "Exxon Mobil", "USD"),
  stock("CVX", "Chevron", "USD"),
  stock("WMT", "Walmart", "USD"),
  stock("PG", "Procter & Gamble", "USD"),
  stock("KO", "Coca-Cola", "USD"),
  stock("PEP", "PepsiCo", "USD"),
  stock("HD", "Home Depot", "USD"),
  stock("DIS", "Walt Disney", "USD"),
  stock("GE", "General Electric", "USD"),
  stock("IBM", "IBM", "USD"),
  stock("INTC", "Intel", "USD"),
  stock("CSCO", "Cisco", "USD"),
  stock("ORCL", "Oracle", "USD"),
  stock("T", "AT&T", "USD"),
  stock("VZ", "Verizon", "USD"),
  // Europe.
  stock("ASML.AS", "ASML", "EUR", true),
  stock("SAP.DE", "SAP", "EUR"),
  stock("SIE.DE", "Siemens", "EUR"),
  stock("ALV.DE", "Allianz", "EUR"),
  stock("DTE.DE", "Deutsche Telekom", "EUR"),
  stock("BAS.DE", "BASF", "EUR"),
  stock("BAYN.DE", "Bayer", "EUR"),
  stock("MC.PA", "LVMH", "EUR"),
  stock("OR.PA", "L'Oréal", "EUR"),
  stock("TTE.PA", "TotalEnergies", "EUR"),
  stock("SAN.PA", "Sanofi", "EUR"),
  stock("AIR.PA", "Airbus", "EUR"),
  stock("NOVO-B.CO", "Novo Nordisk", "DKK"),
  stock("NESN.SW", "Nestlé", "CHF"),
  stock("NOVN.SW", "Novartis", "CHF"),
  stock("ROG.SW", "Roche", "CHF"),
  // Tactical: crypto, traded 24/7.
  { symbol: "BTC-EUR", name: "Bitcoin", assetClass: "crypto", currency: "EUR", sleeves: ["tactical"] },
  { symbol: "ETH-EUR", name: "Ethereum", assetClass: "crypto", currency: "EUR", sleeves: ["tactical"] },
];

/** The original 11-stock list, kept to compare backtests against. */
export const NARROW_SWING = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "JPM", "ASML.AS", "SAP.DE", "SIE.DE", "MC.PA", "NOVO-B.CO"];

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
    momentumLookbackDays: 189,
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
  CHF: "EURCHF=X",
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
