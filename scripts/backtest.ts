// Usage: npm run backtest [-- 10y]
// Downloads daily history (cached in data-cache/), replays it through the engine and
// prints the result next to simply holding the MSCI World ETF.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { backtest } from "../engine/backtest.ts";
import { DEFAULT_CONFIG, FX_SYMBOLS } from "../engine/config.ts";
import { fetchDailyBars } from "../engine/data/yahoo.ts";
import type { MarketData } from "../engine/types.ts";

const range = process.argv[2] ?? "5y";
const cacheDir = "data-cache";
mkdirSync(cacheDir, { recursive: true });

const symbols = [...DEFAULT_CONFIG.universe.map((i) => i.symbol), ...Object.values(FX_SYMBOLS)];
const data: MarketData = {};
for (const s of symbols) {
  const file = `${cacheDir}/${s.replace(/[^A-Za-z0-9.-]/g, "_")}-${range}.json`;
  if (existsSync(file)) {
    data[s] = JSON.parse(readFileSync(file, "utf8"));
    continue;
  }
  try {
    data[s] = await fetchDailyBars(s, range);
    writeFileSync(file, JSON.stringify(data[s]));
    console.log(`indirildi: ${s} (${data[s]!.length} gün)`);
  } catch (e) {
    console.warn(`atlandı: ${s}: ${(e as Error).message}`);
  }
}

const r = backtest(data, DEFAULT_CONFIG);
const m = r.metrics;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`
Dönem: ${new Date(r.curve[0]!.t).toISOString().slice(0, 10)} - ${new Date(r.curve.at(-1)!.t).toISOString().slice(0, 10)}
                     Sistem      MSCI World (al-tut)
Son değer            ${m.endEquity.toFixed(0).padEnd(11)} ${(m.startEquity * (1 + m.benchmarkReturn)).toFixed(0)} €
Toplam getiri        ${pct(m.totalReturn).padEnd(11)} ${pct(m.benchmarkReturn)}
Yıllık getiri        ${pct(m.cagr).padEnd(11)} ${pct(m.benchmarkCagr)}
En büyük düşüş       ${pct(m.maxDrawdown).padEnd(11)} ${pct(m.benchmarkMaxDrawdown)}
Sharpe               ${m.sharpe.toFixed(2)}
İşlem sayısı         ${m.trades} (ücret ${m.feesEur.toFixed(0)} €)
Kazanan satış oranı  ${m.winRate === null ? "-" : pct(m.winRate)}
`);
writeFileSync(`${cacheDir}/backtest-report-${range}.json`, JSON.stringify({ metrics: m, curve: r.curve, fills: r.fills }, null, 2));
