import type { Currency, Instrument, Sleeve } from "./types.ts";

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
    maxDrawdownPct: number; // stop all new buys until manually reset
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
  };
  tactical: {
    maxPositions: number;
    fastEma: number;
    slowEma: number;
    rsiMax: number; // do not chase overbought moves
    aiWeight: number;
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
    maxDrawdownPct: 0.15,
    swingStopAtr: 3,
    tacticalStopAtr: 2,
    trailingStopPct: 0.08,
  },
  core: {
    targets: { "EUNL.DE": 0.8, "IS3N.DE": 0.2 },
    driftThresholdPct: 0.05,
    minDaysBetweenRebalance: 30,
  },
  swing: {
    maxPositions: 3,
    momentumLookbackDays: 126,
    skipRecentDays: 21,
    trendSma: 200,
    aiWeight: 0.4,
    rebalanceEveryDays: 7,
  },
  tactical: {
    maxPositions: 2,
    fastEma: 20,
    slowEma: 50,
    rsiMax: 75,
    aiWeight: 0.3,
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
