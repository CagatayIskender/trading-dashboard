import { findPosition, positionValueEur } from "../portfolio.ts";
import type { OrderIntent } from "../types.ts";
import { DAY_MS, sleeveBudgetEur, type StrategyContext } from "./context.ts";

/**
 * Long-term layer: hold broad ETFs at fixed target weights and only trade when a
 * weight has drifted far enough to be worth the fee. Most of the capital lives here.
 */
export function coreStrategy(ctx: StrategyContext): OrderIntent[] {
  const { state, view, config, t } = ctx;
  const budget = sleeveBudgetEur(ctx, "core");
  if (budget <= 0) return [];

  const held = state.positions.filter((p) => p.sleeve === "core");
  const last = state.lastRebalance.core;
  const firstFunding = held.length === 0;
  if (!firstFunding && last !== undefined && t - last < config.core.minDaysBetweenRebalance * DAY_MS) return [];

  const intents: OrderIntent[] = [];
  let drifted = firstFunding;
  const plan: { symbol: string; diffEur: number; price: number }[] = [];

  for (const [symbol, weight] of Object.entries(config.core.targets)) {
    const price = view.priceEur(symbol);
    if (price === null || !view.isFresh(symbol)) continue;
    const pos = findPosition(state, symbol, "core");
    const current = pos ? positionValueEur(pos, view) : 0;
    const target = budget * weight;
    if (Math.abs(current / budget - weight) > config.core.driftThresholdPct) drifted = true;
    plan.push({ symbol, diffEur: target - current, price });
  }
  // Positions no longer in the targets are sold.
  for (const pos of held) {
    if (config.core.targets[pos.symbol] === undefined) {
      const price = view.priceEur(pos.symbol);
      if (price !== null) {
        intents.push({ symbol: pos.symbol, sleeve: "core", side: "sell", qty: pos.qty, refPriceEur: price, reason: "Artık hedef dağılımda değil" });
      }
    }
  }
  if (!drifted) return intents;

  for (const p of plan) {
    if (Math.abs(p.diffEur) < config.risk.minOrderEur) continue;
    const qty = Math.abs(p.diffEur) / p.price;
    intents.push({
      symbol: p.symbol,
      sleeve: "core",
      side: p.diffEur > 0 ? "buy" : "sell",
      qty,
      refPriceEur: p.price,
      reason: firstFunding
        ? `Uzun vade: hedef ağırlık %${Math.round((config.core.targets[p.symbol] ?? 0) * 100)}`
        : "Uzun vade: hedef ağırlığa yeniden dengeleme",
    });
  }
  if (intents.length) state.lastRebalance.core = t;
  return intents;
}
