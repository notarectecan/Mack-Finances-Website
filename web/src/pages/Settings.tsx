import { useState } from "react";
import { useApp } from "../App";
import { addCategory, auth, seedDemo, updateCategory, updateProfile } from "../lib/api";
import { Card, Icon, Seg } from "../components/ui";

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF", "JPY", "INR", "ZAR"];

export function Settings() {
  const { data, reload, toast, openExport } = useApp();
  const p = data.profile;
  const [name, setName] = useState(p.display_name); const [cur, setCur] = useState(p.currency_code); const [birth, setBirth] = useState(p.birth_year ? String(p.birth_year) : "");
  const [pw, setPw] = useState(""); const [autolock, setAutolock] = useState(localStorage.getItem("lg-autolock") ?? "0");
  const [newCat, setNewCat] = useState(""); const [kind, setKind] = useState<"expense" | "income">("expense");
  const save = async (patch: Record<string, unknown>, msg = "Settings saved") => { try { await updateProfile(p.id, patch); await reload(); toast(msg); } catch (e) { toast((e as Error).message, true); } };

  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <div className="stack" style={{ gap: 20 }}>
        <Card title="Profile">
          <div className="stack">
            <label className="f">Display name<input value={name} onChange={(e) => setName(e.target.value)} data-testid="set-name" /></label>
            <div className="grid g2">
              <label className="f">Currency<select value={cur} onChange={(e) => setCur(e.target.value)} data-testid="set-currency">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="f">Birth year (for Freedom age)<input inputMode="numeric" value={birth} onChange={(e) => setBirth(e.target.value)} /></label>
            </div>
            <div className="small muted">Time zone: {p.timezone} (detected from your browser — used so late-night entries land on the right day)</div>
            <button className="btn primary" style={{ justifySelf: "start" }} onClick={() => save({ display_name: name.trim(), currency_code: cur, birth_year: birth ? Number(birth) : null })} data-testid="set-save">Save profile</button>
          </div>
        </Card>
        <Card title="Appearance">
          <Seg value={p.theme} onChange={(v) => save({ theme: v }, "Theme updated")} testid="set-theme" options={[{ v: "light", l: "Light" }, { v: "dark", l: "Dark" }, { v: "system", l: "System" }]} />
        </Card>
        <Card title="Security">
          <div className="stack">
            <label className="f">Change password<div className="row"><input type="password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn" onClick={async () => { if (pw.length < 8) return toast("Use at least 8 characters", true); const { error } = await auth.updatePassword(pw); if (error) toast(error.message, true); else { setPw(""); toast("Password updated"); } }}>Update</button></div></label>
            <label className="f">Auto-lock after inactivity<select value={autolock} onChange={(e) => { setAutolock(e.target.value); localStorage.setItem("lg-autolock", e.target.value); toast("Auto-lock updated — applies on next load"); }}>
              <option value="0">Off</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="60">1 hour</option></select></label>
          </div>
        </Card>
      </div>
      <div className="stack" style={{ gap: 20 }}>
        <Card title="Data source">
          <div className="row" style={{ gap: 14 }}>
            <div className="iconbtn" style={{ width: 44, height: 44, color: "var(--green-2)" }}><Icon name="db" /></div>
            <div className="grow"><b>Supabase (private database)</b><div className="small muted"><i className="dot" style={{ display: "inline-block", marginRight: 6 }} />Connected · row-level security on every table</div></div>
          </div>
          <div className="row wrap" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => reload().then(() => toast("Synced"))}>Sync now</button>
            <button className="btn" onClick={() => openExport("backup")}><Icon name="download" />Export data (CSV)</button>
            {data.txns.length === 0 && <button className="btn" onClick={async () => { try { await seedDemo(); await reload(); toast("Demo data loaded"); } catch (e) { toast((e as Error).message, true); } }}>Load demo data</button>}
          </div>
        </Card>
        <Card title="Categories">
          <div className="stack" style={{ gap: 8, maxHeight: 360, overflow: "auto" }}>
            {data.categories.map((c) => (
              <div key={c.id} className="row" data-testid="cat-row">
                <input type="color" value={c.color} style={{ width: 38, padding: 2 }} onChange={(e) => updateCategory(c.id, { color: e.target.value }).then(reload)} />
                <input defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && updateCategory(c.id, { name: e.target.value.trim() }).then(() => { reload(); toast("Category renamed"); }).catch((x) => toast(x.message, true))} />
                <span className="small muted" style={{ width: 60 }}>{c.kind}</span>
                <button className="btn ghost sm" onClick={() => updateCategory(c.id, { archived: !c.archived }).then(reload)}>{c.archived ? "Restore" : "Hide"}</button>
              </div>))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <select style={{ width: 120 }} value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="expense">Expense</option><option value="income">Income</option></select>
            <button className="btn" onClick={async () => { if (!newCat.trim()) return; try { await addCategory(newCat.trim(), kind); setNewCat(""); await reload(); toast("Category added"); } catch (e) { toast((e as Error).message, true); } }}>Add</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
