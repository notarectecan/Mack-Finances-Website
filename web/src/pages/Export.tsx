import { useMemo, useState } from "react";
import { useApp } from "../App";
import { AppData } from "../lib/api";
import { addMonths, monthKey, today } from "../lib/dates";
import { dec, goalOutlook, incomeBySource, monthlySeries, toCSV, baseline, projectSpan, quarterRange, noScenario, annualExpenses, freedom, investedTotal } from "../lib/calc";
import { sum } from "../lib/money";
import { Icon, Modal, Seg } from "../components/ui";

export type ExportPreset = "bank" | "advisor" | "backup" | "transactions" | "budget" | "goals" | "investments" | "projections" | "custom";
type DS = "transactions" | "income_summary" | "budget" | "goals" | "investments" | "net_worth" | "projections";
const DS_LABEL: Record<DS, string> = { transactions: "Transactions", income_summary: "Income Summary", budget: "Budget vs Actual", goals: "Goals & Progress", investments: "Investments / Holdings", net_worth: "Net Worth History", projections: "Projections" };
const PRESETS: Record<string, { label: string; ds: DS[]; range: Range; desc: string }> = {
  bank: { label: "Bank / Mortgage application", ds: ["income_summary", "transactions", "goals", "net_worth"], range: "12m", desc: "Income history by source, monthly averages, savings history and current balances." },
  advisor: { label: "Financial advisor / Investments", ds: ["investments", "net_worth", "goals", "projections"], range: "12m", desc: "Holdings, contributions, net worth trend and Freedom Number progress." },
  backup: { label: "Full backup", ds: ["transactions", "income_summary", "budget", "goals", "investments", "net_worth", "projections"], range: "all", desc: "All data, all columns." },
};
type Range = "month" | "quarter" | "year" | "12m" | "all" | "custom";

function rangeKeys(r: Range, from: string, to: string): [string, string] {
  const cur = monthKey(today());
  if (r === "month") return [cur, cur];
  if (r === "quarter") { const [a, b] = quarterRange(cur); return [a, b]; }
  if (r === "year") return [`${cur.slice(0, 4)}-01`, cur];
  if (r === "12m") return [addMonths(cur, -11), cur];
  if (r === "custom") return [from.slice(0, 7), to.slice(0, 7)];
  return ["1900-01", "2999-12"];
}

