import { useEffect, useState } from "react";
import { useApp } from "../App";
import { aiSummary } from "../lib/api";
import { fmt } from "../lib/money";
import { addMonths, greeting, labelDate, labelMonth, monthEnd, monthStart, monthKey, today } from "../lib/dates";
import { annualExpenses, baseline, freedom, goalOutlook, investedTotal, monthlySeries, netWorth, projectSpan, quarterRange, spendByCategory, noScenario } from "../lib/calc";
import { BarChart, Card, Donut, Icon, Legend, LineChart, Money, Progress, Ring } from "../components/ui";

export function Dashboard() {
  const { data, month, openAdd, go } = useApp();
  const series = monthlySeries(data.txns, addMonths(month, -5), month);
  const cur = series[series.length - 1]; const prev = monthlySeries(data.txns, addMonths(month, -1), addMonths(month, -1))[0];
  const savingsRate = cur.income ? Math.round(((cur.income - cur.expense) / cur.income) * 100) : 0;
  const nw = netWorth(data);
  const primary = data.goals.find((g) => g.is_primary) ?? data.goals[0];
  const others = data.goals.filter((g) => g !== primary && g.show_on_dashboard);
  const cats = spendByCategory(data.txns, month, data);
  const top = cats.slice(0, 6);
  const fr = freedom({ annualExpenses: annualExpenses(data), withdrawalRate: data.profile.withdrawal_rate, invested: investedTotal(data), monthly: data.holdings.reduce((a, h) => a + h.monthly, 0) || baseline(data).invested, returnPct: data.profile.expected_return, birthYear: data.profile.birth_year });
  const b = baseline(data, 12);
  const [qf, qt, ql] = quarterRange(monthKey(today()));
  const q = projectSpan(data, qf, qt, b, noScenario, ql);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div><h1 data-testid="greeting">{greeting()}, {data.profile.display_name || "there"}</h1><p className="muted" style={{ margin: "4px 0 0" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div>

      <div className="grid g4">
        <div className="card kpi hover" data-testid="kpi-networth"><div className="label">Net worth</div><div className="value"><Money c={nw} /></div>
          <div className="small pos">{fmt(cur.goals + cur.invested, { sign: true, decimals: false })} saved &amp; invested this month</div></div>
        <div className="card kpi hover" data-testid="kpi-income"><div className="label">Income · {labelMonth(month)}</div><div className="value"><Money c={cur.income} /></div>
          <div className="small muted">{prev && prev.income ? `${cur.income >= prev.income ? "▲" : "▼"} ${Math.abs(Math.round(((cur.income - prev.income) / prev.income) * 100))}% vs last month` : "—"}</div></div>
        <div className="card kpi hover" data-testid="kpi-spent"><div className="label">Spent · {labelMonth(month)}</div><div className="value"><Money c={cur.expense} /></div>
          <div className="small muted">{prev && prev.expense ? `${cur.expense <= prev.expense ? "▼" : "▲"} ${Math.abs(Math.round(((cur.expense - prev.expense) / prev.expense) * 100))}% vs last month` : "—"}</div></div>
        <div className="card kpi hover" data-testid="kpi-savings"><div className="label">Savings rate</div><div className="value num">{savingsRate}%</div><div className="small muted">{fmt(cur.income - cur.expense, { decimals: false })} kept this month</div></div>
      </div>

      {primary ? <HeroGoal /> : <div className="card hero empty"><h2>Set your first goal</h2><p>A house deposit is a great place to start.</p><button className="btn gold" onClick={() => go("goals")}>Create a goal</button></div>}

      {others.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, others.length)}, 1fr)` }}>
          {others.slice(0, 4).map((g) => { const o = goalOutlook(data, g); const pct = (g.saved / g.target) * 100; return (
            <div key={g.id} className="card hover" style={{ padding: 16, cursor: "pointer" }} onClick={() => go("goals")} data-testid="goal-strip">
              <div className="row between"><h3>{g.name}</h3><span className={"badge " + (o.status === "Behind" ? "bad" : o.status === "Ahead" || o.status === "Done" ? "ok" : "warn")}>{o.status}</span></div>
              <div className="row between small" style={{ margin: "10px 0 6px" }}><span className="num">{fmt(g.saved, { decimals: false })}</span><span className="muted num">of {fmt(g.target, { decimals: false })}</span></div>
              <Progress pct={pct} />
            </div>); })}
        </div>
      )}

      <div className="grid g21">
        <Card title="Cash flow · last 6 months" action={<Legend items={[{ name: "Income", color: "var(--green)" }, { name: "Spending", color: "var(--gold)" }]} />} testid="cashflow">
          <BarChart labels={series.map((s) => labelMonth(s.key))} groups={[{ name: "Income", values: series.map((s) => s.income), color: "var(--green)" }, { name: "Spending", values: series.map((s) => s.expense), color: "var(--gold)" }]} />
        </Card>
        <Card title="Spending by category" action={<a onClick={() => go("budget")} className="small">Budget →</a>} testid="by-category">
          {top.length === 0 ? <div className="empty">No spending logged this month.</div> : (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <Donut items={top} size={150} />
              <div className="stack grow" style={{ gap: 8 }}>{top.map((c) => <div key={c.id} className="row between small"><span className="row" style={{ gap: 8 }}><i className="dot" style={{ background: c.color }} />{c.name}</span><span className="num">{fmt(c.total, { decimals: false })}</span></div>)}</div>
            </div>)}
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Freedom Number" action={<a className="small" onClick={() => go("investments")}>Details →</a>} testid="freedom-card">
          <div className="serif" style={{ fontSize: 28 }}><span className="num">{(fr.progress * 100).toFixed(1)}%</span> <span className="muted" style={{ fontSize: 15 }}>to financial freedom</span></div>
          <div style={{ margin: "12px 0 8px" }}><Progress pct={fr.progress * 100} tone="gold" /></div>
          <div className="row between small muted"><span className="num">{fmt(investedTotal(data), { decimals: false })}</span><span className="num">{fmt(fr.target, { decimals: false })}</span></div>
          <p className="small" style={{ marginBottom: 0 }}>{fr.years !== null ? `Est. ${Math.ceil(fr.years)} years at current pace (${fr.yearReached})` : "Add investments to see your timeline"}</p>
        </Card>
        <Card title={`This quarter forecast · ${ql}`} action={<a className="small" onClick={() => go("projections")}>Projections →</a>} testid="quarter-forecast">
          <div className="kpi"><div className="label">Projected savings</div><div className="value"><Money c={q.savings} /></div></div>
          {primary && (() => { const o = goalOutlook(data, primary); return <p className="small" style={{ marginBottom: 0 }}>{primary.name}: {o.projected ? <>projected <b>{labelMonth(o.projected, "long")}</b>{o.monthsDelta !== null && o.monthsDelta !== 0 && <> · {Math.abs(o.monthsDelta)} mo {o.monthsDelta > 0 ? "ahead" : "behind"}</>}</> : "no contributions yet"}</p>; })()}
        </Card>
        <InsightCard />
      </div>

      <Card title="Recent transactions" action={<a className="small" onClick={() => go("transactions")}>View all →</a>} testid="recent">
        {data.txns.length === 0 ? <div className="empty"><p>Nothing logged yet.</p><button className="btn primary" onClick={() => openAdd()}>Add a transaction</button></div> : (
          <table><tbody>{data.txns.slice(0, 6).map((t) => (
            <tr key={t.id}><td className="muted num" style={{ width: 90 }}>{labelDate(t.txn_date)}</td><td>{t.description}</td>
              <td className="muted small">{data.categories.find((c) => c.id === t.category_id)?.name ?? data.goals.find((g) => g.id === t.goal_id)?.name ?? ""}</td>
              <td className={"r num " + (t.txn_type === "income" ? "pos" : "")}>{t.txn_type === "income" ? "+" : "–"}{fmt(t.amount)}</td></tr>))}</tbody></table>)}
      </Card>
    </div>
  );
}

function HeroGoal() {
  const { data, openAdd } = useApp();
  const g = data.goals.find((x) => x.is_primary) ?? data.goals[0];
  const o = goalOutlook(data, g);
  const pct = g.saved / g.target;
  // progress path: saved balance at each month-end for the last 12 months vs straight-line target
  const cur = monthKey(today()); const months = Array.from({ length: 12 }, (_, i) => addMonths(cur, i - 11));
  let bal = g.starting; const contrib = data.txns.filter((t) => t.goal_id === g.id && t.txn_type === "goal_contribution");
  const before = contrib.filter((t) => monthKey(t.txn_date) < months[0]).reduce((a, t) => a + t.amount, 0); bal += before;
  const actual = months.map((m) => { bal += contrib.filter((t) => monthKey(t.txn_date) === m).reduce((a, t) => a + t.amount, 0); return bal; });
  return (
    <section className="card hero" data-testid="hero-goal">
      <div className="row" style={{ gap: 32, alignItems: "center" }}>
        <Ring pct={pct} size={170} stroke={13}><div><div className="serif num" style={{ fontSize: 34 }} data-testid="hero-pct">{Math.round(pct * 100)}%</div><div className="small muted">saved</div></div></Ring>
        <div style={{ minWidth: 260 }}>
          <div className="small goldc" style={{ textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>Primary goal</div>
          <h1 style={{ fontSize: 30, margin: "4px 0 10px" }}>{g.name}</h1>
          <div className="big" data-testid="hero-saved"><Money c={g.saved} /></div>
          <div className="muted num">of {fmt(g.target, { decimals: false })} · {fmt(g.target - g.saved, { decimals: false })} to go</div>
          <p className="small" style={{ margin: "12px 0" }}>
            <b className="num">{fmt(o.pace, { decimals: false })}/month</b>
            {o.projected && <> · {o.status === "Behind" ? "behind — " : "on track for "}<b>{labelMonth(o.projected, "long")}</b></>}
            {g.target_date && <span className="muted"> (target {labelMonth(monthKey(g.target_date), "long")})</span>}
          </p>
          <button className="btn gold sm" onClick={() => openAdd({ txn_type: "goal_contribution", goal_id: g.id, description: `${g.name} contribution` })} data-testid="hero-contribute"><Icon name="plus" size={15} />Add contribution</button>
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <LineChart height={170} labels={months.map((m) => labelMonth(m))} series={[{ name: "Saved", values: actual, color: "var(--green-2)", area: true }, { name: "Target", values: months.map(() => g.target), color: "var(--gold)", dashed: true }]} />
        </div>
      </div>
    </section>
  );
}

function InsightCard() {
  const { data, go } = useApp();
  const [txt, setTxt] = useState<string | null>(null); const [state, setState] = useState<"idle" | "loading" | "err">("idle");
  const m = monthKey(today());
  useEffect(() => {
    const key = `lg-insight-${data.profile.id}-${m}`; const cached = sessionStorage.getItem(key);
    if (cached) { setTxt(cached); return; }
    if (data.txns.length === 0) return;
    setState("loading");
    aiSummary(monthStart(addMonths(m, -1)), monthEnd(m), "Give me one specific, actionable insight about this month vs last month, max 2 sentences.")
      .then((r) => { setTxt(r.answer); sessionStorage.setItem(key, r.answer); setState("idle"); })
      .catch(() => setState("err"));
  }, [data.profile.id, data.txns.length, m]);
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><span className="goldc"><Icon name="sparkle" /></span>AI insight</span>} action={<a className="small" onClick={() => go("assistant")}>Ask →</a>} testid="insight-card">
      {state === "loading" && <div className="skel" style={{ height: 60 }} />}
      {state === "err" && <p className="small muted" data-testid="insight-unavailable">AI insights are unavailable right now. Your data is unaffected.</p>}
      {txt && <p style={{ margin: 0 }}>{txt}</p>}
      {!txt && state === "idle" && <p className="small muted">Log a few transactions to get insights.</p>}
    </Card>
  );
}
