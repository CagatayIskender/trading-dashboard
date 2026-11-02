import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDay, fmtDayYear, fmtEur, fmtEur0 } from "./format";

export interface Point {
  t: number;
  a: number; // system
  b: number | null; // benchmark
}

interface Props {
  points: Point[];
  height?: number;
  labelA?: string;
  labelB?: string;
  showYear?: boolean;
}

/** Two-series line chart (system vs MSCI World) with a crosshair tooltip. One shared EUR axis. */
export function EquityChart({ points, height = 260, labelA = "Sistem", labelB = "MSCI World", showYear = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const geo = useMemo(() => {
    const vals = points.flatMap((p) => (p.b === null ? [p.a] : [p.a, p.b]));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1) { lo -= 10; hi += 10; }
    const span = hi - lo;
    lo -= span * 0.08;
    hi += span * 0.08;
    const t0 = points[0]?.t ?? 0;
    const t1 = points.at(-1)?.t ?? 1;
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
    const path = (key: "a" | "b") => {
      let d = "";
      let pen = false;
      for (const p of points) {
        const v = p[key];
        if (v === null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4);
    const fracs = width < 480 ? [0, 1] : [0, 0.33, 0.66, 1];
    const xticks = points.length > 1 ? fracs.map((f) => t0 + f * (t1 - t0)) : [];
    return { x, y, pathA: path("a"), pathB: path("b"), ticks, xticks };
  }, [points, width, height]);

  if (points.length < 2) return null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + pad.l;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.t) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHover(best);
  };

  const hp = hover !== null ? points[hover] : null;
  const len = Math.ceil(width * 3);

  return (
    <div className="chart" ref={wrap}>
      <svg width={width} height={height} role="img" aria-label={`${labelA} ve ${labelB} değer grafiği`}>
        {geo.ticks.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={geo.y(v)} y2={geo.y(v)} />
            <text className="axis" x={pad.l - 10} y={geo.y(v) + 4} textAnchor="end">{fmtEur0(v)}</text>
          </g>
        ))}
        {geo.xticks.map((t, i) => (
          <text key={t} className="axis" x={geo.x(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === geo.xticks.length - 1 ? "end" : "middle"}>
            {showYear ? fmtDayYear(t) : fmtDay(t)}
          </text>
        ))}
        <path className="series draw" d={geo.pathB} stroke="var(--series-2)" style={{ ["--len" as string]: len }} />
        <path className="series draw" d={geo.pathA} stroke="var(--series-1)" style={{ ["--len" as string]: len, strokeWidth: 2.25 }} />
        {hp && (
          <g>
            <line x1={geo.x(hp.t)} x2={geo.x(hp.t)} y1={pad.t} y2={height - pad.b} stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />
            {hp.b !== null && <circle cx={geo.x(hp.t)} cy={geo.y(hp.b)} r={4.5} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />}
            <circle cx={geo.x(hp.t)} cy={geo.y(hp.a)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        <rect
          x={pad.l} y={0} width={width - pad.l - pad.r} height={height} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(Math.max(geo.x(hp.t), 90), width - 90), top: geo.y(Math.max(hp.a, hp.b ?? hp.a)) }}>
          <div className="t">{fmtDayYear(hp.t)}</div>
          <div className="row"><span><i style={{ background: "var(--series-1)", width: 10, height: 2, display: "inline-block", marginRight: 6, verticalAlign: "middle" }} />{labelA}</span><b className="num">{fmtEur(hp.a)}</b></div>
          {hp.b !== null && (
            <div className="row"><span><i style={{ background: "var(--series-2)", width: 10, height: 2, display: "inline-block", marginRight: 6, verticalAlign: "middle" }} />{labelB}</span><b className="num">{fmtEur(hp.b)}</b></div>
          )}
        </div>
      )}
    </div>
  );
}

export function Legend({ a = "Sistem", b = "MSCI World (al-tut)" }: { a?: string; b?: string }) {
  return (
    <div className="legend">
      <span><i style={{ background: "var(--series-1)" }} />{a}</span>
      <span><i style={{ background: "var(--series-2)" }} />{b}</span>
    </div>
  );
}
