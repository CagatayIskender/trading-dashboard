import { useCallback, useEffect, useState } from "react";
import { ApiError, call, getToken, setToken, type Dashboard } from "./api";
import { EquityChart, Legend, type Point } from "./EquityChart";
import { useCountUp } from "./useCountUp";
import {
  fmtDateTime, fmtEur, fmtEur0, fmtPct, fmtQty, fmtSignedEur, fmtSignedPct,
  SLEEVE_COLOR, SLEEVE_HINT, SLEEVE_LABEL,
} from "./format";

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <DashboardView onLogout={() => { setToken(null); setAuthed(false); }} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<{ needsSetup: boolean }>("status").then((r) => setNeedsSetup(r.needsSetup)).catch(() => setNeedsSetup(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== repeat) return setError("Şifreler aynı değil");
    setBusy(true);
    try {
      const r = needsSetup
        ? await call<{ token: string }>("setup", { code, password })
        : await call<{ token: string }>("login", { password });
      setToken(r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="card auth-card rise" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 22 }}><Mark />Portföy</div>
        <h1>{needsSetup ? "Paneli kur" : "Tekrar hoş geldin"}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {needsSetup === null ? " " : needsSetup ? "Sana verilen kurulum kodunu gir ve kendi şifreni belirle." : "Devam etmek için şifreni gir."}
        </p>
        {needsSetup && (
          <label className="field">Kurulum kodu
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="ABCD-1234" required />
          </label>
        )}
        <label className="field">Şifre
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? "new-password" : "current-password"} minLength={needsSetup ? 10 : undefined} required />
        </label>
        {needsSetup && (
          <label className="field">Şifre (tekrar)
            <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy || needsSetup === null}>{busy ? "Bekle…" : needsSetup ? "Şifreyi kaydet ve gir" : "Giriş yap"}</button>
      </form>
    </main>
  );
}

function DashboardView({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<Dashboard>("dashboard"));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
      setError((e as Error).message);
    }
  }, [onLogout]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const resetHalt = async () => {
    await call("resetHalt");
    load();
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><Mark />Portföy</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {data && <span className="pill"><span className="dot" />{data.account.mode === "demo" ? "Demo modu · sanal para" : "Gerçek mod"}</span>}
          <button className="ghost" onClick={onLogout}>Çıkış</button>
        </div>
      </header>
      {error && <div className="banner">Veri alınamadı: {error}</div>}
      {!data ? <Skeleton /> : <Content d={data} onResetHalt={resetHalt} />}
    </div>
  );
}

