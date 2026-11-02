// Supabase Edge Function, called every 15 minutes by pg_cron (see supabase/migrations/0002_schedule.sql).
// Runs the engine for every active account: stop checks on each tick, strategies once a day.
// With body {"action":"backtest","range":"5y","label":"...","overrides":{...}} it instead replays real history and stores
// the result in backtest_runs. With {"action":"sweep","from":"2014-01-01","split":"2021-01-01","run":"name","variants":[...]}
// it tests many settings in a chain of small calls (see runSweep).
// `./engine` is a copy of the repo's engine/ made by scripts/prepare-functions.sh before deploy.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { DEFAULT_CONFIG, FX_SYMBOLS, mergeConfig, type EngineConfig } from "./engine/config.ts";
import { backtest, periodStats, sleeveStats } from "./engine/backtest.ts";
import { runCycle } from "./engine/cycle.ts";
import { fetchDailyBars } from "./engine/data/yahoo.ts";
import type { Bar, MarketData, PortfolioState, Signal } from "./engine/types.ts";

const STRATEGY_HOUR_UTC = 15; // after the European close, during US trading
const HISTORY_DAYS = 400; // enough for the 200-day average plus warm-up

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(db, req))) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (body?.action === "sweep") return runSweep(db, req, body);
  if (body?.action === "backtest") {
    return runBacktest(db, typeof body.range === "string" ? body.range : "5y", body.overrides, typeof body.label === "string" ? body.label : null);
  }
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const { data: accounts, error } = await db.from("accounts").select("*").eq("active", true);
  if (error) return new Response(error.message, { status: 500 });
  if (!accounts?.length) return Response.json({ ok: true, accounts: 0 });

  // One download per symbol per tick, shared by all accounts.
  const symbols = new Set<string>(Object.values(FX_SYMBOLS));
  for (const a of accounts) for (const i of mergeConfig(DEFAULT_CONFIG, a.config).universe) symbols.add(i.symbol);
  const data = await loadMarket(db, [...symbols], now);

  const { data: sigRows } = await db.from("signals").select("*").gt("expires_at", new Date(now).toISOString());
  const signals: Signal[] = (sigRows ?? []).map((s) => ({
    symbol: s.symbol, score: s.score, horizon: s.horizon, rationale: s.rationale,
    createdAt: Date.parse(s.created_at), expiresAt: Date.parse(s.expires_at),
  }));

  const summary = [];
  for (const a of accounts) {
    // Stored settings sit on top of the defaults, so new settings get sensible values.
    const config: EngineConfig = mergeConfig(DEFAULT_CONFIG, a.config);
    const state = a.state as PortfolioState;
    const runStrategies = a.last_strategy_day !== today && new Date(now).getUTCHours() >= STRATEGY_HOUR_UTC;
    const r = runCycle({ state, data, config, signals, t: now, runStrategies });

    if (r.fills.length) {
      await db.from("fills").insert(r.fills.map((f) => ({
        account_id: a.id, t: new Date(f.t).toISOString(), symbol: f.symbol, sleeve: f.sleeve, side: f.side,
        qty: f.qty, price_eur: f.priceEur, fee_eur: f.feeEur, realized_pnl_eur: f.realizedPnlEur, reason: f.reason,
      })));
    }
    if (r.pending.length) await queueApprovals(db, a.id, r.pending);
    if (r.events.length) {
      await db.from("events").insert(r.events.map((e) => ({ account_id: a.id, t: new Date(e.t).toISOString(), level: e.level, message: e.message })));
    }
    await db.from("equity_snapshots").upsert({ account_id: a.id, t: new Date(now).toISOString(), equity_eur: r.equityEur, cash_eur: state.cashEur });
    // Live state only changes when the user confirms an order, so it is not overwritten here
    // except for risk bookkeeping (peaks, halts, rebalance dates).
    await db.from("accounts").update({
      state,
      last_strategy_day: runStrategies ? today : a.last_strategy_day,
      updated_at: new Date(now).toISOString(),
    }).eq("id", a.id);
    summary.push({ account: a.name, fills: r.fills.length, pending: r.pending.length, equity: Math.round(r.equityEur * 100) / 100 });
  }
  return Response.json({ ok: true, ranStrategies: summary });
});

// deno-lint-ignore no-explicit-any
async function runBacktest(db: any, range: string, overrides: unknown, label: string | null): Promise<Response> {
  const config = mergeConfig(DEFAULT_CONFIG, overrides as Partial<EngineConfig>);
  const data: MarketData = {};
  const missing: string[] = [];
  await Promise.all([...config.universe.map((i) => i.symbol), ...Object.values(FX_SYMBOLS)].map(async (s) => {
    try {
      data[s] = await fetchDailyBars(s, range);
    } catch (e) {
      missing.push(`${s}: ${(e as Error).message}`);
    }
  }));
  const r = backtest(data, config);
  // Weekly points keep the stored curve small.
  const curve = r.curve.filter((_, i) => i % 5 === 0 || i === r.curve.length - 1);
  const bySleeve = sleeveStats(r.fills);
  await db.from("backtest_runs").insert({ range, label, config, metrics: { ...r.metrics, bySleeve }, curve, fills: r.fills });
  return Response.json({ label, range, metrics: r.metrics, bySleeve, missing, days: r.curve.length });
}

/**
 * Runs `batch` variants (a function call has a small CPU budget), stores each result in backtest_runs
 * as label "sweep:<run>:<label>", then hands the remaining variants to a fresh call of itself.
 */
