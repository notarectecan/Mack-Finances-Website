import { useState } from "react";
import { useApp } from "../App";
import { addHolding, deleteHolding, Holding, updateHolding, updateProfile } from "../lib/api";
import { fmt, parseMoneyInput, sum, centsToDb } from "../lib/money";
import { today } from "../lib/dates";
import { annualExpenses, baseline, freedom, investedTotal } from "../lib/calc";
import { Card, Donut, Icon, LineChart, Modal, Progress } from "../components/ui";

const TYPES: Record<string, string> = { index_fund: "Index fund", retirement: "Retirement", stocks: "Stocks", crypto: "Crypto", cash: "Cash", property: "Property", bonds: "Bonds", other: "Other" };
const TYPE_COLOR: Record<string, string> = { index_fund: "#0F5C3F", retirement: "#2E8B62", stocks: "#C9A227", crypto: "#8FAF9A", cash: "#5E655F", property: "#B08D2A", bonds: "#4A7C6A", other: "#9AA19B" };

export function Investments() {
  const { data, reload, toast, openExport } = useApp();
  const p = data.profile;
  const [modal, setModal] = useState<Holding | "new" | null>(null);
  const total = sum(data.holdings.map((h) => h.value));
  const derivedExp = annualExpenses({ ...data, profile: { ...p, annual_expenses_override: null } });
  const [exp, setExp] = useState(centsToDb(p.annual_expenses_override ?? derivedExp).split(".")[0]);
  const [rate, setRate] = useState(p.withdrawal_rate); const [ret, setRet] = useState(p.expected_return);
  const holdMonthly = sum(data.holdings.map((h) => h.monthly));
  const [monthly, setMonthly] = useState(String(Math.round((holdMonthly || baseline(data).invested) / 100)));
  const fr = freedom({ annualExpenses: (parseMoneyInput(exp) ?? 0), withdrawalRate: rate, invested: investedTotal(data), monthly: Number(monthly || 0) * 100, returnPct: ret, birthYear: p.birth_year });

  async function persist() {
    try {
      const e = parseMoneyInput(exp);
      await updateProfile(p.id, { withdrawal_rate: rate, expected_return: ret, annual_expenses_override: e !== null && e !== derivedExp ? centsToDb(e) : null });
      await reload(); toast("Freedom settings saved");
    } catch (x) { toast((x as Error).message, true); }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1.15fr 1fr", alignItems: "start" }}>
      <div className="stack" style={{ gap: 20 }}>
        <Card title={<>Holdings <span className="muted num" style={{ fontSize: 15 }}>· {fmt(total, { decimals: false })}</span></>}
          action={<div className="row"><button className="btn sm" onClick={() => openExport("investments")}><Icon name="download" size={15} />Export</button><button className="btn primary sm" onClick={() => setModal("new")} data-testid="add-holding"><Icon name="plus" size={15} />Add Holding</button></div>} testid="holdings">
          {data.holdings.length === 0 ? <div className="empty">Add your investment accounts to track your Freedom Number.</div> : (
            <table><thead><tr><th>Account / asset</th><th>Type</th><th className="r">Value</th><th className="r">Monthly</th><th className="r">Alloc.</th><th></th></tr></thead>
              <tbody>{data.holdings.map((h) => (
                <tr key={h.id} data-testid="holding-row"><td>{h.name}<div className="small muted">{h.value_as_of ? `as of ${h.value_as_of}` : ""}</div></td>
                  <td><span className="pill"><i className="sw" style={{ background: TYPE_COLOR[h.asset_type] }} />{TYPES[h.asset_type]}</span></td>
                  <td className="r num">{fmt(h.value, { decimals: false })}</td><td className="r num muted">{fmt(h.monthly, { decimals: false })}</td>
                  <td className="r num">{total ? Math.round((h.value / total) * 100) : 0}%</td>
                  <td className="r"><button className="btn ghost sm" onClick={() => setModal(h)} aria-label="Edit holding"><Icon name="edit" size={15} /></button></td></tr>))}</tbody></table>)}
        </Card>
        {data.holdings.length > 0 && <Card title="Allocation">
          <div className="row"><Donut items={Object.entries(data.holdings.reduce<Record<string, number>>((a, h) => ({ ...a, [h.asset_type]: (a[h.asset_type] ?? 0) + h.value }), {})).map(([k, v]) => ({ name: TYPES[k], total: v, color: TYPE_COLOR[k] }))} />
            <div className="stack grow" style={{ gap: 8 }}>{Object.entries(data.holdings.reduce<Record<string, number>>((a, h) => ({ ...a, [h.asset_type]: (a[h.asset_type] ?? 0) + h.value }), {})).map(([k, v]) => <div key={k} className="row between small"><span className="row" style={{ gap: 8 }}><i className="dot" style={{ background: TYPE_COLOR[k] }} />{TYPES[k]}</span><span className="num">{Math.round((v / total) * 100)}%</span></div>)}</div></div>
        </Card>}
      </div>

      <section className="card hero stack" data-testid="freedom-calc">
        <div className="small goldc" style={{ textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>Freedom Number calculator</div>
        <div><div className="muted small">Your Freedom Number</div><div className="big" data-testid="freedom-number">{fmt(fr.target, { decimals: false })}</div></div>
        <div><Progress pct={fr.progress * 100} tone="gold" /><div className="row between small" style={{ marginTop: 6 }}><span data-testid="freedom-progress"><b className="num">{(fr.progress * 100).toFixed(1)}%</b> there</span>
          <span className="muted">{fr.yearReached ? `Estimated ${fr.yearReached}${fr.ageReached ? ` (age ${fr.ageReached})` : ""}` : "Not reached within 100 years"}</span></div></div>
        <div className="grid g2">
          <label className="f">Annual living expenses<input inputMode="decimal" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="fr-expenses" /><span className="small muted">From tracked spending: {fmt(derivedExp, { decimals: false })}</span></label>
          <label className="f">Monthly investing<input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
          <label className="f">Safe withdrawal rate: <b className="num">{rate.toFixed(1)}%</b><input type="range" min={2.5} max={6} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} data-testid="fr-rate" /></label>
          <label className="f">Expected annual return: <b className="num">{ret.toFixed(1)}%</b><input type="range" min={0} max={12} step={0.5} value={ret} onChange={(e) => setRet(Number(e.target.value))} /></label>
        </div>
        <LineChart height={190} labels={fr.path.map((p) => `+${p.year}y`)} series={[{ name: "Portfolio", values: fr.path.map((p) => p.value), color: "var(--green-2)", area: true }, { name: "Freedom Number", values: fr.path.map(() => fr.target), color: "var(--gold)", dashed: true }]} />
        <p className="small muted" style={{ margin: 0 }}>Freedom Number = annual expenses ÷ withdrawal rate. Projections are estimates, not financial advice.</p>
        <button className="btn gold" style={{ justifySelf: "start" }} onClick={persist} data-testid="fr-save">Save settings</button>
      </section>
      {modal && <HoldingModal h={modal === "new" ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function HoldingModal({ h, onClose }: { h: Holding | null; onClose: () => void }) {
  const { reload, toast } = useApp();
  const [name, setName] = useState(h?.name ?? ""); const [type, setType] = useState(h?.asset_type ?? "index_fund");
  const [value, setValue] = useState(h ? centsToDb(h.value) : ""); const [monthly, setMonthly] = useState(h ? centsToDb(h.monthly) : "0"); const [err, setErr] = useState<string | null>(null);
  async function save() {
    const v = parseMoneyInput(value), m = parseMoneyInput(monthly || "0");
    if (!name.trim() || v === null || m === null) return setErr("Enter a name and valid amounts");
    try { const row = { name: name.trim(), asset_type: type, value: v, monthly: m, value_as_of: today() }; if (h) await updateHolding(h.id, row); else await addHolding(row); await reload(); toast("Holding saved"); onClose(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={h ? "Update holding" : "Add holding"} onClose={onClose} testid="holding-modal">
      <div className="stack">
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vanguard Total World" data-testid="holding-name" /></label>
        <label className="f">Type<select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="grid g2">
          <label className="f">Current value<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="holding-value" /></label>
          <label className="f">Monthly contribution<input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
        </div>
        {err && <div className="err-text">{err}</div>}
        <div className="row between">
          {h ? <button className="btn danger" onClick={async () => { await deleteHolding(h.id); await reload(); onClose(); }}>Remove</button> : <span />}
          <button className="btn primary" onClick={save} data-testid="holding-save">Save</button>
        </div>
      </div>
    </Modal>
  );
}
