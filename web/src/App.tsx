import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppData, auth, loadAll, recordSnapshot, updateProfile } from "./lib/api";
import { netWorth } from "./lib/calc";
import { setCurrency } from "./lib/money";
import { addMonths, labelMonth, monthEnd, monthKey, today } from "./lib/dates";
import { Icon, Skeleton } from "./components/ui";
import { Login, LockScreen } from "./pages/Login";
import { Setup } from "./pages/Setup";
import type { TxnPrefill } from "./pages/Transactions";
import type { ExportPreset } from "./pages/Export";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Transactions = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.Transactions })));
const AddTransactionModal = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.AddTransactionModal })));
const Income = lazy(() => import("./pages/Income").then((m) => ({ default: m.Income })));
const Budget = lazy(() => import("./pages/Budget").then((m) => ({ default: m.Budget })));
const Goals = lazy(() => import("./pages/Goals").then((m) => ({ default: m.Goals })));
const Investments = lazy(() => import("./pages/Investments").then((m) => ({ default: m.Investments })));
const Projections = lazy(() => import("./pages/Projections").then((m) => ({ default: m.Projections })));
const Assistant = lazy(() => import("./pages/Assistant").then((m) => ({ default: m.Assistant })));
const AssistantDrawer = lazy(() => import("./pages/Assistant").then((m) => ({ default: m.AssistantDrawer })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const ExportModal = lazy(() => import("./pages/Export").then((m) => ({ default: m.ExportModal })));

export type Page = "dashboard" | "transactions" | "income" | "budget" | "goals" | "investments" | "projections" | "assistant" | "settings";
const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "transactions", label: "Transactions", icon: "list" },
  { id: "income", label: "Income", icon: "income" },
  { id: "budget", label: "Budget", icon: "budget" },
  { id: "goals", label: "Goals", icon: "target" },
  { id: "investments", label: "Investments & Freedom", icon: "chart" },
  { id: "projections", label: "Projections", icon: "forecast" },
  { id: "assistant", label: "AI Assistant", icon: "sparkle" },
  { id: "settings", label: "Settings", icon: "settings" },
];

