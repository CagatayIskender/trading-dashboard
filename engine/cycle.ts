import type { EngineConfig } from "./config.ts";
import { MarketView } from "./market.ts";
import { applyFill, equityEur, paperFill } from "./portfolio.ts";
import { filterIntents, stopExits, updateRiskState } from "./risk.ts";
import { coreStrategy } from "./strategies/core.ts";
import { swingStrategy } from "./strategies/swing.ts";
import { tacticalStrategy } from "./strategies/tactical.ts";
import type { StrategyContext } from "./strategies/context.ts";
import type { EngineEvent, Fill, MarketData, OrderIntent, PortfolioState, Signal } from "./types.ts";

export interface CycleInput {
  state: PortfolioState; // mutated in place in demo mode
  data: MarketData;
  config: EngineConfig;
  signals: Signal[];
  t: number;
  /** Strategies run once a day; stops are checked on every tick. */
  runStrategies: boolean;
}

export interface CycleResult {
  fills: Fill[]; // executed (demo only)
  pending: OrderIntent[]; // waiting for the user's approval (live only)
  events: EngineEvent[];
  equityEur: number;
}

/**
 * One engine tick. In demo mode orders are filled immediately on paper. In live mode
 * nothing is executed: orders are returned as pending approvals for the user, who
 * places them in Trade Republic (which has no trading API).
 */
export function runCycle(input: CycleInput): CycleResult {
  const { state, data, config, signals, t } = input;
  const view = new MarketView(data, config.universe, t);
  const events: EngineEvent[] = [];
  let equity = equityEur(state, view);
  events.push(...updateRiskState(state, equity, config, t));

  const intents: OrderIntent[] = stopExits(state, view, config);
  if (input.runStrategies) {
    const ctx: StrategyContext = { state, view, config, signals, equityEur: equity, t };
    intents.push(...coreStrategy(ctx), ...swingStrategy(ctx), ...tacticalStrategy(ctx));
  }

  const { approved, events: riskEvents } = filterIntents(intents, state, view, config, equity, t);
  events.push(...riskEvents);

  if (state.mode === "live") {
    return { fills: [], pending: approved, events, equityEur: equity };
  }

  const fills: Fill[] = [];
  // Sells first so their cash is available to the buys.
  for (const intent of [...approved].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1))) {
    const fill = paperFill(state, intent, config, t);
    if (!fill) continue;
    applyFill(state, fill, intent.stopEur ?? null);
    fills.push(fill);
  }
  equity = equityEur(state, view);
  return { fills, pending: [], events, equityEur: equity };
}
