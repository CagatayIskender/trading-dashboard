import { describe, expect, it } from "vitest";
import { backtest, maxDrawdown } from "../engine/backtest.ts";
import { FX_SYMBOL } from "../engine/config.ts";
import { runCycle } from "../engine/cycle.ts";
import { parseChart } from "../engine/data/yahoo.ts";
import { atr, ema, momentum, rsi, sma } from "../engine/indicators.ts";
import { MarketView } from "../engine/market.ts";
import { applyFill, equityEur, newPortfolio, paperFill } from "../engine/portfolio.ts";
import { filterIntents, stopExits, updateRiskState } from "../engine/risk.ts";
import { rankSwing, swingStrategy } from "../engine/strategies/swing.ts";
import { config, DAY, flat, syntheticMarket, T0, walk } from "./fixtures.ts";

describe("indicators", () => {
  it("computes simple averages and momentum", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1], 2)).toBeNull();
    expect(momentum([100, 110, 121], 2)).toBeCloseTo(0.21);
    expect(momentum([100, 110, 121], 1, 1)).toBeCloseTo(0.1);
  });
  it("keeps EMA and RSI in sensible ranges", () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(ema(up, 10)!).toBeLessThan(159);
    expect(ema(up, 10)!).toBeGreaterThan(150);
    expect(rsi(up)).toBe(100);
    const down = [...up].reverse();
    expect(rsi(down)!).toBeLessThan(1);
  });
  it("computes ATR from true ranges", () => {
    expect(atr(flat(30, 50))).toBe(0);
    expect(atr(walk(30))!).toBeGreaterThan(0);
  });
});

describe("paper broker", () => {
  it("charges the fee and slippage and never spends more than the cash", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "demo", T0);
    const fill = paperFill(s, { symbol: "X", sleeve: "swing", side: "buy", qty: 1000, refPriceEur: 10, reason: "" }, cfg, T0)!;
    expect(fill.priceEur).toBeCloseTo(10.01);
    expect(fill.qty * fill.priceEur + fill.feeEur).toBeLessThanOrEqual(2000 + 1e-6);
    applyFill(s, fill);
    expect(s.cashEur).toBeGreaterThanOrEqual(0);
    const sell = paperFill(s, { symbol: "X", sleeve: "swing", side: "sell", qty: fill.qty, refPriceEur: 10, reason: "" }, cfg, T0)!;
    expect(sell.realizedPnlEur!).toBeLessThan(0); // round trip at the same price loses fees + slippage
    applyFill(s, sell);
    expect(s.positions).toHaveLength(0);
    expect(s.cashEur).toBeCloseTo(2000 - 2 - fill.qty * 0.02, 1);
  });
});

describe("risk", () => {
  const data = syntheticMarket(300);
  const t = T0 + 299 * DAY;

  it("blocks new buys while halted but still lets sells through", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "demo", t);
    s.halted = { reason: "test", until: null };
    s.positions.push({ symbol: "AAPL", sleeve: "swing", qty: 1, avgPriceEur: 100, openedAt: T0, peakEur: 100, stopEur: null });
    const view = new MarketView(data, cfg.universe, t);
    const { approved } = filterIntents(
      [
        { symbol: "MSFT", sleeve: "swing", side: "buy", qty: 1, refPriceEur: 100, reason: "" },
        { symbol: "AAPL", sleeve: "swing", side: "sell", qty: 1, refPriceEur: 100, reason: "" },
      ],
      s, view, cfg, 2000, t,
    );
    expect(approved.map((a) => a.side)).toEqual(["sell"]);
  });

  it("drops buys below the minimum order size and caps single positions", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "demo", t);
    const view = new MarketView(data, cfg.universe, t);
    const { approved } = filterIntents(
      [
        { symbol: "MSFT", sleeve: "swing", side: "buy", qty: 0.1, refPriceEur: 100, reason: "" }, // 10 EUR
        { symbol: "AAPL", sleeve: "swing", side: "buy", qty: 10, refPriceEur: 100, reason: "" }, // 1000 EUR
      ],
      s, view, cfg, 2000, t,
    );
    expect(approved).toHaveLength(1);
    const value = approved[0]!.qty * approved[0]!.refPriceEur;
    expect(value).toBeLessThanOrEqual(2000 * 0.2 * 0.4 + 1e-6); // 40% of the 20% swing sleeve
  });

  it("exits a position that breaks its stop", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "demo", t);
    const view = new MarketView(data, cfg.universe, t);
    const px = view.priceEur("AAPL")!;
    s.positions.push({ symbol: "AAPL", sleeve: "swing", qty: 1, avgPriceEur: px * 1.5, openedAt: T0, peakEur: px * 1.5, stopEur: px * 1.1 });
    expect(stopExits(s, view, cfg)).toHaveLength(1);
  });

  it("lifts the drawdown brake by itself after the pause and re-bases the peak", () => {
    const cfg = config();
    cfg.risk.maxDrawdownPct = 0.15;
    cfg.risk.drawdownPauseDays = 30;
    const s = newPortfolio(cfg, "demo", T0);
    updateRiskState(s, 2000, cfg, T0);
    updateRiskState(s, 1600, cfg, T0 + 3 * DAY);
    expect(s.halted?.kind).toBe("drawdown");
    updateRiskState(s, 1580, cfg, T0 + 20 * DAY);
    expect(s.halted).not.toBeNull();
    updateRiskState(s, 1590, cfg, T0 + 35 * DAY);
    expect(s.halted).toBeNull();
    expect(s.peakEquity).toBe(1590);
  });

  it("halts buying after a big drawdown until reset when the pause is 0", () => {
    const cfg = config();
    cfg.risk.maxDrawdownPct = 0.15;
    cfg.risk.drawdownPauseDays = 0;
    const s = newPortfolio(cfg, "demo", T0);
    updateRiskState(s, 2000, cfg, T0);
    updateRiskState(s, 1600, cfg, T0 + 3 * DAY);
    expect(s.halted?.until).toBeNull();
    updateRiskState(s, 1700, cfg, T0 + 10 * DAY);
    expect(s.halted).not.toBeNull();
  });
});

