import { useApp } from "../App";
import { fmt, sum } from "../lib/money";
import { addMonths, labelMonth, monthKey, today } from "../lib/dates";
import { baseline, incomeBySource, incomeStability, monthlySeries } from "../lib/calc";
import { BarChart, Card, Legend, Money } from "../components/ui";

const COLORS = ["var(--green)", "var(--green-2)", "var(--gold)", "#8FAF9A", "#5E655F"];

export function Income() {
  const { data } = useApp();
  const cur = monthKey(today()); const from = addMonths(cur, -11);
  const months = monthlySeries(data.txns, from, cur).map((m) => m.key);
  const sources = data.sources;
  const perMonth = sources.map((s) => months.map((m) => sum(data.txns.filter((t) => t.txn_type === "income" && t.income_source_id === s.id && monthKey(t.txn_date) === m).map((t) => t.amount))));
  const ytd = sum(data.txns.filter((t) => t.txn_type === "income" && t.txn_date.startsWith(cur.slice(0, 4))).map((t) => t.amount));
  const monthsElapsed = Number(cur.slice(5, 7));
  const b = baseline(data, 12);
  const projectedAnnual = ytd + b.income * (12 - monthsElapsed + 1) - sum(data.txns.filter((t) => t.txn_type === "income" && monthKey(t.txn_date) === cur).map((t) => t.amount));
  const stab = incomeStability(data);
  const last3 = incomeBySource(data.txns, addMonths(cur, -3), addMonths(cur, -1), data);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, sources.length)}, 1fr)` }}>
        {sources.map((s, i) => {
          const avg = Math.round((last3.find((x) => x.id === s.id)?.total ?? 0) / 3);
          const thisM = perMonth[i][perMonth[i].length - 1];
          return (
            <div className="card kpi hover" key={s.id} data-testid="income-source">
              <div className="row between"><div className="label">{s.name}</div><i className="dot" style={{ background: COLORS[i % COLORS.length] }} /></div>
              <div className="value"><Money c={avg} /><span className="muted" style={{ fontSize: 14 }}> /mo avg</span></div>
              <div className="small muted num">This month {fmt(thisM)} · expected {fmt(s.expected_monthly, { decimals: false })}</div>
            </div>);
        })}
      </div>
      <div className="grid g3">
        <div className="card kpi"><div className="label">Year to date</div><div className="value"><Money c={ytd} /></div></div>
        <div className="card kpi"><div className="label">Projected {cur.slice(0, 4)}</div><div className="value"><Money c={projectedAnnual} /></div><div className="small muted">YTD + 12-month average for remaining months</div></div>
        <div className="card kpi" data-testid="stability"><div className="label">Income stability</div><div className="value">{stab.label}</div><div className="small muted">±{stab.pct}% month-to-month variance</div></div>
      </div>
      <Card title="Income by source · 12 months" action={<Legend items={sources.map((s, i) => ({ name: s.name, color: COLORS[i % COLORS.length] }))} />}>
        <BarChart stacked height={260} labels={months.map((m) => labelMonth(m))} groups={sources.map((s, i) => ({ name: s.name, values: perMonth[i], color: COLORS[i % COLORS.length] }))} />
      </Card>
    </div>
  );
}
