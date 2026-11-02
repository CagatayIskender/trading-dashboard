// Backend for the web panel. The panel never talks to the database directly: it calls
// this function with a session token, and the function uses the service role.
// Login is a single owner password, set once with a one-time setup code.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { DEFAULT_CONFIG, FX_SYMBOLS, mergeConfig } from "./engine/config.ts";
import { MarketView } from "./engine/market.ts";
import { equityEur, positionValueEur } from "./engine/portfolio.ts";
import type { Bar, MarketData, PortfolioState } from "./engine/types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TOKEN_DAYS = 30;

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "status":
        return json({ needsSetup: !(await secret(db, "panel_password_hash")) });
      case "setup":
        return json(await setup(db, String(body.code ?? ""), String(body.password ?? "")));
      case "login":
        return json(await login(db, String(body.password ?? "")));
      case "dashboard":
        await requireToken(db, body.token);
        return json(await dashboard(db));
      case "resetHalt":
        await requireToken(db, body.token);
        return json(await resetHalt(db));
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    const err = e as Error & { status?: number };
    return json({ error: err.message }, err.status ?? 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
}

function fail(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

async function secret(db: Db, name: string): Promise<string | null> {
  const { data } = await db.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value ?? null;
}

// ---- passwords and tokens (WebCrypto only) ----

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, key, 256);
  return b64(bits);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(db: Db, payload: string): Promise<string> {
  let k = await secret(db, "panel_token_key");
  if (!k) {
    k = b64(crypto.getRandomValues(new Uint8Array(32)));
    await db.from("app_secrets").upsert({ name: "panel_token_key", value: k });
  }
  const key = await crypto.subtle.importKey("raw", unb64(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

async function issueToken(db: Db): Promise<{ token: string }> {
  const payload = b64(enc.encode(JSON.stringify({ exp: Date.now() + TOKEN_DAYS * 86_400_000 })));
  return { token: `${payload}.${await hmac(db, payload)}` };
}

async function requireToken(db: Db, token: unknown): Promise<void> {
  if (typeof token !== "string" || !token.includes(".")) fail("oturum gerekli", 401);
  const [payload, sig] = token.split(".");
  if (!safeEqual(sig!, await hmac(db, payload!))) fail("oturum geçersiz", 401);
  const { exp } = JSON.parse(new TextDecoder().decode(unb64(payload!)));
  if (typeof exp !== "number" || exp < Date.now()) fail("oturum süresi doldu", 401);
}

async function setup(db: Db, code: string, password: string) {
  if (await secret(db, "panel_password_hash")) fail("şifre zaten belirlenmiş", 409);
  const expected = await secret(db, "panel_setup_code");
  if (!expected || !safeEqual(code.trim(), expected)) fail("kurulum kodu hatalı", 403);
  if (password.length < 10) fail("şifre en az 10 karakter olmalı", 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await db.from("app_secrets").upsert({ name: "panel_password_hash", value: `${b64(salt)}:${await pbkdf2(password, salt)}` });
  await db.from("app_secrets").delete().eq("name", "panel_setup_code");
  return issueToken(db);
}

async function login(db: Db, password: string) {
  const stored = await secret(db, "panel_password_hash");
  if (!stored) fail("önce kurulum gerekli", 409);
  const [salt, hash] = stored.split(":");
  const ok = safeEqual(await pbkdf2(password, unb64(salt!)), hash!);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 1500)); // slows down guessing
    fail("şifre hatalı", 401);
  }
  return issueToken(db);
}

// ---- data ----

async function dashboard(db: Db) {
  const { data: account } = await db.from("accounts").select("*").eq("mode", "demo").order("created_at").limit(1).maybeSingle();
  if (!account) fail("demo hesabı yok", 404);
  const config = mergeConfig(DEFAULT_CONFIG, account.config);
  const state = account.state as PortfolioState;
  const names = Object.fromEntries(config.universe.map((i) => [i.symbol, i.name]));

  // Latest prices from the engine's own cache, converted to EUR the same way the engine does.
  const held = [...new Set(state.positions.map((p) => p.symbol))];
  const symbols = [...held, ...Object.values(FX_SYMBOLS), config.benchmark];
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const { data: bars } = await db.from("market_bars").select("symbol,day,o,h,l,c,v").in("symbol", symbols).gte("day", since).order("day");
  const data: MarketData = {};
  for (const r of bars ?? []) (data[r.symbol] ??= []).push({ t: Date.parse(r.day), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v } as Bar);
  const view = new MarketView(data, config.universe, Date.now());

  const equity = equityEur(state, view);
  const positions = state.positions.map((p) => {
    const price = view.priceEur(p.symbol);
    const value = positionValueEur(p, view);
    return {
      symbol: p.symbol, name: names[p.symbol] ?? p.symbol, sleeve: p.sleeve, qty: p.qty,
      avgPriceEur: p.avgPriceEur, priceEur: price, valueEur: value,
      pnlEur: value - p.qty * p.avgPriceEur, stopEur: p.stopEur, openedAt: p.openedAt,
    };
  });
  const bySleeve = (["core", "swing", "tactical"] as const).map((s) => ({
    sleeve: s,
    targetPct: config.sleeveWeights[s],
    valueEur: positions.filter((p) => p.sleeve === s).reduce((a, p) => a + p.valueEur, 0),
  }));

  // Hourly equity history, with the benchmark scaled to the same starting value.
  const { data: snaps } = await db.from("equity_snapshots").select("t,equity_eur").eq("account_id", account.id).order("t");
  const hourly = new Map<string, { t: number; equity: number }>();
  for (const s of snaps ?? []) hourly.set(s.t.slice(0, 13), { t: Date.parse(s.t), equity: s.equity_eur });
  const benchBars = data[config.benchmark] ?? [];
  const benchAt = (t: number) => {
    let px: number | null = null;
    for (const b of benchBars) if (b.t <= t) px = b.c; else break;
    return px;
  };
  const history = [...hourly.values()];
  const b0 = history.length ? benchAt(history[0]!.t) : null;
  const curve = history.map((h) => {
    const b = benchAt(h.t);
    return { t: h.t, equity: h.equity, benchmark: b0 && b ? (config.startingCapitalEur * b) / b0 : null };
  });

  const [{ data: fills }, { data: events }, { data: bt }] = await Promise.all([
    db.from("fills").select("*").eq("account_id", account.id).order("t", { ascending: false }).limit(40),
    db.from("events").select("t,level,message").eq("account_id", account.id).order("t", { ascending: false }).limit(20),
    db.from("backtest_runs").select("created_at,range,label,metrics,curve").eq("label", "panel").order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    account: { name: account.name, mode: account.mode, startedAt: account.created_at, updatedAt: account.updated_at },
    startingCapitalEur: config.startingCapitalEur,
    equityEur: equity,
    cashEur: state.cashEur,
    halted: state.halted,
    positions,
    bySleeve,
    curve,
    fills: (fills ?? []).map((f: Record<string, unknown>) => ({ ...f, name: names[f.symbol as string] ?? f.symbol })),
    events: events ?? [],
    backtest: bt ?? null,
    risk: config.risk,
  };
}

async function resetHalt(db: Db) {
  const { data: account } = await db.from("accounts").select("id,state").eq("mode", "demo").order("created_at").limit(1).maybeSingle();
  if (!account) fail("demo hesabı yok", 404);
  const state = account.state as PortfolioState;
  state.halted = null;
  // Measure future drawdowns from today's level so the brake does not fire again at once.
  state.peakEquity = state.dayStartEquity;
  await db.from("accounts").update({ state }).eq("id", account.id);
  await db.from("events").insert({ account_id: account.id, level: "info", message: "Alım freni panelden kaldırıldı" });
  return { ok: true };
}
