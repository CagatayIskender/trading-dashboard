import type { EngineConfig } from "./config.ts";
import type { MarketView } from "./market.ts";
import type { Fill, Mode, OrderIntent, PortfolioState, Position, Sleeve } from "./types.ts";

export function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function newPortfolio(config: EngineConfig, mode: Mode, t: number): PortfolioState {
  return {
    mode,
    cashEur: config.startingCapitalEur,
    positions: [],
    dayStartEquity: config.startingCapitalEur,
    dayKey: dayKey(t),
    peakEquity: config.startingCapitalEur,
    halted: null,
    lastRebalance: {},
  };
}

export function positionValueEur(p: Position, view: MarketView): number {
  const px = view.priceEur(p.symbol);
  return p.qty * (px ?? p.avgPriceEur);
}

export function equityEur(state: PortfolioState, view: MarketView): number {
  return state.cashEur + state.positions.reduce((s, p) => s + positionValueEur(p, view), 0);
}

export function sleeveValueEur(state: PortfolioState, view: MarketView, sleeve: Sleeve): number {
  return state.positions
    .filter((p) => p.sleeve === sleeve)
    .reduce((s, p) => s + positionValueEur(p, view), 0);
}

export function findPosition(state: PortfolioState, symbol: string, sleeve: Sleeve): Position | undefined {
  return state.positions.find((p) => p.symbol === symbol && p.sleeve === sleeve);
}

function roundQty(qty: number, fractional: boolean): number {
  return fractional ? Math.floor(qty * 1e6) / 1e6 : Math.floor(qty);
}

/**
 * Simulated execution used by demo mode and backtests. Buys fill slightly above and
 * sells slightly below the reference price, and every order pays the fixed fee, so
 * demo results are not flattered compared with real trading.
 */
export function paperFill(
  state: PortfolioState,
  intent: OrderIntent,
  config: EngineConfig,
  t: number,
): Fill | null {
  const slip = config.fees.slippageBps / 10_000;
  const fee = config.fees.perOrderEur;
  if (intent.side === "buy") {
    const price = intent.refPriceEur * (1 + slip);
    const affordable = (state.cashEur - fee) / price;
    const qty = roundQty(Math.min(intent.qty, affordable), config.allowFractional);
    if (qty <= 0) return null;
    return { symbol: intent.symbol, sleeve: intent.sleeve, side: "buy", qty, priceEur: price, feeEur: fee, t, reason: intent.reason, realizedPnlEur: null };
  }
  const pos = findPosition(state, intent.symbol, intent.sleeve);
  if (!pos) return null;
  const qty = Math.min(intent.qty, pos.qty);
  if (qty <= 0) return null;
  const price = intent.refPriceEur * (1 - slip);
  const realized = (price - pos.avgPriceEur) * qty - fee;
  return { symbol: intent.symbol, sleeve: intent.sleeve, side: "sell", qty, priceEur: price, feeEur: fee, t, reason: intent.reason, realizedPnlEur: realized };
}

/** Applies a fill to the portfolio in place. */
export function applyFill(state: PortfolioState, fill: Fill, stopEur: number | null = null): void {
  const pos = findPosition(state, fill.symbol, fill.sleeve);
  if (fill.side === "buy") {
    state.cashEur -= fill.qty * fill.priceEur + fill.feeEur;
    if (pos) {
      const totalQty = pos.qty + fill.qty;
      pos.avgPriceEur = (pos.avgPriceEur * pos.qty + fill.priceEur * fill.qty) / totalQty;
      pos.qty = totalQty;
      pos.peakEur = Math.max(pos.peakEur, fill.priceEur);
      if (stopEur !== null) pos.stopEur = stopEur;
    } else {
      state.positions.push({
        symbol: fill.symbol,
        sleeve: fill.sleeve,
        qty: fill.qty,
        avgPriceEur: fill.priceEur,
        openedAt: fill.t,
        peakEur: fill.priceEur,
        stopEur,
      });
    }
    return;
  }
  if (!pos) return;
  state.cashEur += fill.qty * fill.priceEur - fill.feeEur;
  pos.qty -= fill.qty;
  if (pos.qty <= 1e-9) state.positions = state.positions.filter((p) => p !== pos);
}
