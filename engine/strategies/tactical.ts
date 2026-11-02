import { atr, ema, momentum, rsi, sma } from "../indicators.ts";
import { findPosition } from "../portfolio.ts";
import type { OrderIntent } from "../types.ts";
import { aiRationale, aiScore, DAY_MS, sleeveBudgetEur, type StrategyContext } from "./context.ts";

/**
 * Short-term layer: follow strong trends in crypto and fast-moving stocks with tight
 * stops. Small by design (10% of capital) because it is the riskiest part.
 */
export function tacticalStrategy(ctx: StrategyContext): OrderIntent[] {
  const { state, view, config, signals, t } = ctx;
  const tc = config.tactical;
  const intents: OrderIntent[] = [];

  type Setup = { symbol: string; entry: boolean; exit: boolean; strength: number; price: number; atrEur: number };
  const setups: Setup[] = [];
  for (const inst of config.universe) {
    if (!inst.sleeves.includes("tactical") || !view.isFresh(inst.symbol)) continue;
    if (tc.assetClasses && !tc.assetClasses.includes(inst.assetClass)) continue;
    const closes = view.closes(inst.symbol);
    const fast = ema(closes, tc.fastEma);
    const slow = ema(closes, tc.slowEma);
    const r = rsi(closes);
    const a = atr(view.bars(inst.symbol));
    const mom = momentum(closes, 20);
    const price = view.priceEur(inst.symbol);
    if (fast === null || slow === null || r === null || a === null || mom === null || price === null) continue;
    const last = closes[closes.length - 1]!;
    const ai = aiScore(signals, inst.symbol, t, "short");
    const regime = tc.regimeSma ? sma(closes, tc.regimeSma) : null;
    const regimeOk = !tc.regimeSma || (regime !== null && last > regime);
    const exitedAt = state.lastExit?.[`${inst.symbol}|tactical`];
    const cooled = !tc.cooldownDays || exitedAt === undefined || t - exitedAt >= tc.cooldownDays * DAY_MS;
    setups.push({
      symbol: inst.symbol,
      entry: last > fast && fast > slow && r < tc.rsiMax && ai > -0.3 && regimeOk && cooled,
      exit: last < slow || ai < -0.5,
      strength: (1 - tc.aiWeight) * mom + tc.aiWeight * ai,
      price,
      atrEur: view.toEur(inst.symbol, a) ?? 0,
    });
  }

  const held = state.positions.filter((p) => p.sleeve === "tactical");
  let open = held.length;
  for (const pos of held) {
    const s = setups.find((x) => x.symbol === pos.symbol);
    const heldLongEnough = !tc.minHoldDays || t - pos.openedAt >= tc.minHoldDays * DAY_MS;
    if (s?.exit && heldLongEnough) {
      intents.push({ symbol: pos.symbol, sleeve: "tactical", side: "sell", qty: pos.qty, refPriceEur: s.price, reason: "Kısa vade çıkış: trend zayıfladı" });
      open--;
    }
  }

  const slot = sleeveBudgetEur(ctx, "tactical") / tc.maxPositions;
  const candidates = setups.filter((s) => s.entry && !findPosition(state, s.symbol, "tactical")).sort((a, b) => b.strength - a.strength);
  for (const c of candidates) {
    if (open >= tc.maxPositions) break;
    const note = aiRationale(signals, c.symbol, t);
    intents.push({
      symbol: c.symbol,
      sleeve: "tactical",
      side: "buy",
      qty: slot / c.price,
      refPriceEur: c.price,
      stopEur: c.price - config.risk.tacticalStopAtr * c.atrEur,
      reason: `Kısa vade giriş: güçlü trend${note ? `. YZ: ${note}` : ""}`,
    });
    open++;
  }
  return intents;
}
