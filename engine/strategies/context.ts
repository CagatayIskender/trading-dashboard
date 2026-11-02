import type { EngineConfig } from "../config.ts";
import type { MarketView } from "../market.ts";
import type { PortfolioState, Signal, Sleeve } from "../types.ts";

export interface StrategyContext {
  state: PortfolioState;
  view: MarketView;
  config: EngineConfig;
  signals: Signal[];
  equityEur: number;
  t: number;
}

export const DAY_MS = 86_400_000;

/** EUR the given sleeve may hold in total, after the cash buffer. */
export function sleeveBudgetEur(ctx: StrategyContext, sleeve: Sleeve): number {
  return ctx.equityEur * (1 - ctx.config.risk.cashBufferPct) * ctx.config.sleeveWeights[sleeve];
}

/** Latest non-expired AI score for a symbol, 0 when there is none. */
export function aiScore(signals: Signal[], symbol: string, t: number, horizon?: Signal["horizon"]): number {
  let best: Signal | null = null;
  for (const s of signals) {
    if (s.symbol !== symbol || s.expiresAt < t || s.createdAt > t) continue;
    if (horizon && s.horizon !== horizon) continue;
    if (!best || s.createdAt > best.createdAt) best = s;
  }
  return best ? Math.max(-1, Math.min(1, best.score)) : 0;
}

export function aiRationale(signals: Signal[], symbol: string, t: number): string | null {
  const live = signals
    .filter((s) => s.symbol === symbol && s.expiresAt >= t && s.createdAt <= t)
    .sort((a, b) => b.createdAt - a.createdAt);
  return live[0]?.rationale ?? null;
}

export function fmtEur(v: number): string {
  return `${v.toFixed(2)} €`;
}
