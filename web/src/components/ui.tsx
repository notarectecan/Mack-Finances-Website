import { ReactNode, useEffect, useState } from "react";
import { Cents, fmt } from "../lib/money";

// ---------- icons (thin-line, Lucide-style paths, no dependency) ----------
const P: Record<string, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  income: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  budget: "M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  chart: "M3 3v18h18M7 14l4-4 4 4 5-6",
  forecast: "M3 17l6-6 4 4 8-8M14 7h7v7",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14", x: "M18 6L6 18M6 6l12 12", sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z", download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  chevl: "M15 18l-6-6 6-6", chevr: "M9 18l6-6-6-6", menu: "M3 12h18M3 6h18M3 18h18", lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9", trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z", search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  home: "M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10", eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z", db: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.target} />
    </svg>
  );
}

// ---------- count-up money ----------
export function Money({ c, decimals = false, sign = false, className = "" }: { c: Cents; decimals?: boolean; sign?: boolean; className?: string }) {
  const [v, setV] = useState(c);
  useEffect(() => {
    if (document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(c); return; }
    const from = v, start = performance.now();
    let raf = 0;
    const step = (t: number) => { const p = Math.min(1, (t - start) / 500); setV(Math.round(from + (c - from) * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    const settle = window.setTimeout(() => setV(c), 650); // always land on the true value, even if animation frames are paused
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);
  return <span className={"num " + className} data-cents={c}>{fmt(v, { decimals, sign })}</span>;
}

// ---------- layout bits ----------
export const Card = ({ title, action, children, className = "", testid }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testid?: string }) => (
  <section className={"card hover " + className} data-testid={testid}>
    {(title || action) && <div className="card-h"><h2>{title}</h2>{action}</div>}
    {children}
  </section>
);
export function Modal({ title, onClose, children, wide, testid }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; testid?: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-label={title} data-testid={testid}>
        <div className="card-h"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
export function Seg<T extends string>({ value, options, onChange, testid }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; testid?: string }) {
  return <div className="seg" data-testid={testid}>{options.map((o) => <button key={o.v} type="button" className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>;
}
export function Progress({ pct, tone }: { pct: number; tone?: "gold" | "warn" | "over" }) {
  return <div className={"bar " + (tone ?? "")}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
export const Skeleton = ({ h = 120 }: { h?: number }) => <div className="skel" style={{ height: h }} />;

// ---------- charts (SVG) ----------
export function Ring({ pct, size = 150, stroke = 12, color = "var(--gold)", children }: { pct: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${C * p} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .8s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

export function Donut({ items, size = 170 }: { items: { name: string; total: number; color: string }[]; size?: number }) {
  const total = items.reduce((a, b) => a + b.total, 0) || 1;
  const r = size / 2 - 14, C = 2 * Math.PI * r; let acc = 0;
  return (
    <svg width={size} height={size}>
      {items.map((it) => {
        const len = (it.total / total) * C; const el = (
          <circle key={it.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={it.color} strokeWidth={22}
            strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{it.name}</title></circle>);
        acc += len; return el;
      })}
    </svg>
  );
}

export interface Series { name: string; values: (number | null)[]; color: string; dashed?: boolean; area?: boolean }
export function LineChart({ labels, series, height = 220, band, fmtY = (v) => fmt(v, { decimals: false }) }: {
  labels: string[]; series: Series[]; height?: number; band?: { low: (number | null)[]; high: (number | null)[] }; fmtY?: (v: number) => string;
}) {
  const W = 640, H = height, pl = 56, pr = 12, pt = 10, pb = 26;
  const all = series.flatMap((s) => s.values).concat(band ? [...band.low, ...band.high] : []).filter((v): v is number => v !== null);
  const max = Math.max(1, ...all) * 1.08, min = Math.min(0, ...all);
  const x = (i: number) => pl + (i * (W - pl - pr)) / Math.max(1, labels.length - 1);
  const y = (v: number) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const path = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" L");
  const ticks = [0, 0.5, 1].map((p) => min + (max - min) * p);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
      {ticks.map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 4" /><text x={pl - 8} y={y(t) + 4} textAnchor="end">{fmtY(t)}</text></g>)}
      {band && (() => {
        const idx = band.low.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) return null;
        const d = "M" + idx.map((i) => `${x(i)},${y(band.high[i]!)}`).join(" L") + " L" + [...idx].reverse().map((i) => `${x(i)},${y(band.low[i]!)}`).join(" L") + "Z";
        return <path d={d} fill="var(--gold)" opacity={0.12} />;
      })()}
      {series.map((s) => {
        const d = path(s.values); if (!d) return null;
        const firstI = s.values.findIndex((v) => v !== null), lastI = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
        return <g key={s.name}>
          {s.area && <path d={`M${d} L${x(lastI)},${y(min)} L${x(firstI)},${y(min)}Z`} fill={s.color} opacity={0.08} />}
          <path d={"M" + d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 5" : undefined} />
        </g>;
      })}
      {labels.map((l, i) => (labels.length <= 13 || i % Math.ceil(labels.length / 12) === 0) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{l}</text>)}
    </svg>
  );
}

export function BarChart({ labels, groups, height = 220, stacked = false }: { labels: string[]; groups: { name: string; values: number[]; color: string }[]; height?: number; stacked?: boolean }) {
  const W = 640, H = height, pl = 56, pb = 26, pt = 10;
  const totals = labels.map((_, i) => stacked ? groups.reduce((a, g) => a + g.values[i], 0) : Math.max(...groups.map((g) => g.values[i])));
  const max = Math.max(1, ...totals) * 1.1; const slot = (W - pl) / labels.length;
  const bw = stacked ? slot * 0.5 : (slot * 0.7) / groups.length;
  const h = (v: number) => (v / max) * (H - pt - pb);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
      {[0, 0.5, 1].map((p) => <g key={p}><line x1={pl} x2={W} y1={pt + (1 - p) * (H - pt - pb)} y2={pt + (1 - p) * (H - pt - pb)} stroke="var(--border)" strokeDasharray="2 4" /><text x={pl - 8} y={pt + (1 - p) * (H - pt - pb) + 4} textAnchor="end">{fmt(max * p, { decimals: false })}</text></g>)}
      {labels.map((l, i) => {
        let acc = 0;
        return <g key={i}>
          {groups.map((g, gi) => {
            const v = g.values[i]; const bh = h(v);
            const bx = stacked ? pl + i * slot + (slot - bw) / 2 : pl + i * slot + slot * 0.15 + gi * bw;
            const by = H - pb - bh - (stacked ? acc : 0); if (stacked) acc += bh;
            return <rect key={g.name} x={bx} y={by} width={bw - 2} height={Math.max(0, bh)} rx={3} fill={g.color}><title>{`${g.name}: ${fmt(v)}`}</title></rect>;
          })}
          <text x={pl + i * slot + slot / 2} y={H - 6} textAnchor="middle">{l}</text>
        </g>;
      })}
    </svg>
  );
}

export const Legend = ({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) => (
  <div className="row wrap small muted" style={{ gap: 16 }}>{items.map((i) => <span key={i.name} className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 3, background: i.color, display: "inline-block", borderRadius: 2, opacity: i.dashed ? 0.7 : 1 }} />{i.name}</span>)}</div>
);
