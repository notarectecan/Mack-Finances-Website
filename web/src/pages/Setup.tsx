import { useState } from "react";
import { useApp } from "../App";
import { addGoal, seedDemo, updateIncomeSource, updateProfile } from "../lib/api";
import { parseMoneyInput } from "../lib/money";
import { Icon, Seg } from "../components/ui";

const CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF", "JPY", "INR", "ZAR"];

export function Setup() {
  const { data, reload, toast } = useApp();
  const p = data.profile;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(p.display_name); const [cur, setCur] = useState(p.currency_code);
  const [demo, setDemo] = useState<boolean | null>(null);
  const [incomes, setIncomes] = useState(data.sources.map((s) => ({ id: s.id, name: s.name, amt: "" })));
  const [goal, setGoal] = useState({ name: "House Deposit", target: "60000", saved: "0", monthly: "1000", date: "2028-12-01" });
  const [theme, setTheme] = useState<"light" | "dark" | "system">(p.theme);
  const [busy, setBusy] = useState(false);
  const total = 5;

  async function finish() {
    setBusy(true);
    try {
      if (demo) {
        const r = await seedDemo(); if (!r.startsWith("seeded") && !r.startsWith("skipped")) throw new Error(r);
      } else {
        for (const i of incomes) { const c = parseMoneyInput(i.amt || "0"); await updateIncomeSource(i.id, { name: i.name, expected: c ?? 0 }); }
        const t = parseMoneyInput(goal.target), s = parseMoneyInput(goal.saved || "0"), m = parseMoneyInput(goal.monthly || "0");
        if (goal.name && t) await addGoal({ name: goal.name, icon: "home", target: t, starting: s ?? 0, monthly: m ?? 0, target_date: goal.date || null, is_primary: true });
      }
      await updateProfile(p.id, { display_name: demo ? "Alex" : name.trim(), currency_code: cur, theme, onboarded: true });
      await reload(); toast("You're all set");
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  const next = () => setStep((s) => Math.min(total - 1, s + (step === 1 && demo ? 3 : 1)));
  return (
    <div className="auth-wrap">
      <div className="card stack" style={{ width: 560, padding: 36 }} data-testid="setup">
        <div className="steps">{Array.from({ length: total }).map((_, i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>
        {step === 0 && <>
          <h1>Welcome to Mack Finances</h1>
          <p className="muted">Let's make it yours. This takes about a minute.</p>
          <label className="f">What should we call you?<input value={name} onChange={(e) => setName(e.target.value)} data-testid="setup-name" /></label>
          <label className="f">Currency<select value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        </>}
        {step === 1 && <>
          <h1>Your data</h1>
          <p className="muted">Everything is stored in your private Supabase database. Only you can read it.</p>
          <div className="grid g2">
            <button className={"card hover" + (demo === false ? " hero" : "")} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setDemo(false)} data-testid="setup-fresh">
              <Icon name="plus" /><h3 style={{ marginTop: 8 }}>Start fresh</h3><p className="small muted">Log your own transactions from today.</p></button>
            <button className={"card hover" + (demo === true ? " hero" : "")} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setDemo(true)} data-testid="setup-demo">
              <Icon name="db" /><h3 style={{ marginTop: 8 }}>Use demo data</h3><p className="small muted">12 months of sample history to explore.</p></button>
          </div>
        </>}
        {step === 2 && <>
          <h1>Your income sources</h1>
          <p className="muted">Rename them to match your life. Expected monthly amounts power projections.</p>
          {incomes.map((i, idx) => (
            <div className="row" key={i.id}>
              <input value={i.name} onChange={(e) => setIncomes(incomes.map((x, j) => j === idx ? { ...x, name: e.target.value } : x))} />
              <input style={{ width: 160 }} placeholder="0.00 / month" inputMode="decimal" value={i.amt} onChange={(e) => setIncomes(incomes.map((x, j) => j === idx ? { ...x, amt: e.target.value } : x))} />
            </div>
          ))}
        </>}
        {step === 3 && <>
          <h1>Your first goal</h1>
          <p className="muted">We suggest a house deposit — change anything you like.</p>
          <label className="f">Goal name<input value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} /></label>
          <div className="grid g2">
            <label className="f">Target<input inputMode="decimal" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} /></label>
            <label className="f">Already saved<input inputMode="decimal" value={goal.saved} onChange={(e) => setGoal({ ...goal, saved: e.target.value })} /></label>
            <label className="f">Monthly contribution<input inputMode="decimal" value={goal.monthly} onChange={(e) => setGoal({ ...goal, monthly: e.target.value })} /></label>
            <label className="f">Target date<input type="date" value={goal.date} onChange={(e) => setGoal({ ...goal, date: e.target.value })} /></label>
          </div>
        </>}
        {step === 4 && <>
          <h1>Choose your look</h1>
          <Seg value={theme} onChange={(v) => { setTheme(v); document.documentElement.dataset.theme = v === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : v; }}
            options={[{ v: "light", l: "Light" }, { v: "dark", l: "Dark" }, { v: "system", l: "System" }]} />
        </>}
        <div className="row between" style={{ marginTop: 10 }}>
          <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step === 4 && demo ? 1 : step - 1)}>Back</button>
          {step < total - 1
            ? <button className="btn primary" disabled={step === 1 && demo === null} onClick={next} data-testid="setup-next">Continue</button>
            : <button className="btn gold" disabled={busy} onClick={finish} data-testid="setup-finish">{busy ? "Setting up…" : "Go to dashboard"}</button>}
        </div>
      </div>
    </div>
  );
}