describe("cycle", () => {
  const data = syntheticMarket(400);
  const t = T0 + 399 * DAY;

  it("funds the long-term layer first at its target weights", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "demo", t);
    runCycle({ state: s, data, config: cfg, signals: [], t, runStrategies: true });
    const view = new MarketView(data, cfg.universe, t);
    const core = s.positions.filter((p) => p.sleeve === "core");
    expect(core.map((p) => p.symbol).sort()).toEqual(["EUNL.DE", "IS3N.DE"]);
    const coreValue = core.reduce((v, p) => v + p.qty * view.priceEur(p.symbol)!, 0);
    expect(coreValue / equityEur(s, view)).toBeGreaterThan(0.6);
    expect(coreValue / equityEur(s, view)).toBeLessThan(0.72);
    expect(s.cashEur).toBeGreaterThan(0);
  });

  it("never executes in live mode; it only proposes orders for approval", () => {
    const cfg = config();
    const s = newPortfolio(cfg, "live", t);
    const r = runCycle({ state: s, data, config: cfg, signals: [], t, runStrategies: true });
    expect(r.fills).toHaveLength(0);
    expect(r.pending.length).toBeGreaterThan(0);
    expect(s.cashEur).toBe(2000);
    expect(s.positions).toHaveLength(0);
  });

  it("lets a strong AI signal pull a stock into the medium-term picks", () => {
    const cfg = config({ swing: { ...config().swing, aiWeight: 0.9 } });
    const view = new MarketView(data, cfg.universe, t);
    const ctx = { state: newPortfolio(cfg, "demo", t), view, config: cfg, signals: [], equityEur: 2000, t };
    const ranked = rankSwing(ctx);
    // Lowest-ranked name that is still in an uptrend: never picked without the AI.
    const target = [...ranked].reverse().find((c) => c.inTrend)!.symbol;
    expect(ranked.filter((c) => c.inTrend && c.score > 0).slice(0, 3).map((c) => c.symbol)).not.toContain(target);

    const s = newPortfolio(cfg, "demo", t);
    const signals = [{ symbol: target, score: 1, horizon: "medium" as const, rationale: "Güçlü bilanço", createdAt: t - DAY, expiresAt: t + DAY }];
    runCycle({ state: s, data, config: cfg, signals, t, runStrategies: true });
    const swing = s.positions.filter((p) => p.sleeve === "swing").map((p) => p.symbol);
    expect(swing).toContain(target);
  });
});