// deno-lint-ignore no-explicit-any
async function runSweep(db: any, req: Request, body: any): Promise<Response> {
  const from = typeof body.from === "string" ? body.from : "2014-01-01";
  const splitDay = typeof body.split === "string" ? body.split : "2021-01-01";
  const split = Date.parse(splitDay);
  const run = typeof body.run === "string" ? body.run : new Date().toISOString().slice(0, 16);
  const batch = Math.max(1, Math.min(4, Number(body.batch) || 2));
  const variants: { label: string; overrides?: unknown }[] = Array.isArray(body.variants) ? body.variants : [];
  const now = variants.slice(0, batch);
  const rest = variants.slice(batch);

  const symbols = new Set<string>(Object.values(FX_SYMBOLS));
  for (const v of now) for (const i of mergeConfig(DEFAULT_CONFIG, v.overrides as Partial<EngineConfig>).universe) symbols.add(i.symbol);
  const data: MarketData = {};
  await Promise.all([...symbols].map(async (s) => {
    try {
      data[s] = await fetchDailyBars(s, from);
    } catch (e) {
      console.warn(`sweep: ${s}: ${(e as Error).message}`);
    }
  }));
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const results = [];
  for (const v of now) {
    try {
      const config = mergeConfig(DEFAULT_CONFIG, v.overrides as Partial<EngineConfig>);
      const r = backtest(data, config);
      const m = r.metrics;
      const end = r.curve.at(-1)!.t;
      const sleeves = sleeveStats(r.fills);
      const summary = {
        end: Math.round(m.endEquity), bench: Math.round(m.startEquity * (1 + m.benchmarkReturn)),
        cagr: r4(m.cagr), mdd: r4(m.maxDrawdown), sharpe: r4(m.sharpe), trades: m.trades, fees: Math.round(m.feesEur),
        a: periodStats(r.curve, r.curve[0]!.t, split), b: periodStats(r.curve, split, end),
        halts: r.events.filter((e) => e.message.startsWith("Zirveden")).length,
        sleeves: Object.fromEntries(Object.entries(sleeves).map(([k, s]) => [k, { n: s.trades, pnl: Math.round(s.realizedEur) }])),
      };
      const curve = r.curve.filter((_, i) => i % 5 === 0 || i === r.curve.length - 1);
      await db.from("backtest_runs").insert({ range: from, label: `sweep:${run}:${v.label}`, config: v.overrides ?? {}, metrics: summary, curve, fills: [] });
      results.push({ label: v.label, ...summary });
    } catch (e) {
      await db.from("backtest_runs").insert({ range: from, label: `sweep:${run}:${v.label}`, config: v.overrides ?? {}, metrics: { error: (e as Error).message }, curve: [], fills: [] });
    }
  }
  if (rest.length) {
    const next = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/engine-tick`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": req.headers.get("x-cron-secret") ?? "" },
      body: JSON.stringify({ action: "sweep", from, split: splitDay, run, batch, variants: rest }),
    }).then((r) => r.body?.cancel()).catch((e) => console.warn(`sweep chain: ${(e as Error).message}`));
    // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions.
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(next);
  }
  return Response.json({ run, done: results.length, remaining: rest.length, results });
}

/** The cron job sends a random secret stored in app_secrets (readable only with the service role). */
// deno-lint-ignore no-explicit-any
export async function authorized(db: any, req: Request): Promise<boolean> {
  const sent = req.headers.get("x-cron-secret");
  if (!sent) return false;
  const { data } = await db.from("app_secrets").select("value").eq("name", "cron_secret").maybeSingle();
  return !!data?.value && data.value === sent;
}

// deno-lint-ignore no-explicit-any
export async function loadMarket(db: any, symbols: string[], now: number): Promise<MarketData> {
  const since = new Date(now - HISTORY_DAYS * 1.5 * 86_400_000).toISOString().slice(0, 10);
  const data: MarketData = {};
  await Promise.all(symbols.map(async (symbol) => {
    const { data: rows } = await db.from("market_bars").select("*").eq("symbol", symbol).gte("day", since).order("day");
    const cached: Bar[] = (rows ?? []).map((r: { day: string; o: number; h: number; l: number; c: number; v: number }) => ({ t: Date.parse(r.day), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
    let fresh: Bar[] = [];
    try {
      fresh = await fetchDailyBars(symbol, cached.length > 200 ? "5d" : "2y");
    } catch (e) {
      console.warn(`price fetch failed for ${symbol}: ${(e as Error).message}`);
    }
    if (fresh.length) {
      await db.from("market_bars").upsert(fresh.map((b) => ({ symbol, day: new Date(b.t).toISOString().slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
    }
    const byDay = new Map<number, Bar>();
    for (const b of [...cached, ...fresh]) byDay.set(b.t, b);
    data[symbol] = [...byDay.values()].sort((x, y) => x.t - y.t);
  }));
  return data;
}

// deno-lint-ignore no-explicit-any
async function queueApprovals(db: any, accountId: string, intents: { symbol: string; sleeve: string; side: string }[]) {
  const { data: open } = await db.from("approvals").select("intent").eq("account_id", accountId).eq("status", "pending");
  const key = (i: { symbol: string; sleeve: string; side: string }) => `${i.symbol}|${i.sleeve}|${i.side}`;
  const existing = new Set((open ?? []).map((o: { intent: { symbol: string; sleeve: string; side: string } }) => key(o.intent)));
  const fresh = intents.filter((i) => !existing.has(key(i)));
  if (fresh.length) await db.from("approvals").insert(fresh.map((intent) => ({ account_id: accountId, intent })));
}
