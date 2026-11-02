// Supabase Edge Function, called every 15 minutes by pg_cron (see supabase/schedule.sql).
// Runs the engine for every active account: stop checks on each tick, strategies once a day.
// `./engine` is a copy of the repo's engine/ made by scripts/prepare-functions.sh before deploy.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { FX_SYMBOL, type EngineConfig } from "./engine/config.ts";
import { runCycle } from "./engine/cycle.ts";
import { fetchDailyBars } from "./engine/data/yahoo.ts";
import type { Bar, MarketData, PortfolioState, Signal } from "./engine/types.ts";

const STRATEGY_HOUR_UTC = 15; // after the European close, during US trading
const HISTORY_DAYS = 400; // enough for the 200-day average plus warm-up

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const { data: accounts, error } = await db.from("accounts").select("*").eq("active", true);
  if (error) return new Response(error.message, { status: 500 });
  if (!accounts?.length) return Response.json({ ok: true, accounts: 0 });

  // One download per symbol per tick, shared by all accounts.
  const symbols = new Set<string>([FX_SYMBOL]);
  for (const a of accounts) for (const i of (a.config as EngineConfig).universe) symbols.add(i.symbol);
  const data = await loadMarket(db, [...symbols], now);

  const { data: sigRows } = await db.from("signals").select("*").gt("expires_at", new Date(now).toISOString());
  const signals: Signal[] = (sigRows ?? []).map((s) => ({
    symbol: s.symbol, score: s.score, horizon: s.horizon, rationale: s.rationale,
    createdAt: Date.parse(s.created_at), expiresAt: Date.parse(s.expires_at),
  }));

  const summary = [];
  for (const a of accounts) {
    const config = a.config as EngineConfig;
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
async function loadMarket(db: any, symbols: string[], now: number): Promise<MarketData> {
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
