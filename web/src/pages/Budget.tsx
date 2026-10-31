import { useState } from "react";
import { useApp } from "../App";
import { addCategory, upsertBudget } from "../lib/api";
import { fmt, parseMoneyInput, sum, centsToDb } from "../lib/money";
import { addMonths, monthKey } from "../lib/dates";
import { Icon, Money, Progress } from "../components/ui";

export function Budget() {
  const { data, month, reload, toast, openExport } = useApp();
  const [editing, setEditing] = useState<string | null>(null); const [val, setVal] = useState("");
  const [newCat, setNewCat] = useState("");
  const cats = data.categories.filter((c) => c.kind === "expense" && !c.archived);
  const budgetFor = (cid: string) => data.budgets.find((b) => b.category_id === cid && b.month.slice(0, 7) === month)?.amount;
  const lastBudget = (cid: string) => data.budgets.filter((b) => b.category_id === cid && b.month.slice(0, 7) < month).sort((a, b) => b.month.localeCompare(a.month))[0]?.amount;
  const spent = (cid: string) => sum(data.txns.filter((t) => t.txn_type === "expense" && t.category_id === cid && monthKey(t.txn_date) === month).map((t) => t.amount));
  const rows = cats.map((c) => ({ c, budget: budgetFor(c.id) ?? 0, spent: spent(c.id), carried: budgetFor(c.id) === undefined ? lastBudget(c.id) : undefined }));
  const totalB = sum(rows.map((r) => r.budget)); const totalS = sum(rows.map((r) => r.spent));

  async function save(cid: string) {
    const c = parseMoneyInput(val); if (c === null) return toast("Enter a valid amount", true);
    try { await upsertBudget(cid, month, c); await reload(); setEditing(null); toast("Budget updated"); } catch (e) { toast((e as Error).message, true); }
  }
  async function copyLast() {
    const prev = addMonths(month, -1);
    const src = data.budgets.filter((b) => b.month.slice(0, 7) === prev);
    if (!src.length) return toast("No budget last month to copy", true);
    try { for (const b of src) await upsertBudget(b.category_id, month, b.amount); await reload(); toast("Copied last month's budget"); } catch (e) { toast((e as Error).message, true); }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid g3">
        <div className="card kpi"><div className="label">Budgeted</div><div className="value"><Money c={totalB} /></div></div>
        <div className="card kpi"><div className="label">Spent</div><div className="value"><Money c={totalS} /></div></div>
        <div className="card kpi" data-testid="left-to-spend"><div className="label">Left to spend this month</div><div className={"value " + (totalB - totalS < 0 ? "neg" : "pos")}><Money c={totalB - totalS} /></div></div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Categories</h2>
          <div className="row"><button className="btn sm" onClick={copyLast}>Copy last month</button><button className="btn sm" onClick={() => openExport("budget")}><Icon name="download" size={15} />Export</button></div></div>
        <table data-testid="budget-table">
          <thead><tr><th style={{ width: "26%" }}>Category</th><th style={{ width: "34%" }}></th><th className="r">Budgeted</th><th className="r">Spent</th><th className="r">Remaining</th></tr></thead>
          <tbody>{rows.map(({ c, budget, spent, carried }) => {
            const pct = budget ? (spent / budget) * 100 : spent ? 100 : 0;
            const tone = pct > 100 ? "over" : pct >= 80 ? "warn" : undefined;
            return (
              <tr key={c.id} data-testid="budget-row" data-category={c.name}>
                <td><span className="row" style={{ gap: 8 }}><i className="dot" style={{ background: c.color }} />{c.name}</span></td>
                <td><Progress pct={pct} tone={tone} /></td>
                <td className="r num">
                  {editing === c.id ? (
                    <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <input autoFocus style={{ width: 110, textAlign: "right" }} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(c.id)} data-testid="budget-input" />
                      <button className="btn primary sm" onClick={() => save(c.id)} data-testid="budget-save">Save</button>
                    </span>
                  ) : (
                    <a onClick={() => { setEditing(c.id); setVal(budget ? centsToDb(budget) : carried ? centsToDb(carried) : ""); }} data-testid="budget-edit" title="Click to edit">
                      {budget ? fmt(budget) : carried ? <span className="muted">{fmt(carried)}?</span> : <span className="muted">Set</span>}
                    </a>
                  )}
                </td>
                <td className="r num">{fmt(spent)}</td>
                <td className={"r num " + (budget - spent < 0 ? "neg" : "")} data-testid="budget-remaining">{fmt(budget - spent)}</td>
              </tr>);
          })}</tbody>
        </table>
        <div className="row" style={{ marginTop: 14 }}>
          <input style={{ maxWidth: 260 }} placeholder="New category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} data-testid="new-category" />
          <button className="btn sm" onClick={async () => { if (!newCat.trim()) return; try { await addCategory(newCat.trim(), "expense"); setNewCat(""); await reload(); toast("Category added"); } catch (e) { toast((e as Error).message, true); } }} data-testid="add-category"><Icon name="plus" size={15} />Add category</button>
        </div>
      </div>
    </div>
  );
}
