import { useState } from "react";
import { useApp } from "../App";
import { fmt, sum } from "../lib/money";
import { addMonths, labelMonth, monthKey, today } from "../lib/dates";
import { baseline, goalOutlook, history, monthlySeries, PeriodProjection, projectSpan, quarterRange, Scenario } from "../lib/calc";
import { Card, Icon, Legend, LineChart, Money, Seg } from "../components/ui";

type Period = "month" | "quarter" | "year";

export function Projections() {
  const { data, openExport } = useApp();
  const [period, setPeriod] = useState<Period>("quarter");
  const [basis, setBasis] = useState<"3" | "6" | "12" | "all">("12");
  const [sc, setSc] = useState<Scenario>({ incomePct: 0, spendPct: 0, extraSavings: 0 });
  const b = baseline(data, basis === "all" ? "all" : Number(basis));
  const cur = monthKey(today()); const y = Number(cur.slice(0, 4));

  const spans: Record<Period, { main: PeriodProjection; next: PeriodProjection; prevActual: PeriodProjection }> = (() => {
    const zero = { incomePct: 0, spendPct: 0, extraSavings: 0 };
    const pm = projectSpan(data, addMonths(cur, -1), addMonths(cur, -1), b, zero, labelMonth(addMonths(cur, -1), "long"));
    const cm = projectSpan(data, cur, cur, b, sc, labelMonth(cur, "long"), pm);
    const nm = projectSpan(data, addMonths(cur, 1), addMonths(cur, 1), b, sc, labelMonth(addMonths(cur, 1), "long"), cm);
    const [pqf, pqt, pql] = quarterRange(cur, -1); const [cqf, cqt, cql] = quarterRange(cur, 0); const [nqf, nqt, nql] = quarterRange(cur, 1);
    const pq = projectSpan(data, pqf, pqt, b, zero, pql);
    const cq = projectSpan(data, cqf, cqt, b, sc, cql, pq); const nq = projectSpan(data, nqf, nqt, b, sc, nql, cq);
    const py = projectSpan(data, `${y - 1}-01`, `${y - 1}-12`, b, zero, String(y - 1));
    const cy = projectSpan(data, `${y}-01`, `${y}-12`, b, sc, String(y), py); const ny = projectSpan(data, `${y + 1}-01`, `${y + 1}-12`, b, sc, String(y + 1), cy);
    return { month: { main: nm, next: cm, prevActual: pm }, quarter: { main: cq, next: nq, prevActual: pq }, year: { main: cy, next: ny, prevActual: py } };
  })();
  const s = spans[period];
  const delta = (p: PeriodProjection, key: "income" | "expense" | "savings", prev: PeriodProjection) => prev[key] ? Math.round(((p[key] - prev[key]) / Math.abs(prev[key])) * 100) : null;

  // chart: 12 months actual + N months projected
  const ahead = period === "year" ? 14 : 6;
  const pastKeys = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 12));
  const futureKeys = Array.from({ length: ahead + 1 }, (_, i) => addMonths(cur, i));
  const past = monthlySeries(data.txns, pastKeys[0], pastKeys[pastKeys.length - 1]);
  const pInc = Math.round(b.income * (1 + sc.incomePct / 100)), pExp = Math.round(b.expense * (1 + sc.spendPct / 100));
  const labels = [...pastKeys, ...futureKeys].map((k) => labelMonth(k));
  const actualSav = [...past.map((r) => r.income - r.expense), ...futureKeys.map(() => null)];
  const projSav = [...past.map((_, i) => (i === past.length - 1 ? past[i].income - past[i].expense : null)), ...futureKeys.map(() => pInc - pExp)];
  const bandW = Math.round(b.incomeSd + b.expenseSd);
  const band = { low: projSav.map((v, i) => (v === null || i < past.length ? null : v - bandW)), high: projSav.map((v, i) => (v === null || i < past.length ? null : v + bandW)) };

  // breakdown: per-month averages over basis × months in the selected period
  const hist = history(data, basis === "all" ? "all" : Number(basis)); const hKeys = new Set(hist.map((h) => h.key));
  const n = hist.length || 1; const months = s.main.actualMonths + s.main.projectedMonths;
  const avgBy = (pred: (t: (typeof data.txns)[number]) => boolean) => Math.round(sum(data.txns.filter((t) => hKeys.has(monthKey(t.txn_date)) && pred(t)).map((t) => t.amount)) / n);
  const incRows = data.sources.map((src) => ({ name: src.name, v: avgBy((t) => t.txn_type === "income" && t.income_source_id === src.id) * months * (1 + sc.incomePct / 100) }));
  const expRows = data.categories.filter((c) => c.kind === "expense").map((c) => ({ name: c.name, v: avgBy((t) => t.txn_type === "expense" && t.category_id === c.id) * months * (1 + sc.spendPct / 100) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);

  const outlooks = data.goals.map((g) => goalOutlook(data, g, g.is_primary ? sc.extraSavings : 0));
  const primary = outlooks.find((o) => o.goal.is_primary);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between wrap">
        <Seg value={period} onChange={setPeriod} testid="period-seg" options={[{ v: "month", l: "Month" }, { v: "quarter", l: "Quarter" }, { v: "year", l: "Year" }]} />
        <div className="row">
          <label className="row small muted" style={{ gap: 8 }}>Based on
            <select style={{ width: 200 }} value={basis} onChange={(e) => setBasis(e.target.value as any)} data-testid="basis">
              <option value="3">Last 3 months average</option><option value="6">Last 6 months average</option><option value="12">Last 12 months average</option><option value="all">All history</option>
            </select></label>
          <button className="btn" onClick={() => openExport("projections")}><Icon name="download" />Export</button>
        </div>
      </div>

      <div className="card" style={{ background: "var(--gold-soft)", borderColor: "var(--gold)" }} data-testid="proj-summary">
        <span className="goldc"><Icon name="sparkle" /></span>{" "}
        At your current pace you'll save <b className="num">{fmt(s.main.savings, { decimals: false })}</b> in {s.main.label}
        {primary?.projected && <> and reach your <b>{primary.goal.name}</b> in <b>{labelMonth(primary.projected, "long")}</b>{primary.monthsDelta ? <> — {Math.abs(primary.monthsDelta)} month{Math.abs(primary.monthsDelta) === 1 ? "" : "s"} {primary.monthsDelta > 0 ? "early" : "late"}</> : ""}</>}.
        <span className="muted small"> Based on {b.months} month{b.months === 1 ? "" : "s"} of history.</span>
      </div>

      <div className="grid g4">
        {([["Projected income", s.main.income, delta(s.main, "income", s.prevActual), false], ["Projected spending", s.main.expense, delta(s.main, "expense", s.prevActual), true], ["Projected savings", s.main.savings, delta(s.main, "savings", s.prevActual), false]] as const).map(([l, v, d, inv]) => (
          <div className="card kpi hover" key={l} data-testid={"proj-" + l.split(" ")[1]}>
            <div className="label">{l} · {s.main.label}</div><div className="value"><Money c={v} /></div>
            <div className={"small " + (d === null ? "muted" : (d >= 0) !== inv ? "pos" : "neg")}>{d === null ? "—" : `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% vs ${s.prevActual.label}`}</div>
          </div>))}
        <div className="card kpi hover"><div className="label">Net worth at end of {s.main.label}</div><div className="value"><Money c={s.main.netWorthEnd} /></div><div className="small muted">Range {fmt(s.main.low, { decimals: false })} – {fmt(s.main.high, { decimals: false })} savings</div></div>
      </div>

      <div className="grid g21">
        <Card title="Monthly savings — actual vs projected" action={<Legend items={[{ name: "Actual", color: "var(--green-2)" }, { name: "Projected", color: "var(--gold)", dashed: true }, { name: "Best/worst case", color: "var(--gold-soft)" }]} />} testid="proj-chart">
          <LineChart height={260} labels={labels} band={band} series={[{ name: "Actual", values: actualSav, color: "var(--green-2)", area: true }, { name: "Projected", values: projSav, color: "var(--gold)", dashed: true }]} />
          <div className="row small muted" style={{ marginTop: 6 }}>Next period · {s.next.label}: income {fmt(s.next.income, { decimals: false })} · spending {fmt(s.next.expense, { decimals: false })} · savings <b className="num">{fmt(s.next.savings, { decimals: false })}</b></div>
        </Card>
        <Card title="What if…" testid="scenario">
          <div className="stack">
            <label className="f">Income change: <b className="num">{sc.incomePct > 0 ? "+" : ""}{sc.incomePct}%</b><input type="range" min={-30} max={30} value={sc.incomePct} onChange={(e) => setSc({ ...sc, incomePct: Number(e.target.value) })} data-testid="sc-income" /></label>
            <label className="f">Spending change: <b className="num">{sc.spendPct > 0 ? "+" : ""}{sc.spendPct}%</b><input type="range" min={-30} max={30} value={sc.spendPct} onChange={(e) => setSc({ ...sc, spendPct: Number(e.target.value) })} data-testid="sc-spend" /></label>
            <label className="f">Extra monthly to primary goal: <b className="num">{fmt(sc.extraSavings, { decimals: false })}</b><input type="range" min={0} max={200000} step={5000} value={sc.extraSavings} onChange={(e) => setSc({ ...sc, extraSavings: Number(e.target.value) })} data-testid="sc-extra" /></label>
            <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => setSc({ incomePct: 0, spendPct: 0, extraSavings: 0 })}>Reset</button>
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Goal outlook" testid="goal-outlook">
          <table><tbody>{outlooks.map((o) => (
            <tr key={o.goal.id}><td>{o.goal.name}<div className="small muted num">pace {fmt(o.pace, { decimals: false })}/mo{o.required !== null ? ` · need ${fmt(o.required, { decimals: false })}` : ""}</div></td>
              <td className="r small">{o.projected ? labelMonth(o.projected, "long") : "—"}<br /><span className={"badge " + (o.status === "Behind" ? "bad" : o.status === "Ahead" || o.status === "Done" ? "ok" : "warn")}>{o.status}</span></td></tr>))}</tbody></table>
        </Card>
        <Card title={`Projected income · ${s.main.label}`}>
          <table><tbody>{incRows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="r num">{fmt(Math.round(r.v), { decimals: false })}</td></tr>)}</tbody></table>
          <p className="small muted">Run-rate estimate for the full period.</p>
        </Card>
        <Card title={`Projected spending · ${s.main.label}`}>
          <table><tbody>{expRows.slice(0, 8).map((r) => <tr key={r.name}><td>{r.name}</td><td className="r num">{fmt(Math.round(r.v), { decimals: false })}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </div>
  );
}
