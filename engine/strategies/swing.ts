import { atr, momentum, sma, volatility } from "../indicators.ts";
import { findPosition } from "../portfolio.ts";
import type { OrderIntent } from "../types.ts";
import { aiRationale, aiScore, DAY_MS, sleeveBudgetEur, type StrategyContext } from "./context.ts";

export interface SwingCandidate {
  symbol: string;
  score: number;
  momentum: number;
  ai: number;
  inTrend: boolean;
}

/**
 * Ranks the swing universe. Price momentum (adjusted for volatility so a calm
 * steady riser beats a wild one) is turned into a rank between -1 and 1, then
 * blended with the AI view from news and financial statements.
 */
export function rankSwing(ctx: StrategyContext): SwingCandidate[] {
  const { view, config, signals, t } = ctx;
  const sc = config.swing;
  const raw: { symbol: string; mom: number; inTrend: boolean }[] = [];
  for (const inst of config.universe) {
    if (!inst.sleeves.includes("swing") || !view.isFresh(inst.symbol)) continue;
    const closes = view.closes(inst.symbol);
    const mom = momentum(closes, sc.momentumLookbackDays, sc.skipRecentDays);
    const vol = volatility(closes);
    const trend = sma(closes, sc.trendSma);
    if (mom === null || vol === null || trend === null || vol <= 0) continue;
    raw.push({ symbol: inst.symbol, mom: mom / vol, inTrend: closes[closes.length - 1]! > trend });
  }
  const sorted = [...raw].sort((a, b) => a.mom - b.mom);
  const n = sorted.length;
  return sorted
    .map((r, i) => {
      const rank = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
      const ai = aiScore(signals, r.symbol, t);
      return {
        symbol: r.symbol,
        momentum: r.mom,
        ai,
        inTrend: r.inTrend,
        score: (1 - sc.aiWeight) * rank + sc.aiWeight * ai,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Medium-term layer: hold the few best-ranked names in an uptrend, reviewed weekly. */
export function swingStrategy(ctx: StrategyContext): OrderIntent[] {
  const { state, view, config, t } = ctx;
  const sc = config.swing;
  const last = state.lastRebalance.swing;
  if (last !== undefined && t - last < sc.rebalanceEveryDays * DAY_MS) return [];

  const budget = sleeveBudgetEur(ctx, "swing");
  const ranked = rankSwing(ctx);
  const eligible = ranked.filter((c) => c.inTrend && c.score > 0);
  // A held name is kept while it stays inside the top maxPositions + holdBuffer, so small
  // rank changes do not cause a sell and a buy (two fees) every review.
  const keepWithin = sc.maxPositions + (sc.holdBuffer ?? 0);
  const held = state.positions.filter((p) => p.sleeve === "swing");
  const kept = new Set(held.filter((p) => {
    const i = eligible.findIndex((c) => c.symbol === p.symbol);
    return i >= 0 && i < keepWithin;
  }).map((p) => p.symbol));
  const picks = eligible.filter((c) => !kept.has(c.symbol)).slice(0, Math.max(0, sc.maxPositions - kept.size));
  const intents: OrderIntent[] = [];

  for (const pos of held) {
    if (kept.has(pos.symbol)) continue;
    const price = view.priceEur(pos.symbol);
    if (price === null) continue;
    const c = ranked.find((r) => r.symbol === pos.symbol);
    const why = !c ? "veri yok" : !c.inTrend ? "yükseliş trendi bozuldu" : "sıralamada geriledi";
    intents.push({ symbol: pos.symbol, sleeve: "swing", side: "sell", qty: pos.qty, refPriceEur: price, reason: `Orta vade çıkış: ${why}` });
  }

  const slot = budget / sc.maxPositions;
  for (const pick of picks) {
    if (findPosition(state, pick.symbol, "swing")) continue;
    const price = view.priceEur(pick.symbol);
    const a = atr(view.bars(pick.symbol));
    if (price === null || a === null) continue;
    const atrEur = view.toEur(pick.symbol, a) ?? 0;
    const note = aiRationale(ctx.signals, pick.symbol, t);
    intents.push({
      symbol: pick.symbol,
      sleeve: "swing",
      side: "buy",
      qty: slot / price,
      refPriceEur: price,
      stopEur: price - config.risk.swingStopAtr * atrEur,
      reason: `Orta vade giriş: skor ${pick.score.toFixed(2)}, trend yukarı${note ? `. YZ: ${note}` : ""}`,
    });
  }
  state.lastRebalance.swing = t;
  return intents;
}