function Content({ d, onResetHalt }: { d: Dashboard; onResetHalt: () => void }) {
  const change = d.equityEur - d.startingCapitalEur;
  const changePct = change / d.startingCapitalEur;
  const lastBench = [...d.curve].reverse().find((p) => p.benchmark !== null)?.benchmark ?? null;
  const vsBench = lastBench !== null ? (d.equityEur - lastBench) / d.startingCapitalEur : null;
  const invested = d.positions.reduce((s, p) => s + p.valueEur, 0);
  const animated = useCountUp(d.equityEur);
  const points: Point[] = d.curve.map((p) => ({ t: p.t, a: p.equity, b: p.benchmark }));

  return (
    <>
      {d.halted && (
        <div className="banner rise" role="status">
          <span>⏸ {d.halted.reason}</span>
          {d.halted.until === null && <button onClick={onResetHalt}>Alımları yeniden aç</button>}
        </div>
      )}
      <div className="grid">
        <section className="card span-12 rise">
          <div className="hero">
            <div>
              <div className="hero-label">Toplam değer</div>
              <div className="hero-value display num">{fmtEur(animated)}</div>
              <div className={`delta ${change > 0.005 ? "up" : change < -0.005 ? "down" : "flat"}`}>
                {change > 0.005 ? "▲" : change < -0.005 ? "▼" : "•"} {fmtSignedEur(change)} · {fmtSignedPct(changePct)}
                <span style={{ fontWeight: 500, opacity: 0.8 }}>&nbsp;başlangıçtan beri</span>
              </div>
            </div>
            <div className="stats">
              <Stat k="Başlangıç" v={fmtEur0(d.startingCapitalEur)} />
              <Stat k="Yatırımda" v={fmtEur0(invested)} />
              <Stat k="Nakit" v={fmtEur0(d.cashEur)} />
              <Stat k="MSCI World'e göre" v={vsBench === null ? "–" : fmtSignedPct(vsBench)} />
            </div>
          </div>
        </section>

        <section className="card span-8 rise" style={{ animationDelay: "60ms" }}>
          <div className="card-head">
            <h2>Değer gelişimi</h2>
            <Legend />
          </div>
          {points.length >= 2 ? <EquityChart points={points} /> : (
            <div className="empty">
              <div className="big">Grafik ilk işlemlerden sonra dolacak</div>
              <div>Sistem her gün 16:00'dan (Berlin) sonra stratejileri çalıştırır, fiyatları her 15 dakikada kontrol eder.</div>
            </div>
          )}
        </section>

        <section className="card span-4 rise" style={{ animationDelay: "120ms" }}>
          <div className="card-head"><h2>Dağılım</h2><span className="sub">hedef çizgisi ile</span></div>
          {d.bySleeve.map((s) => {
            const share = d.equityEur > 0 ? s.valueEur / d.equityEur : 0;
            return (
              <div className="sleeve" key={s.sleeve}>
                <div className="sleeve-row">
                  <span className="sleeve-name"><span className="swatch" style={{ background: SLEEVE_COLOR[s.sleeve] }} />{SLEEVE_LABEL[s.sleeve]}</span>
                  <span className="num">{fmtEur0(s.valueEur)} <span className="faint">· {fmtPct(share)}</span></span>
                </div>
                <div className="faint" style={{ fontSize: 12.5 }}>{SLEEVE_HINT[s.sleeve]} · hedef {fmtPct(s.targetPct)}</div>
                <div className="bar" aria-hidden>
                  <span style={{ width: `${Math.min(100, share * 100)}%`, background: SLEEVE_COLOR[s.sleeve] }} />
                  <i style={{ left: `calc(${s.targetPct * 100}% - 1px)` }} />
                </div>
              </div>
            );
          })}
        </section>

        <section className="card span-7 rise" style={{ animationDelay: "180ms" }}>
          <div className="card-head"><h2>Pozisyonlar</h2><span className="sub">{d.positions.length} açık</span></div>
          {d.positions.length === 0 ? (
            <div className="empty"><div className="big">Henüz pozisyon yok</div><div>{fmtEur0(d.cashEur)} şu an nakitte bekliyor.</div></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Varlık</th><th className="hide-sm">Katman</th><th className="r">Değer</th><th className="r">Kâr / zarar</th></tr></thead>
                <tbody>
                  {[...d.positions].sort((a, b) => b.valueEur - a.valueEur).map((p) => {
                    const pnlPct = p.pnlEur / (p.qty * p.avgPriceEur);
                    return (
                      <tr key={`${p.symbol}-${p.sleeve}`}>
                        <td><div style={{ fontWeight: 600 }}>{p.name}</div><div className="faint num" style={{ fontSize: 12.5 }}>{p.symbol} · {fmtQty(p.qty)} adet<span className="show-sm"> · {SLEEVE_LABEL[p.sleeve]}</span></div></td>
                        <td className="hide-sm"><span className="tag">{SLEEVE_LABEL[p.sleeve]}</span></td>
                        <td className="r num nowrap">{fmtEur(p.valueEur)}</td>
                        <td className={`r num nowrap ${p.pnlEur >= 0 ? "pos" : "neg"}`}>{fmtSignedEur(p.pnlEur)}<div style={{ fontSize: 12.5 }}>{fmtSignedPct(pnlPct)}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card span-5 rise" style={{ animationDelay: "240ms" }}>
          <div className="card-head"><h2>Son işlemler</h2><span className="sub">gerekçeleriyle</span></div>
          {d.fills.length === 0 ? (
            <div className="empty"><div className="big">Henüz işlem yok</div><div>İlk işlemler bugün 16:00'dan sonra burada görünecek.</div></div>
          ) : (
            <ul className="feed">
              {d.fills.slice(0, 12).map((f) => (
                <li key={f.id}>
                  <span className={`side ${f.side}`} aria-label={f.side === "buy" ? "Alım" : "Satım"}>{f.side === "buy" ? "A" : "S"}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{f.side === "buy" ? "Alındı" : "Satıldı"}: {f.name}</div>
                    <div className="reason">{f.reason}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{fmtDateTime(f.t)}</div>
                  </div>
                  <div className="r num">
                    {fmtEur(f.qty * f.price_eur)}
                    {f.realized_pnl_eur !== null && <div className={f.realized_pnl_eur >= 0 ? "pos" : "neg"} style={{ fontSize: 12.5 }}>{fmtSignedEur(f.realized_pnl_eur)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {d.backtest && <Backtest bt={d.backtest} />}

        {d.events.length > 0 && (
          <section className="card span-12 rise" style={{ animationDelay: "360ms" }}>
            <div className="card-head"><h2>Sistem günlüğü</h2></div>
            <ul className="feed">
              {d.events.slice(0, 8).map((e, i) => (
                <li key={i} style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>{e.level === "risk" ? "⚠ " : ""}{e.message}</span>
                  <span className="faint" style={{ fontSize: 12.5 }}>{fmtDateTime(e.t)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function Backtest({ bt }: { bt: NonNullable<Dashboard["backtest"]> }) {
  const m = bt.metrics;
  const benchEnd = m.startEquity * (1 + m.benchmarkReturn);
  // range is a Yahoo span ("5y") or a start date ("2014-01-01").
  const title = /^\d{4}-/.test(bt.range) ? `${bt.range.slice(0, 4)}'ten bugüne` : `son ${bt.range.replace("y", "")} yıl`;
  return (
    <section className="card span-12 rise" style={{ animationDelay: "300ms" }}>
      <div className="card-head">
        <div>
          <h2>Geçmiş test: {title}</h2>
          <div className="sub">Aynı kurallar gerçek fiyatlarla, işlem ücretleri dahil. Yapay zeka analizi henüz yok. Hisse listesi bugünün bilgisiyle seçildiği için geçmiş sonuç olduğundan iyi görünür; geleceği garanti etmez.</div>
        </div>
        <Legend />
      </div>
      <div className="grid">
        <div className="span-8"><EquityChart points={bt.curve.map((p) => ({ t: p.t, a: p.equity, b: p.benchmark }))} height={220} showYear /></div>
        <div className="span-4">
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th className="r">Sistem</th><th className="r">MSCI World</th></tr></thead>
              <tbody>
                <tr><td className="muted">2000 € oldu</td><td className="r num">{fmtEur0(m.endEquity)}</td><td className="r num">{fmtEur0(benchEnd)}</td></tr>
                <tr><td className="muted">Yıllık getiri</td><td className="r num">{fmtPct(m.cagr)}</td><td className="r num">{fmtPct(m.benchmarkCagr)}</td></tr>
                <tr><td className="muted">En büyük düşüş</td><td className="r num">{fmtPct(m.maxDrawdown)}</td><td className="r num">{fmtPct(m.benchmarkMaxDrawdown)}</td></tr>
                <tr><td className="muted">İşlem / ücret</td><td className="r num">{m.trades} / {fmtEur0(m.feesEur)}</td><td className="r faint">–</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><div className="k">{k}</div><div className="v num">{v}</div></div>;
}

function Mark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 32 32"><path d="M7 21l6-6 4 4 8-9" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

function Skeleton() {
  return (
    <div className="grid">
      <div className="card span-12"><div className="skeleton" style={{ height: 96 }} /></div>
      <div className="card span-8"><div className="skeleton" style={{ height: 260 }} /></div>
      <div className="card span-4"><div className="skeleton" style={{ height: 260 }} /></div>
    </div>
  );
}
