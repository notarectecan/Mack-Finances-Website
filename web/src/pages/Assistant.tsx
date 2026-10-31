import { useEffect, useRef, useState } from "react";
import { useApp } from "../App";
import { aiSummary } from "../lib/api";
import { addMonths, monthEnd, monthKey, monthStart, today } from "../lib/dates";
import { Icon } from "../components/ui";

const CHIPS = ["Can I afford a $2,000 holiday?", "When will I reach my house deposit?", "Where am I overspending?", "Summarise my month"];
interface Msg { who: "me" | "ai"; text: string; highlights?: string[]; err?: boolean }

function periodFor(q: string): [string, string] {
  const cur = monthKey(today());
  if (/\b(this|my) month\b|summari[sz]e my month/i.test(q)) return [monthStart(cur), monthEnd(cur)];
  if (/\byear\b/i.test(q)) return [`${cur.slice(0, 4)}-01-01`, monthEnd(cur)];
  return [monthStart(addMonths(cur, -5)), monthEnd(cur)]; // default: last 6 months
}

function Chat({ compact }: { compact?: boolean }) {
  const { data } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([{ who: "ai", text: `Hi ${data.profile.display_name || "there"} — ask me anything about your spending, income or goals.` }]);
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { who: "me", text }]); setQ(""); setBusy(true);
    try {
      const [s, e] = periodFor(text);
      const r = await aiSummary(s, e, text);
      setMsgs((m) => [...m, { who: "ai", text: r.answer, highlights: r.highlights }]);
    } catch (x) {
      const msg = (x as Error).message;
      setMsgs((m) => [...m, { who: "ai", err: true, text: /OPENAI_API_KEY|503|unavailable/i.test(msg) ? "The AI assistant isn't configured yet (the server needs its OpenAI key). Everything else in the app works normally." : `Sorry — I couldn't answer that right now. (${msg})` }]);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: compact ? "100%" : "calc(100vh - 190px)" }} data-testid="chat">
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + m.who} data-testid={m.who === "ai" ? "ai-msg" : "me-msg"} style={m.err ? { borderColor: "var(--red)" } : undefined}>
            {m.text}
            {m.highlights && m.highlights.length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{m.highlights.map((h, j) => <li key={j} className="small">{h}</li>)}</ul>}
          </div>))}
        {busy && <div className="msg ai"><span className="skel" style={{ display: "inline-block", width: 120, height: 12 }} /></div>}
        <div ref={end} />
      </div>
      <div style={{ padding: compact ? 14 : "14px 0", borderTop: "1px solid var(--border)" }} className="stack">
        <div className="row wrap" style={{ gap: 8 }}>{CHIPS.map((c) => <button key={c} className="chip" onClick={() => ask(c)} data-testid="ai-chip">{c}</button>)}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your finances…" data-testid="ai-input" />
          <button className="btn primary" disabled={busy} aria-label="Send"><Icon name="send" size={16} /></button>
        </form>
        <div className="small muted">Answers use aggregated totals from your own data only — individual transactions never leave the app.</div>
      </div>
    </div>
  );
}

export const Assistant = () => <div className="card" style={{ padding: "0 20px" }}><Chat /></div>;

export function AssistantDrawer({ onClose }: { onClose: () => void }) {
  return (
    <aside className="drawer" data-testid="ai-drawer">
      <div className="card-h" style={{ padding: "16px 18px", margin: 0, borderBottom: "1px solid var(--border)" }}>
        <h2 className="row" style={{ gap: 8 }}><span className="goldc"><Icon name="sparkle" /></span>Assistant</h2>
        <button className="iconbtn" onClick={onClose} aria-label="Close assistant"><Icon name="x" /></button>
      </div>
      <Chat compact />
    </aside>
  );
}