describe("backtest", () => {
  it("replays history without going negative and reports metrics", () => {
    const cfg = config();
    const r = backtest(syntheticMarket(700), cfg);
    expect(r.curve.length).toBe(700 - 220);
    expect(r.curve.every((p) => p.equity > 0)).toBe(true);
    expect(r.metrics.trades).toBeGreaterThan(2);
    expect(r.metrics.feesEur).toBe(r.metrics.trades * cfg.fees.perOrderEur);
    expect(r.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it("has no look-ahead: changing the future does not change the past", () => {
    const cfg = config();
    const a = syntheticMarket(600);
    const b = structuredClone(a);
    for (const sym of Object.keys(b)) {
      if (sym === FX_SYMBOL) continue;
      b[sym] = b[sym]!.map((bar, i) => (i >= 500 ? { ...bar, c: bar.c * 3, h: bar.h * 3 } : bar));
    }
    const ra = backtest(a, cfg);
    const rb = backtest(b, cfg);
    const cut = ra.curve.findIndex((p) => p.t >= T0 + 499 * DAY);
    expect(rb.curve.slice(0, cut).map((p) => p.equity)).toEqual(ra.curve.slice(0, cut).map((p) => p.equity));
  });

  it("measures drawdown from the running peak", () => {
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(0.25);
  });
});

describe("currency", () => {
  it("converts USD and DKK prices to EUR", () => {
    const cfg = config();
    const data = syntheticMarket(10);
    const view = new MarketView(data, cfg.universe, T0 + 9 * DAY);
    expect(view.toEur("AAPL", 110)).toBeCloseTo(100);
    expect(view.toEur("NOVO-B.CO", 746)).toBeCloseTo(100);
    expect(view.toEur("SAP.DE", 100)).toBe(100);
  });
});

describe("yahoo parser", () => {
  it("uses adjusted closes and skips empty rows", () => {
    const bars = parseChart({
      chart: {
        result: [{
          timestamp: [1700000000, 1700086400, 1700172800],
          indicators: {
            quote: [{ open: [10, null, 12], high: [11, null, 13], low: [9, null, 11], close: [10, null, 12], volume: [5, null, 6] }],
            adjclose: [{ adjclose: [5, null, 6] }],
          },
        }],
        error: null,
      },
    });
    expect(bars).toHaveLength(2);
    expect(bars[0]!.c).toBe(5);
    expect(bars[0]!.h).toBe(5.5);
  });
});

describe("config and stats helpers", () => {
  it("deep-merges overrides without touching the base", async () => {
    const { mergeConfig, DEFAULT_CONFIG } = await import("../engine/config.ts");
    const merged = mergeConfig(DEFAULT_CONFIG, { tactical: { cooldownDays: 3 }, risk: { trailingStopPct: 0.12 } });
    expect(merged.tactical.cooldownDays).toBe(3);
    expect(merged.tactical.fastEma).toBe(DEFAULT_CONFIG.tactical.fastEma);
    expect(merged.risk.trailingStopPct).toBe(0.12);
    expect(DEFAULT_CONFIG.tactical.cooldownDays).toBe(10);
  });

  it("a re-entry cooldown cuts short-term trading", () => {
    const data = syntheticMarket(700);
    const loose = backtest(data, config({ tactical: { ...config().tactical, cooldownDays: 0, minHoldDays: 0, regimeSma: 0, rsiMax: 75 } }));
    const strict = backtest(data, config({ tactical: { ...config().tactical, cooldownDays: 20, minHoldDays: 10, rsiMax: 75 } }));
    const count = (r: typeof loose) => r.fills.filter((f) => f.sleeve === "tactical").length;
    expect(count(strict)).toBeLessThan(count(loose));
  });

  it("splits results by layer", async () => {
    const { sleeveStats } = await import("../engine/backtest.ts");
    const s = sleeveStats([
      { symbol: "A", sleeve: "swing", side: "buy", qty: 1, priceEur: 100, feeEur: 1, t: 0, reason: "", realizedPnlEur: null },
      { symbol: "A", sleeve: "swing", side: "sell", qty: 1, priceEur: 110, feeEur: 1, t: 1, reason: "", realizedPnlEur: 9 },
    ]);
    expect(s.swing).toEqual({ trades: 2, feesEur: 2, realizedEur: 8, winRate: 1 });
  });
});

describe("swing hold buffer", () => {
  it("keeps a held name that slipped just outside the top picks", () => {
    const data = syntheticMarket(400);
    const t = T0 + 399 * DAY;
    const base = config();
    base.swing.holdBuffer = 0;
    const view = new MarketView(data, base.universe, t);
    const ctx = (cfg: typeof base, s: ReturnType<typeof newPortfolio>) => ({ state: s, view, config: cfg, signals: [], equityEur: 2000, t });
    const eligible = rankSwing(ctx(base, newPortfolio(base, "demo", T0))).filter((c) => c.inTrend && c.score > 0);
    expect(eligible.length).toBeGreaterThan(base.swing.maxPositions);
    const fourth = eligible[base.swing.maxPositions]!.symbol;
    const hold = (cfg: typeof base) => {
      const s = newPortfolio(cfg, "demo", T0);
      s.positions.push({ symbol: fourth, sleeve: "swing", qty: 1, avgPriceEur: 10, openedAt: T0, peakEur: 10, stopEur: null });
      return swingStrategy(ctx(cfg, s));
    };
    expect(hold(base).some((i) => i.symbol === fourth && i.side === "sell")).toBe(true);
    const buffered = config();
    buffered.swing.holdBuffer = 1;
    const out = hold(buffered);
    expect(out.some((i) => i.symbol === fourth)).toBe(false);
    expect(out.filter((i) => i.side === "buy")).toHaveLength(buffered.swing.maxPositions - 1);
  });
});
