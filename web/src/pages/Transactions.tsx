import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import { addTxn, aiCategorize, deleteTxn, Txn, TxnType, updateTxn } from "../lib/api";
import { fmt, parseMoneyInput, sum, centsToDb } from "../lib/money";
import { labelDate, monthKey, today } from "../lib/dates";
import { Icon, Modal, Seg } from "../components/ui";

export type TxnPrefill = Partial<Txn> & { edit?: Txn };
const TYPE_LABEL: Record<TxnType, string> = { expense: "Expense", income: "Income", transfer: "Transfer", goal_contribution: "Goal", investment: "Investment" };

export function Transactions() {
  const { data, month, openAdd, openExport, reload, toast } = useApp();
  const [q, setQ] = useState(""); const [type, setType] = useState<"all" | TxnType>("all"); const [cat, setCat] = useState("all");
  const [range, setRange] = useState<"month" | "all">("month");
  const catName = (id: string | null) => data.categories.find((c) => c.id === id);
  const rows = useMemo(() => data.txns.filter((t) =>
    (range === "all" || monthKey(t.txn_date) === month) && (type === "all" || t.txn_type === type) && (cat === "all" || t.category_id === cat)
    && (!q || t.description.toLowerCase().includes(q.toLowerCase()) || (t.notes ?? "").toLowerCase().includes(q.toLowerCase()))), [data.txns, month, type, cat, q, range]);
  const inc = sum(rows.filter((t) => t.txn_type === "income").map((t) => t.amount));
  const exp = sum(rows.filter((t) => t.txn_type === "expense").map((t) => t.amount));

  return (
    <div className="stack">
      <div className="grid g3">
        <div className="card kpi"><div className="label">Income</div><div className="value pos num" data-testid="tx-income">{fmt(inc)}</div></div>
        <div className="card kpi"><div className="label">Expenses</div><div className="value num" data-testid="tx-expense">{fmt(exp)}</div></div>
        <div className="card kpi"><div className="label">Net</div><div className={"value num " + (inc - exp >= 0 ? "pos" : "neg")} data-testid="tx-net">{fmt(inc - exp, { sign: true })}</div></div>
      </div>
      <div className="card">
        <div className="row wrap" style={{ marginBottom: 14 }}>
          <div style={{ position: "relative", width: 260 }}><input placeholder="Search description or notes" value={q} onChange={(e) => setQ(e.target.value)} data-testid="tx-search" /></div>
          <Seg value={range} onChange={setRange} options={[{ v: "month", l: "This month" }, { v: "all", l: "All time" }]} />
          <select style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value as any)} data-testid="tx-type-filter">
            <option value="all">All types</option>{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={{ width: 190 }} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grow" />
          <button className="btn" onClick={() => openExport("transactions")} data-testid="export-btn"><Icon name="download" />Export</button>
        </div>
        {rows.length === 0 ? (
          <div className="empty" data-testid="tx-empty"><Icon name="list" size={28} /><p>No transactions here yet.</p><button className="btn primary" onClick={() => openAdd()}>Log your first one</button></div>
        ) : (
          <table data-testid="tx-table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Type</th><th className="r">Amount</th><th></th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((t) => {
                const c = catName(t.category_id) ?? (t.goal_id ? { name: data.goals.find((g) => g.id === t.goal_id)?.name ?? "Goal", color: "#C9A227" } : null);
                return (
                  <tr key={t.id} data-testid="tx-row">
                    <td className="num muted">{labelDate(t.txn_date)}</td>
                    <td>{t.description}{t.notes && <div className="small muted">{t.notes}</div>}</td>
                    <td>{c ? <span className="pill"><i className="sw" style={{ background: c.color }} />{c.name}{t.category_origin === "ai" && <span className="goldc" title="Categorized by AI">✦</span>}</span> : <span className="muted">—</span>}</td>
                    <td className="muted">{data.accounts.find((a) => a.id === t.account_id)?.name ?? "—"}</td>
                    <td className="muted small">{TYPE_LABEL[t.txn_type]}</td>
                    <td className={"r num " + (t.txn_type === "income" ? "pos" : "")}>{t.txn_type === "income" ? "+" : "–"}{fmt(t.amount)}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <button className="btn ghost sm" onClick={() => openAdd({ edit: t })} aria-label="Edit"><Icon name="edit" size={15} /></button>
                      <button className="btn ghost sm danger" aria-label="Delete" onClick={async () => { if (!confirm2(t.description)) return; try { await deleteTxn(t.id); await reload(); toast("Transaction deleted"); } catch (e) { toast((e as Error).message, true); } }}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
// no blocking browser dialogs: a second click within 3s confirms
const pending = new Map<string, number>();
function confirm2(key: string) { const now = Date.now(); const t = pending.get(key); if (t && now - t < 3000) { pending.delete(key); return true; } pending.set(key, now); window.dispatchEvent(new CustomEvent("lg-toast", { detail: "Click delete again to confirm" })); return false; }

export function AddTransactionModal({ prefill, onClose }: { prefill: TxnPrefill; onClose: () => void }) {
  const { data, reload, toast } = useApp();
  const e = prefill.edit;
  const [type, setType] = useState<TxnType>(e?.txn_type ?? prefill.txn_type ?? "expense");
  const [amount, setAmount] = useState(e ? centsToDb(e.amount) : prefill.amount ? centsToDb(prefill.amount) : "");
  const [date, setDate] = useState(e?.txn_date ?? today());
  const [desc, setDesc] = useState(e?.description ?? prefill.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(e?.category_id ?? "");
  const [sourceId, setSourceId] = useState<string>(e?.income_source_id ?? data.sources[0]?.id ?? "");
  const [accountId, setAccountId] = useState<string>(e?.account_id ?? data.accounts[0]?.id ?? "");
  const [goalId, setGoalId] = useState<string>(e?.goal_id ?? prefill.goal_id ?? data.goals.find((g) => g.is_primary)?.id ?? data.goals[0]?.id ?? "");
  const [notes, setNotes] = useState(e?.notes ?? ""); const [recurring, setRecurring] = useState(e?.is_recurring ?? false);
  const [another, setAnother] = useState(false);
  const [ai, setAi] = useState<{ id: string; name: string; confidence: number } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "off">("idle");
  const [origin, setOrigin] = useState<"manual" | "ai">(e?.category_origin ?? "manual");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);
  useEffect(() => { amtRef.current?.focus(); }, []);

  const kind = type === "income" ? "income" : "expense";
  const cats = data.categories.filter((c) => c.kind === kind && !c.archived);

  async function suggest() {
    if (!desc.trim() || categoryId || (type !== "expense" && type !== "income") || aiState === "off") return;
    setAiState("loading");
    try {
      const r = await aiCategorize(desc.trim(), kind); // only the description is sent
      if (cats.some((c) => c.id === r.category_id)) { setAi({ id: r.category_id, name: r.category_name, confidence: r.confidence }); setCategoryId(r.category_id); setOrigin("ai"); }
      setAiState("idle");
    } catch { setAiState("off"); }
  }

  async function save() {
    setErr(null);
    const cents = parseMoneyInput(amount);
    if (!cents || cents <= 0) return setErr("Enter an amount greater than zero");
    if (!desc.trim()) return setErr("Add a short description");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("Pick a date");
    if (type === "goal_contribution" && !goalId) return setErr("Choose a goal");
    setBusy(true);
    const row = {
      txn_type: type, amount: cents, txn_date: date, description: desc.trim(), notes: notes.trim() || null, is_recurring: recurring,
      account_id: accountId || null,
      category_id: type === "expense" || type === "income" ? categoryId || null : null,
      income_source_id: type === "income" ? sourceId || null : null,
      goal_id: type === "goal_contribution" ? goalId : null,
      category_origin: (type === "expense" || type === "income") && categoryId && origin === "ai" ? "ai" as const : "manual" as const,
    };
    try {
      if (e) await updateTxn(e.id, row); else await addTxn(row);
      await reload(); toast(e ? "Transaction updated" : "Transaction saved");
      if (another && !e) { setAmount(""); setDesc(""); setNotes(""); setCategoryId(""); setAi(null); setOrigin("manual"); amtRef.current?.focus(); }
      else onClose();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={e ? "Edit transaction" : "Add transaction"} onClose={onClose} testid="txn-modal">
      <div className="stack">
        <Seg value={type} onChange={(v) => { setType(v); setCategoryId(""); setAi(null); }} testid="txn-type"
          options={[{ v: "expense", l: "Expense" }, { v: "income", l: "Income" }, { v: "transfer", l: "Transfer" }, { v: "goal_contribution", l: "Goal Contribution" }, { v: "investment", l: "Investment" }]} />
        <input ref={amtRef} className="amount-in num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(x) => setAmount(x.target.value)} data-testid="txn-amount" aria-label="Amount" />
        <div className="grid g2">
          <label className="f">Date<input type="date" value={date} onChange={(x) => setDate(x.target.value)} data-testid="txn-date" /></label>
          <label className="f">Account<select value={accountId} onChange={(x) => setAccountId(x.target.value)}>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="">None</option></select></label>
        </div>
        <label className="f">Description<input value={desc} onChange={(x) => setDesc(x.target.value)} onBlur={suggest} placeholder={type === "income" ? "e.g. Owner's draw" : "e.g. Whole Foods"} data-testid="txn-desc" /></label>
        {(type === "expense" || type === "income") && (
          <label className="f">
            <span className="row between">Category
              {aiState === "loading" && <span className="ai-chip">✦ Suggesting…</span>}
              {ai && categoryId === ai.id && <span className="ai-chip" data-testid="ai-suggestion">✦ AI suggested · {Math.round(ai.confidence * 100)}%</span>}
            </span>
            <select value={categoryId} onChange={(x) => { setCategoryId(x.target.value); setOrigin("manual"); }} data-testid="txn-category">
              <option value="">Choose a category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {type === "income" && <label className="f">Income source<select value={sourceId} onChange={(x) => setSourceId(x.target.value)} data-testid="txn-source">{data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {type === "goal_contribution" && <label className="f">Goal<select value={goalId} onChange={(x) => setGoalId(x.target.value)} data-testid="txn-goal">{data.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
        <label className="f">Note (optional)<input value={notes} onChange={(x) => setNotes(x.target.value)} /></label>
        <div className="row small">
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={recurring} onChange={(x) => setRecurring(x.target.checked)} />Recurring</label>
          {!e && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={another} onChange={(x) => setAnother(x.target.checked)} data-testid="txn-another" />Save &amp; add another</label>}
        </div>
        {err && <div className="err-text" data-testid="txn-error">{err}</div>}
        <button className="btn primary" style={{ justifyContent: "center", padding: 12 }} onClick={save} disabled={busy} data-testid="txn-save">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
