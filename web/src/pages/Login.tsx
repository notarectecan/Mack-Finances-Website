import { FormEvent, useState } from "react";
import { auth } from "../lib/api";
import { Icon } from "../components/ui";

function strength(p: string) {
  let s = 0; if (p.length >= 8) s++; if (p.length >= 12) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return { score: s, label: ["Too weak", "Weak", "Fair", "Good", "Strong", "Excellent"][s] };
}

export function Login({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [name, setName] = useState("");
  const [show, setShow] = useState(false); const [remember, setRemember] = useState(localStorage.getItem("lg-remember") !== "0");
  const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const st = strength(pw);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setInfo(null); setBusy(true);
    try {
      localStorage.setItem("lg-remember", remember ? "1" : "0");
      if (mode === "in") {
        const { error } = await auth.signIn(email.trim(), pw);
        if (error) setErr("Incorrect email or password");
      } else if (mode === "up") {
        if (pw !== pw2) { setErr("Passwords don't match"); return; }
        if (st.score < 2 || pw.length < 8) { setErr("Use at least 8 characters with a mix of letters and numbers"); return; }
        const { data, error } = await auth.signUp(email.trim(), pw, name.trim());
        if (error) setErr(error.message);
        else if (!data.session) setInfo("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await auth.resetPassword(email.trim());
        if (error) setErr(error.message); else setInfo("If that email has an account, a reset link is on its way.");
      }
    } finally { setBusy(false); }
  }

  const dark = (theme === "dark") || (theme === "system" && matchMedia?.("(prefers-color-scheme: dark)").matches);
  return (
    <div className="auth-wrap">
      <button className="iconbtn" style={{ position: "fixed", top: 20, right: 20 }} onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle theme"><Icon name={dark ? "sun" : "moon"} /></button>
      <form className="card auth stack" onSubmit={submit} data-testid="auth-form" style={{ padding: 34 }}>
        <div className="brand" style={{ padding: 0, justifyContent: "center" }}><div className="mark"><Icon name="target" size={16} /></div><span>Mack Finances</span></div>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24 }}>{mode === "in" ? "Welcome back" : mode === "up" ? "Create your login" : "Reset password"}</h1>
          <p className="muted small" style={{ margin: "6px 0 0" }}>{mode === "up" ? "Your data is private to your account." : mode === "in" ? "Sign in to your private finance dashboard." : "We'll email you a secure link."}</p>
        </div>
        {mode === "up" && <label className="f">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" data-testid="name" /></label>}
        <label className="f">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" /></label>
        {mode !== "reset" && (
          <label className="f">Password
            <div style={{ position: "relative" }}>
              <input type={show ? "text" : "password"} required autoComplete={mode === "up" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="password" />
              <button type="button" className="btn ghost sm" style={{ position: "absolute", right: 4, top: 4 }} onClick={() => setShow(!show)} aria-label="Show password"><Icon name="eye" size={16} /></button>
            </div>
          </label>
        )}
        {mode === "up" && <>
          <div><div className={"bar " + (st.score < 2 ? "over" : st.score < 4 ? "warn" : "")}><i style={{ width: `${(st.score / 5) * 100}%` }} /></div><div className="small muted" style={{ marginTop: 4 }}>{st.label}</div></div>
          <label className="f">Confirm password<input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="password2" /></label>
        </>}
        {mode === "in" && (
          <div className="row between small">
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember me on this browser</label>
            <a onClick={() => setMode("reset")}>Forgot password?</a>
          </div>
        )}
        {err && <div className="err-text" role="alert" data-testid="auth-error">{err}</div>}
        {info && <div className="small pos" data-testid="auth-info">{info}</div>}
        <button className="btn primary" style={{ justifyContent: "center", padding: 12 }} disabled={busy} data-testid="auth-submit">
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
        </button>
        <div className="small muted" style={{ textAlign: "center" }}>
          {mode === "in" ? <>New here? <a onClick={() => setMode("up")} data-testid="to-signup">Create an account</a></> : <a onClick={() => setMode("in")}>Back to sign in</a>}
        </div>
      </form>
    </div>
  );
}

export function LockScreen({ email, onUnlock }: { email: string; onUnlock: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="auth-wrap">
      <form className="card auth stack" style={{ padding: 34 }} data-testid="lock-screen" onSubmit={async (e) => {
        e.preventDefault(); const { error } = await auth.signIn(email, pw); if (error) setErr("Incorrect password"); else onUnlock();
      }}>
        <div style={{ textAlign: "center" }}><Icon name="lock" size={28} /><h2 style={{ marginTop: 8 }}>App locked</h2><p className="muted small">{email}</p></div>
        <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="unlock-password" />
        {err && <div className="err-text">{err}</div>}
        <button className="btn primary" style={{ justifyContent: "center" }}>Unlock</button>
        <a className="small" style={{ textAlign: "center" }} onClick={() => auth.signOut()}>Sign out instead</a>
      </form>
    </div>
  );
}
