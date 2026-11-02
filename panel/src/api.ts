const API = "https://dljsznnfhyigjonojvfl.supabase.co/functions/v1/panel-api";
const TOKEN_KEY = "panel-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply won't persist */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token: getToken(), ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "Bağlantı hatası", res.status);
  return data as T;
}

export type Sleeve = "core" | "swing" | "tactical";

export interface Dashboard {
  account: { name: string; mode: "demo" | "live"; startedAt: string; updatedAt: string };
  startingCapitalEur: number;
  equityEur: number;
  cashEur: number;
  halted: null | { reason: string; until: number | null };
  positions: {
    symbol: string; name: string; sleeve: Sleeve; qty: number; avgPriceEur: number;
    priceEur: number | null; valueEur: number; pnlEur: number; stopEur: number | null; openedAt: number;
  }[];
  bySleeve: { sleeve: Sleeve; targetPct: number; valueEur: number }[];
  curve: { t: number; equity: number; benchmark: number | null }[];
  fills: {
    id: number; t: string; symbol: string; name: string; sleeve: Sleeve; side: "buy" | "sell";
    qty: number; price_eur: number; fee_eur: number; realized_pnl_eur: number | null; reason: string;
  }[];
  events: { t: string; level: "info" | "warn" | "risk"; message: string }[];
  backtest: null | {
    created_at: string;
    range: string;
    metrics: {
      endEquity: number; cagr: number; maxDrawdown: number; trades: number; feesEur: number;
      benchmarkReturn: number; benchmarkCagr: number; benchmarkMaxDrawdown: number; startEquity: number;
    };
    curve: { t: number; equity: number; benchmark: number }[];
  };
}