export function buildCSV(d: AppData, ds: DS, f: string, t: string, opts: { notes: boolean; categories: boolean }): { name: string; csv: string; rows: number } {
  const inRange = (date: string) => monthKey(date) >= f && monthKey(date) <= t;
  const cat = (id: string | null) => d.categories.find((c) => c.id === id)?.name ?? "";
  const cur = d.profile.currency_code;
  const stamp = today();
  switch (ds) {
    case "transactions": {
      const rows = d.txns.filter((x) => inRange(x.txn_date)).map((x) => [x.txn_date, x.description, x.txn_type, ...(opts.categories ? [cat(x.category_id) || d.goals.find((g) => g.id === x.goal_id)?.name || ""] : []),
        d.sources.find((s) => s.id === x.income_source_id)?.name ?? "", d.accounts.find((a) => a.id === x.account_id)?.name ?? "", x.txn_type === "income" ? dec(x.amount) : dec(-x.amount), cur, ...(opts.notes ? [x.notes ?? ""] : [])]);
      return { name: `transactions_${stamp}.csv`, rows: rows.length, csv: toCSV(["date", "description", "type", ...(opts.categories ? ["category"] : []), "income_source", "account", "amount", "currency", ...(opts.notes ? ["notes"] : [])], rows) };
    }
    case "income_summary": {
      const last = t > monthKey(today()) ? monthKey(today()) : t; const first = f < "2000-01" ? (d.txns.length ? monthKey(d.txns[d.txns.length - 1].txn_date) : last) : f;
      const months = monthlySeries(d.txns, first, last);
      const rows = months.map((m) => [m.key, ...d.sources.map((s) => dec(sum(d.txns.filter((x) => x.txn_type === "income" && x.income_source_id === s.id && monthKey(x.txn_date) === m.key).map((x) => x.amount)))), dec(m.income), dec(m.expense), dec(m.income - m.expense), dec(m.goals + m.invested)]);
      const n = months.length || 1;
      rows.push(["MONTHLY AVERAGE", ...incomeBySource(d.txns, first, last, d).filter((s) => s.id !== "none").map((s) => dec(Math.round(s.total / n))), dec(Math.round(sum(months.map((m) => m.income)) / n)), dec(Math.round(sum(months.map((m) => m.expense)) / n)), dec(Math.round(sum(months.map((m) => m.net)) / n)), dec(Math.round(sum(months.map((m) => m.goals + m.invested)) / n))]);
      return { name: `income_summary_${stamp}.csv`, rows: rows.length, csv: toCSV(["month", ...d.sources.map((s) => s.name), "total_income", "total_spending", "net", "saved_and_invested"], rows) };
    }
    case "budget": {
      const rows: unknown[][] = [];
      for (const b of d.budgets.filter((b) => inRange(b.month)).sort((a, b) => a.month.localeCompare(b.month))) {
        const spent = sum(d.txns.filter((x) => x.txn_type === "expense" && x.category_id === b.category_id && monthKey(x.txn_date) === b.month.slice(0, 7)).map((x) => x.amount));
        rows.push([b.month.slice(0, 7), cat(b.category_id), dec(b.amount), dec(spent), dec(b.amount - spent)]);
      }
      return { name: `budget_vs_actual_${stamp}.csv`, rows: rows.length, csv: toCSV(["month", "category", "budgeted", "spent", "remaining"], rows) };
    }
    case "goals": {
      const rows = d.goals.map((g) => { const o = goalOutlook(d, g); return [g.name, dec(g.target), dec(g.saved), (g.saved / g.target * 100).toFixed(1), dec(o.pace), g.target_date ?? "", o.projected ?? "", o.status]; });
      return { name: `goals_${stamp}.csv`, rows: rows.length, csv: toCSV(["goal", "target", "saved", "progress_pct", "monthly_pace", "target_date", "projected_month", "status"], rows) };
    }
    case "investments": {
      const total = sum(d.holdings.map((h) => h.value));
      const fr = freedom({ annualExpenses: annualExpenses(d), withdrawalRate: d.profile.withdrawal_rate, invested: investedTotal(d), monthly: sum(d.holdings.map((h) => h.monthly)), returnPct: d.profile.expected_return, birthYear: d.profile.birth_year });
      const rows: unknown[][] = d.holdings.map((h) => [h.name, h.asset_type, dec(h.value), dec(h.monthly), total ? (h.value / total * 100).toFixed(1) : "0", h.value_as_of ?? ""]);
      rows.push(["FREEDOM NUMBER", "", dec(fr.target), "", (fr.progress * 100).toFixed(1), fr.yearReached ?? ""]);
      return { name: `investments_${stamp}.csv`, rows: rows.length, csv: toCSV(["holding", "type", "value", "monthly_contribution", "allocation_pct", "as_of"], rows) };
    }
    case "net_worth": {
      const rows = d.snapshots.filter((s) => inRange(s.snapshot_date)).map((s) => [s.snapshot_date, dec(s.net_worth)]);
      return { name: `net_worth_history_${stamp}.csv`, rows: rows.length, csv: toCSV(["date", "net_worth"], rows) };
    }
    case "projections": {
      const b = baseline(d, 12); const cur = monthKey(today()); const y = cur.slice(0, 4);
      const spans = [projectSpan(d, addMonths(cur, 1), addMonths(cur, 1), b, noScenario, "next_month"), (() => { const [a, z, l] = quarterRange(cur); return projectSpan(d, a, z, b, noScenario, l); })(),
        (() => { const [a, z, l] = quarterRange(cur, 1); return projectSpan(d, a, z, b, noScenario, l); })(), projectSpan(d, `${y}-01`, `${y}-12`, b, noScenario, y), projectSpan(d, `${Number(y) + 1}-01`, `${Number(y) + 1}-12`, b, noScenario, String(Number(y) + 1))];
      const rows = spans.map((s) => [s.label, dec(s.income), dec(s.expense), dec(s.savings), dec(s.low), dec(s.high), s.actualMonths, s.projectedMonths]);
      return { name: `projections_${stamp}.csv`, rows: rows.length, csv: toCSV(["period", "income", "spending", "savings", "savings_low", "savings_high", "actual_months", "projected_months"], rows) };
    }
  }
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportModal({ preset, onClose }: { preset: ExportPreset; onClose: () => void }) {
  const { data, toast } = useApp();
  const initial: DS[] = PRESETS[preset]?.ds ?? (preset === "custom" ? ["transactions"] : [({ transactions: "transactions", budget: "budget", goals: "goals", investments: "investments", projections: "projections" } as Record<string, DS>)[preset]]);
  const [ds, setDs] = useState<DS[]>(initial);
  const [range, setRange] = useState<Range>(PRESETS[preset]?.range ?? "12m");
  const [from, setFrom] = useState(`${addMonths(monthKey(today()), -11)}-01`); const [to, setTo] = useState(today());
  const [opts, setOpts] = useState({ notes: true, categories: true });
  const [f, t] = rangeKeys(range, from, to);
  const files = useMemo(() => ds.map((x) => buildCSV(data, x, f, t, opts)), [ds, f, t, opts, data]);
  const preview = files[0]?.csv.split("\r\n").slice(0, 6).filter(Boolean).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
  const applyPreset = (k: string) => { setDs(PRESETS[k].ds); setRange(PRESETS[k].range); };

  return (
    <Modal title="Export data" onClose={onClose} wide testid="export-modal">
      <div className="stack">
        <div className="grid g3">{Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} className={"card hover" + (k === "bank" ? " hero" : "")} style={{ textAlign: "left", cursor: "pointer", padding: 14 }} onClick={() => applyPreset(k)} data-testid={`preset-${k}`}>
            <h3>{p.label}</h3><p className="small muted" style={{ margin: "4px 0 0" }}>{p.desc}</p></button>))}</div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Data to include</div>
          <div className="row wrap" style={{ gap: 8 }}>{(Object.keys(DS_LABEL) as DS[]).map((k) => (
            <label key={k} className="pill" style={{ cursor: "pointer", borderColor: ds.includes(k) ? "var(--green-2)" : undefined }}>
              <input type="checkbox" checked={ds.includes(k)} onChange={(e) => setDs(e.target.checked ? [...ds, k] : ds.filter((x) => x !== k))} data-testid={`ds-${k}`} />{DS_LABEL[k]}</label>))}</div>
        </div>
        <div className="row wrap">
          <Seg value={range} onChange={setRange} testid="export-range" options={[{ v: "month", l: "This month" }, { v: "quarter", l: "This quarter" }, { v: "year", l: "This year" }, { v: "12m", l: "Last 12 months" }, { v: "all", l: "All" }, { v: "custom", l: "Custom" }]} />
          {range === "custom" && <><input type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} /></>}
        </div>
        <div className="row small">
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={opts.notes} onChange={(e) => setOpts({ ...opts, notes: e.target.checked })} />Include notes</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={opts.categories} onChange={(e) => setOpts({ ...opts, categories: e.target.checked })} />Include categories</label>
          <span className="muted">Amounts in {data.profile.currency_code}, 2 decimals</span>
        </div>
        {preview && preview.length > 0 && (
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 12 }} data-testid="export-preview">
            <div className="small muted" style={{ padding: "8px 12px" }}>Preview · {files[0].name} · {files[0].rows} rows</div>
            <table className="small"><thead><tr>{preview[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{preview.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c.replace(/^"|"$/g, "")}</td>)}</tr>)}</tbody></table>
          </div>)}
        <div className="row between">
          <span className="small muted">{files.length > 1 ? `${files.length} CSV files will download` : ""}</span>
          <button className="btn primary" disabled={!files.length} data-testid="export-download" onClick={() => { files.forEach((x, i) => setTimeout(() => download(x.name, x.csv), i * 250)); toast(`Export ready · ${files.map((x) => x.name).join(", ")}`); onClose(); }}>
            <Icon name="download" />Download CSV</button>
        </div>
      </div>
    </Modal>
  );
}
