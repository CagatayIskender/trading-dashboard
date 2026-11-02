// Core domain types. Everything in engine/ is pure TypeScript with no I/O,
// so the same code runs in Node (tests, backtests) and Deno (Supabase Edge Functions).

export type Sleeve = "core" | "swing" | "tactical";
export type AssetClass = "etf" | "stock" | "crypto";
export type Currency = "EUR" | "USD" | "DKK";
export type Mode = "demo" | "live";

export interface Instrument {
  symbol: string; // data-provider symbol, e.g. "EUNL.DE", "AAPL", "BTC-EUR"
  name: string;
  assetClass: AssetClass;
  currency: Currency;
  sleeves: Sleeve[]; // which strategy layers may hold it
}

export interface Bar {
  t: number; // unix ms, start of the day (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Daily history per symbol, oldest first. Prices in the instrument's own currency. */
export type MarketData = Record<string, Bar[]>;

export interface Position {
  symbol: string;
  sleeve: Sleeve;
  qty: number;
  avgPriceEur: number;
  openedAt: number;
  /** Highest close seen since entry, in EUR; used for trailing stops. */
  peakEur: number;
  /** Hard stop level in EUR; the position is closed when price falls below it. */
  stopEur: number | null;
}

export interface PortfolioState {
  mode: Mode;
  cashEur: number;
  positions: Position[];
  /** Equity at the start of the current day, for the daily loss limit. */
  dayStartEquity: number;
  dayKey: string; // YYYY-MM-DD the dayStartEquity belongs to
  /** Highest equity ever reached, for the drawdown kill switch. */
  peakEquity: number;
  /** Set when a risk limit stops new buying; cleared by the rule that set it. */
  halted: null | { reason: string; until: number | null; kind?: "daily" | "drawdown" };
  lastRebalance: Partial<Record<Sleeve, number>>;
  /** When each symbol|sleeve was last sold, for re-entry cooldowns. */
  lastExit?: Record<string, number>;
}

export type Side = "buy" | "sell";

export interface OrderIntent {
  symbol: string;
  sleeve: Sleeve;
  side: Side;
  qty: number;
  refPriceEur: number;
  reason: string; // human readable, shown in the panel
  /** Protective stop to attach to the position when a buy fills. */
  stopEur?: number | null;
}

export interface Fill {
  symbol: string;
  sleeve: Sleeve;
  side: Side;
  qty: number;
  priceEur: number;
  feeEur: number;
  t: number;
  reason: string;
  realizedPnlEur: number | null;
}

export interface EngineEvent {
  t: number;
  level: "info" | "warn" | "risk";
  message: string;
}

/** An AI-produced view on an instrument, written by the scheduled Claude analysis. */
export interface Signal {
  symbol: string;
  score: number; // -1 (strong sell) .. +1 (strong buy)
  horizon: "short" | "medium" | "long";
  rationale: string;
  createdAt: number;
  expiresAt: number;
}
