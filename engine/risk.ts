import type { EngineConfig } from "./config.ts";
import type { MarketView } from "./market.ts";
import { dayKey, findPosition, positionValueEur, sleeveValueEur } from "./portfolio.ts";
import type { EngineEvent, OrderIntent, PortfolioState } from "./types.ts";

/**
 * Updates day/peak bookkeeping and the circuit breakers. Returns events for the log.
 * - Daily loss limit: no new buys for the rest of the day.
 * - Max drawdown: no new buys until the user resets it from the panel.
 */
export function updateRiskState(state: PortfolioState, equity: number, config: EngineConfig, t: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  const today = dayKey(t);
  if (state.dayKey !== today) {
    state.dayKey = today;
    state.dayStartEquity = equity;
    if (state.halted && state.halted.until !== null && state.halted.until <= t) {
      events.push({ t, level: "info", message: "Günlük zarar limiti sıfırlandı, alımlar yeniden açık" });
      state.halted = null;
    }
  }
  state.peakEquity = Math.max(state.peakEquity, equity);

  const drawdown = state.peakEquity > 0 ? 1 - equity / state.peakEquity : 0;
  if (drawdown >= config.risk.maxDrawdownPct && state.halted?.until !== null) {
    state.halted = { reason: `Zirveden %${(drawdown * 100).toFixed(1)} düşüş: yeni alımlar durduruldu`, until: null };
    events.push({ t, level: "risk", message: state.halted.reason });
  } else if (!state.halted) {
    const dayLoss = state.dayStartEquity > 0 ? 1 - equity / state.dayStartEquity : 0;
    if (dayLoss >= config.risk.dailyLossLimitPct) {
      const nextDay = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
      state.halted = { reason: `Bugün %${(dayLoss * 100).toFixed(1)} kayıp: alımlar yarına kadar durdu`, until: nextDay };
      events.push({ t, level: "risk", message: state.halted.reason });
    }
  }
  return events;
}

/** Raises trailing peaks and returns sells for positions that broke their stop. */
export function stopExits(state: PortfolioState, view: MarketView, config: EngineConfig): OrderIntent[] {
  const out: OrderIntent[] = [];
  for (const p of state.positions) {
    const px = view.priceEur(p.symbol);
    if (px === null) continue;
    p.peakEur = Math.max(p.peakEur, px);
    if (p.stopEur !== null && px < p.stopEur) {
      out.push({ symbol: p.symbol, sleeve: p.sleeve, side: "sell", qty: p.qty, refPriceEur: px, reason: `Zarar durdur: ${p.stopEur.toFixed(2)} € seviyesi kırıldı` });
      continue;
    }
    if (p.sleeve === "tactical" && px < p.peakEur * (1 - config.risk.trailingStopPct)) {
      out.push({ symbol: p.symbol, sleeve: p.sleeve, side: "sell", qty: p.qty, refPriceEur: px, reason: `İz süren stop: zirveden %${Math.round(config.risk.trailingStopPct * 100)} düştü` });
    }
  }
  return out;
}

/**
 * Last line of defence before an order is executed or sent for approval.
 * Sells always pass. Buys are trimmed or dropped when they break a limit.
 */
export function filterIntents(
  intents: OrderIntent[],
  state: PortfolioState,
  view: MarketView,
  config: EngineConfig,
  equity: number,
  t: number,
): { approved: OrderIntent[]; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const approved: OrderIntent[] = [];
  const sells = dedupe(intents.filter((i) => i.side === "sell"));
  const buys = intents.filter((i) => i.side === "buy");
  approved.push(...sells);

  if (state.halted && buys.length) {
    events.push({ t, level: "risk", message: `${buys.length} alım engellendi: ${state.halted.reason}` });
    return { approved, events };
  }

  // Cash freed by sells in this cycle can fund buys in the same cycle.
  const freed = sells.reduce((s, i) => s + i.qty * i.refPriceEur - config.fees.perOrderEur, 0);
  let spendable = state.cashEur + freed - equity * config.risk.cashBufferPct;

  for (const b of buys) {
    let valueEur = b.qty * b.refPriceEur;
    const sleeveCap = equity * config.sleeveWeights[b.sleeve] * config.risk.maxPositionPctOfSleeve;
    const existing = findPosition(state, b.symbol, b.sleeve);
    const room = sleeveCap - (existing ? positionValueEur(existing, view) : 0);
    // Core ETFs are the diversified base, so the single-position cap does not apply.
    if (b.sleeve !== "core" && valueEur > room) valueEur = Math.max(0, room);
    const sleeveRoom = equity * config.sleeveWeights[b.sleeve] - sleeveValueEur(state, view, b.sleeve);
    valueEur = Math.min(valueEur, sleeveRoom + config.risk.minOrderEur * 0.5, spendable - config.fees.perOrderEur);
    if (valueEur < config.risk.minOrderEur) {
      events.push({ t, level: "info", message: `${b.symbol} alımı atlandı: tutar ${valueEur.toFixed(0)} €, alt sınır ${config.risk.minOrderEur} €` });
      continue;
    }
    spendable -= valueEur + config.fees.perOrderEur;
    approved.push({ ...b, qty: valueEur / b.refPriceEur });
  }
  return { approved, events };
}

function dedupe(sells: OrderIntent[]): OrderIntent[] {
  const seen = new Map<string, OrderIntent>();
  for (const s of sells) {
    const k = `${s.symbol}|${s.sleeve}`;
    if (!seen.has(k)) seen.set(k, s); // first reason wins (stops are evaluated first)
  }
  return [...seen.values()];
}