interface Ctx {
  data: AppData; reload: () => Promise<void>; toast: (m: string, err?: boolean) => void; go: (p: Page) => void;
  month: string; setMonth: (m: string) => void; openAdd: (p?: TxnPrefill) => void; openExport: (p?: ExportPreset) => void;
  theme: "light" | "dark"; lock: () => void;
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

function resolveTheme(pref: string): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [session, setSession] = useState<"loading" | "out" | "in">("loading");
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [data, setData] = useState<AppData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || "dashboard");
  const [month, setMonth] = useState(monthKey(today()));
  const [toastMsg, setToast] = useState<{ m: string; err?: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState<TxnPrefill | null>(null);
  const [exportOpen, setExportOpen] = useState<ExportPreset | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [localTheme, setLocalTheme] = useState<string>(() => localStorage.getItem("lg-theme") ?? "system");

  useEffect(() => {
    // "Remember me" off => session ends when the browser session ends
    if (localStorage.getItem("lg-remember") === "0" && !sessionStorage.getItem("lg-alive")) auth.signOut();
    sessionStorage.setItem("lg-alive", "1");
    auth.getSession().then(({ data }) => { setSession(data.session ? "in" : "out"); setEmail(data.session?.user.email); });
    const sub = auth.onChange((inn, em) => { setSession(inn ? "in" : "out"); setEmail(em); if (!inn) { setData(null); setPage("dashboard"); history.replaceState(null, "", location.pathname); } });
    return () => sub.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await loadAll(); setCurrency(d.profile.currency_code); setData(d); setLoadErr(null);
      if (d.profile.onboarded && (d.holdings.length || d.goals.length)) {
        const nw = netWorth(d); const end = monthEnd(monthKey(today()));
        if (d.snapshots.find((s) => s.snapshot_date === end)?.net_worth !== nw) {
          recordSnapshot(end, nw).then(() => setData((cur) => cur && { ...cur, snapshots: [...cur.snapshots.filter((s) => s.snapshot_date !== end), { snapshot_date: end, net_worth: nw }] })).catch(() => {});
        }
      }
    }
    catch (e) { setLoadErr((e as Error).message); }
  }, []);
  useEffect(() => { if (session === "in") reload(); }, [session, reload]);

  // theme: profile preference when signed in, otherwise local preference
  const themePref = data?.profile.theme ?? localTheme;
  const theme = resolveTheme(themePref);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // auto-lock after inactivity
  useEffect(() => {
    const mins = Number(localStorage.getItem("lg-autolock") ?? "0");
    if (!mins || session !== "in") return;
    let t = window.setTimeout(() => setLocked(true), mins * 60000);
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => setLocked(true), mins * 60000); };
    ["mousemove", "keydown", "click"].forEach((e) => window.addEventListener(e, reset));
    return () => { clearTimeout(t); ["mousemove", "keydown", "click"].forEach((e) => window.removeEventListener(e, reset)); };
  }, [session]);

  const toast = useCallback((m: string, err?: boolean) => { setToast({ m, err }); setTimeout(() => setToast(null), 3200); }, []);
  useEffect(() => { const h = (e: Event) => toast((e as CustomEvent).detail); window.addEventListener("lg-toast", h); return () => window.removeEventListener("lg-toast", h); }, [toast]);
  const go = (p: Page) => { setPage(p); location.hash = p; window.scrollTo(0, 0); };

  const ctx = useMemo<Ctx | null>(() => data && ({
    data, reload, toast, go, month, setMonth, theme,
    openAdd: (p) => setAddOpen(p ?? {}), openExport: (p) => setExportOpen(p ?? "custom"), lock: () => setLocked(true),
  }), [data, reload, toast, month, theme]);

  const toastEl = toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")} role="status" data-testid="toast">{toastMsg.m}</div>;

  if (session === "loading") return <div className="auth-wrap"><div className="skel" style={{ width: 420, height: 380 }} /></div>;
  if (session === "out") return <>{<Login theme={localTheme} setTheme={(t) => { localStorage.setItem("lg-theme", t); setLocalTheme(t); }} />}{toastEl}</>;
  if (locked && email) return <LockScreen email={email} onUnlock={() => setLocked(false)} />;
  if (loadErr) return <div className="auth-wrap"><div className="card auth stack"><h2>Couldn't load your data</h2><p className="err-text">{loadErr}</p><button className="btn primary" onClick={reload}>Retry</button></div></div>;
  if (!ctx) return <div className="page grid g4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} />)}<div style={{ gridColumn: "1/-1" }}><Skeleton h={300} /></div></div>;
  if (!data!.profile.onboarded) return <AppCtx.Provider value={ctx}><Setup />{toastEl}</AppCtx.Provider>;

  const nav = NAV.find((n) => n.id === page) ?? NAV[0];
  const Body = { dashboard: Dashboard, transactions: Transactions, income: Income, budget: Budget, goals: Goals, investments: Investments, projections: Projections, assistant: Assistant, settings: Settings }[nav.id];
  const toggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setData({ ...data!, profile: { ...data!.profile, theme: next } });
    updateProfile(data!.profile.id, { theme: next }).catch((e) => toast(e.message, true));
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className={"shell" + (collapsed ? " collapsed" : "")}>
        <aside className="side">
          <div className="brand"><div className="mark"><Icon name="target" size={16} /></div><span>Mack Finances</span></div>
          {NAV.map((n) => (
            <button key={n.id} className={"nav" + (n.id === nav.id ? " active" : "")} onClick={() => go(n.id)} data-testid={`nav-${n.id}`}>
              <Icon name={n.icon} /><span>{n.label}</span>
            </button>
          ))}
          <div className="sync" title="Data is stored in your private Supabase database"><i className="dot" /><span>Synced with Supabase</span></div>
          <button className="nav" onClick={() => setCollapsed(!collapsed)}><Icon name="menu" /><span>Collapse</span></button>
        </aside>
        <main className="main">
          <header className="top">
            <h1>{nav.label}</h1>
            {["dashboard", "transactions", "budget"].includes(nav.id) && (
              <div className="row" style={{ gap: 4 }} data-testid="month-picker">
                <button className="iconbtn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><Icon name="chevl" /></button>
                <span style={{ minWidth: 130, textAlign: "center", fontWeight: 500 }}>{labelMonth(month, "long")}</span>
                <button className="iconbtn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><Icon name="chevr" /></button>
              </div>
            )}
            <button className="btn primary" onClick={() => setAddOpen({})} data-testid="add-txn"><Icon name="plus" />Add Transaction</button>
            <button className="iconbtn" onClick={toggleTheme} aria-label="Toggle theme" data-testid="theme-toggle"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            <ProfileMenu email={email} name={data!.profile.display_name} onLock={() => setLocked(true)} onSettings={() => go("settings")} />
          </header>
          <div className="page"><Suspense fallback={<div className="grid g4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} />)}</div>}><Body /></Suspense></div>
        </main>
      </div>
      {nav.id !== "assistant" && <button className="fab" onClick={() => setDrawer(true)} aria-label="Open AI assistant" data-testid="ai-fab"><Icon name="sparkle" size={22} /></button>}
      <Suspense fallback={null}>
        {drawer && <AssistantDrawer onClose={() => setDrawer(false)} />}
        {addOpen && <AddTransactionModal prefill={addOpen} onClose={() => setAddOpen(null)} />}
        {exportOpen && <ExportModal preset={exportOpen} onClose={() => setExportOpen(null)} />}
      </Suspense>
      {toastEl}
    </AppCtx.Provider>
  );
}

function ProfileMenu({ email, name, onLock, onSettings }: { email?: string; name: string; onLock: () => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="iconbtn" style={{ borderRadius: "50%", background: "var(--green)", color: "var(--gold)", fontWeight: 600 }} onClick={() => setOpen(!open)} data-testid="profile-menu" aria-label="Profile menu">
        {(name || email || "?").slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 44, width: 220, padding: 8, zIndex: 30 }} onMouseLeave={() => setOpen(false)}>
          <div className="small muted" style={{ padding: "6px 10px" }}>{email}</div>
          <button className="nav" onClick={onSettings}><Icon name="settings" />Settings</button>
          <button className="nav" onClick={onLock} data-testid="lock-app"><Icon name="lock" />Lock app</button>
          <button className="nav" onClick={() => auth.signOut()} data-testid="sign-out"><Icon name="logout" />Sign out</button>
        </div>
      )}
    </div>
  );
}
