const eur = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
const qty = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 });
const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtEur = (v: number) => eur.format(v);
export const fmtEur0 = (v: number) => eur0.format(v);
export const fmtPct = (v: number) => pct.format(v);
export const fmtSignedPct = (v: number) => (v > 0 ? "+" : "") + pct.format(v);
export const fmtSignedEur = (v: number) => (v > 0 ? "+" : "") + eur.format(v);
export const fmtQty = (v: number) => qty.format(v);
export const fmtDay = (t: number | string) => day.format(new Date(t));
export const fmtDayYear = (t: number | string) => dayYear.format(new Date(t));
export const fmtDateTime = (t: number | string) => dateTime.format(new Date(t));

export const SLEEVE_LABEL = { core: "Uzun vade", swing: "Orta vade", tactical: "Kısa vade" } as const;
export const SLEEVE_HINT = {
  core: "Geniş ETF'ler, nadiren işlem",
  swing: "Güçlü hisseler, haftalık gözden geçirme",
  tactical: "Trend takibi, sıkı stop",
} as const;
export const SLEEVE_COLOR = { core: "var(--series-3)", swing: "var(--series-4)", tactical: "var(--series-5)" } as const;
