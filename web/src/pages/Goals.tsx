import { useState } from "react";
import { useApp } from "../App";
import { addGoal, deleteGoal, Goal, updateGoal } from "../lib/api";
import { fmt, parseMoneyInput, centsToDb } from "../lib/money";
import { addMonths, labelDate, labelMonth, monthKey, today } from "../lib/dates";
import { goalOutlook, requiredMonthly } from "../lib/calc";
import { Card, Icon, LineChart, Modal, Ring } from "../components/ui";

const ICONS = ["home", "target", "plane", "chart", "budget", "income"];

export function Goals() {
  const { data, openExport, reload } = useApp();
  const [modal, setModal] = useState<Goal | "new" | null>(null);
  const [detail, setDetail] = useState<string | null>(data.goals.find((g) => g.is_primary)?.id ?? null);
  const sorted = [...data.goals].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
  const d = data.goals.find((g) => g.id === detail);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between"><p className="muted" style={{ margin: 0 }}>Track everything you're saving for. Contributions are logged as transactions.</p>
        <div className="row"><button className="btn" onClick={() => openExport("goals")}><Icon name="download" />Export</button><button className="btn primary" onClick={() => setModal("new")} data-testid="new-goal"><Icon name="plus" />New Goal</button></div></div>
      {sorted.length === 0 && <div className="card empty"><p>No goals yet.</p><button className="btn gold" onClick={() => setModal("new")}>Create your first goal</button></div>}
      <div className="grid g3">
        {sorted.map((g) => {
          const o = goalOutlook(data, g); const pct = g.saved / g.target;
          return (
            <div key={g.id} className={"card hover" + (g.is_primary ? " hero" : "")} style={{ gridColumn: g.is_primary ? "span 2" : undefined, cursor: "pointer" }} onClick={() => setDetail(g.id)} data-testid="goal-card" data-goal={g.name}>
              <div className="row" style={{ gap: 20 }}>
                <Ring pct={pct} size={g.is_primary ? 130 : 90} stroke={g.is_primary ? 11 : 8} color={g.is_primary ? "var(--gold)" : "var(--green-2)"}><b className="num">{Math.round(pct * 100)}%</b></Ring>
                <div className="grow stack" style={{ gap: 4 }}>
                  <div className="row between"><h2>{g.name}</h2><span className={"badge " + (o.status === "Behind" ? "bad" : o.status === "Ahead" || o.status === "Done" ? "ok" : "warn")} data-testid="goal-status">{o.status}</span></div>
                  <div className="serif num" style={{ fontSize: g.is_primary ? 30 : 22 }} data-testid="goal-saved">{fmt(g.saved, { decimals: false })} <span className="muted" style={{ fontSize: 14 }}>of {fmt(g.target, { decimals: false })}</span></div>
                  <div className="small muted num">{fmt(o.pace, { decimals: false })}/mo · {g.target_date ? `target ${labelMonth(monthKey(g.target_date), "long")}` : "no target date"}</div>
                  <div className="small num">{o.projected ? <>Projected <b>{labelMonth(o.projected, "long")}</b></> : "Set a monthly contribution"}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12, gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn sm" onClick={() => setModal(g)} data-testid="edit-goal"><Icon name="edit" size={14} />Edit</button>
                <label className="row small muted" style={{ gap: 6, marginLeft: "auto" }}><input type="checkbox" checked={g.show_on_dashboard} onChange={(e) => updateGoal(g.id, { show_on_dashboard: e.target.checked }).then(reload)} />Show on dashboard</label>
              </div>
            </div>);
        })}
      </div>
      {d && <GoalDetail g={d} />}
      {modal && <GoalModal goal={modal === "new" ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function GoalDetail({ g }: { g: Goal }) {
  const { data, openAdd } = useApp();
  const [plan, setPlan] = useState(Math.round(goalOutlook(data, g).pace / 100));
  const base = goalOutlook(data, g);
  const whatIf = goalOutlook(data, { ...g, monthly: plan * 100 }, plan * 100 - base.pace);
  const cur = monthKey(today());
  const horizon = Math.min(120, Math.max(12, (whatIf.projected ? Math.max(0, Number(whatIf.projected.slice(0, 4)) * 12 + Number(whatIf.projected.slice(5)) - (Number(cur.slice(0, 4)) * 12 + Number(cur.slice(5)))) : 24) + 3));
  const months = Array.from({ length: horizon }, (_, i) => addMonths(cur, i));
  const proj = months.map((_, i) => Math.min(g.target * 1.05, g.saved + plan * 100 * i));
  const history = data.txns.filter((t) => t.goal_id === g.id).slice(0, 8);
  return (
    <div className="grid g21">
      <Card title={`${g.name} — projection`} testid="goal-detail">
        <LineChart labels={months.map((m) => labelMonth(m))} series={[{ name: "Projected", values: proj, color: "var(--green-2)", area: true }, { name: "Target", values: months.map(() => g.target), color: "var(--gold)", dashed: true }]} />
        <div className="stack" style={{ marginTop: 14 }}>
          <label className="f">What if I save <b className="num" style={{ color: "var(--text)" }}>{fmt(plan * 100, { decimals: false })}/month</b>?
            <input type="range" min={0} max={Math.max(3000, plan * 2)} step={50} value={plan} onChange={(e) => setPlan(Number(e.target.value))} data-testid="whatif-slider" /></label>
          <div data-testid="whatif-result">→ reach it in <b>{whatIf.projected ? labelMonth(whatIf.projected, "long") : "—"}</b>
            {g.target_date && <span className="muted"> · need {fmt(requiredMonthly(g.target, g.saved, monthKey(g.target_date)), { decimals: false })}/mo for {labelMonth(monthKey(g.target_date), "long")}</span>}</div>
        </div>
      </Card>
      <Card title="Contribution history" action={<button className="btn gold sm" onClick={() => openAdd({ txn_type: "goal_contribution", goal_id: g.id, description: `${g.name} contribution` })}><Icon name="plus" size={14} />Add</button>}>
        {history.length === 0 ? <p className="muted small">No contributions yet.</p> : <table><tbody>{history.map((t) => <tr key={t.id}><td className="muted num">{labelDate(t.txn_date)}</td><td className="r num">{fmt(t.amount)}</td></tr>)}</tbody></table>}
        <p className="small muted">Starting balance {fmt(g.starting)}</p>
      </Card>
    </div>
  );
}

function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { data, reload, toast } = useApp();
  const [name, setName] = useState(goal?.name ?? ""); const [icon, setIcon] = useState(goal?.icon ?? "target");
  const [target, setTarget] = useState(goal ? centsToDb(goal.target) : ""); const [starting, setStarting] = useState(goal ? centsToDb(goal.starting) : "0");
  const [monthly, setMonthly] = useState(goal ? centsToDb(goal.monthly) : ""); const [date, setDate] = useState(goal?.target_date ?? "");
  const [primary, setPrimary] = useState(goal?.is_primary ?? data.goals.length === 0); const [err, setErr] = useState<string | null>(null);
  const t = parseMoneyInput(target || ""), s = parseMoneyInput(starting || "0");
  const savedNow = goal ? goal.saved - goal.starting + (s ?? 0) : s ?? 0;
  const need = t && date ? requiredMonthly(t, savedNow, monthKey(date)) : null;

  async function save() {
    setErr(null);
    const m = parseMoneyInput(monthly || "0");
    if (!name.trim()) return setErr("Name your goal"); if (!t || t <= 0) return setErr("Enter a target amount"); if (s === null || m === null) return setErr("Check the amounts");
    try {
      if (primary) { const cur = data.goals.find((g) => g.is_primary && g.id !== goal?.id); if (cur) await updateGoal(cur.id, { is_primary: false }); }
      const row = { name: name.trim(), icon, target: t, starting: s, monthly: m, target_date: date || null, is_primary: primary };
      if (goal) await updateGoal(goal.id, row); else await addGoal(row);
      await reload(); toast(goal ? "Goal updated" : "Goal created"); onClose();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose} testid="goal-modal">
      <div className="stack">
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House Deposit" data-testid="goal-name" /></label>
        <div className="row">{ICONS.map((i) => <button key={i} type="button" className="iconbtn" style={{ borderColor: icon === i ? "var(--gold)" : undefined }} onClick={() => setIcon(i)}><Icon name={i} /></button>)}</div>
        <div className="grid g2">
          <label className="f">Target amount<input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="goal-target" /></label>
          <label className="f">Already saved<input inputMode="decimal" value={starting} onChange={(e) => setStarting(e.target.value)} data-testid="goal-starting" /></label>
          <label className="f">Monthly contribution<input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} data-testid="goal-monthly" /></label>
          <label className="f">Target date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="goal-date" /></label>
        </div>
        {need !== null && <div className="ai-chip" style={{ justifySelf: "start" }} data-testid="goal-need">You need {fmt(need, { decimals: false })}/month to hit this date</div>}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />Make this my primary goal (dashboard hero)</label>
        {err && <div className="err-text">{err}</div>}
        <div className="row between">
          {goal ? <button className="btn danger" onClick={async () => { try { await deleteGoal(goal.id); await reload(); toast("Goal deleted"); onClose(); } catch (e) { setErr((e as Error).message); } }}>Delete goal</button> : <span />}
          <button className="btn primary" onClick={save} data-testid="goal-save">Save goal</button>
        </div>
      </div>
    </Modal>
  );
}
