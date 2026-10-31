import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../App";
import { CsvImport, importTransactions, listImports, undoImport } from "../lib/api";
import { buildIncomeSummaryRows, buildRows, DateFormat, detectFileKind, Field, guessDateFormat, guessMapping, Mapping, parseCSV, SignMode } from "../lib/csvImport";
import { fmt, toCents } from "../lib/money";
import { labelDate } from "../lib/dates";
import { Card, Icon, Modal } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;
const FIELDS: { f: Field; label: string; required?: boolean }[] = [
  { f: "date", label: "Date", required: true }, { f: "description", label: "Description", required: true },
  { f: "amount", label: "Amount" }, { f: "debit", label: "Money out (debit)" }, { f: "credit", label: "Money in (credit)" },
  { f: "type", label: "Type" }, { f: "category", label: "Category" }, { f: "notes", label: "Notes" },
];

export function ImportCsvCard() {
  const { reload, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; header: string[]; data: string[][] } | null>(null);
  const [imports, setImports] = useState<CsvImport[]>([]);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const refresh = () => listImports().then(setImports).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function onPick(f: File | undefined) {
    if (!f) return;
    if (fileRef.current) fileRef.current.value = "";
    if (f.size > MAX_BYTES) return toast("That file is larger than 5 MB", true);
    if (!/\.(csv|txt)$/i.test(f.name) && f.type && !/csv|text/.test(f.type)) return toast("Please choose a .csv file", true);
    const rows = parseCSV(await f.text());
    if (rows.length < 2) return toast("That file has no data rows", true);
    if (rows.length - 1 > 5000) return toast("Too many rows - please split the file (max 5,000 rows)", true);
    setFile({ name: f.name, header: rows[0], data: rows.slice(1) });
  }

  return (
    <Card title="Import transactions (CSV)" testid="import-card">
      <p className="small muted" style={{ marginTop: 0 }}>Upload a CSV from your bank or a Mack Finances export. You'll see a preview first; nothing is saved until you click Import.</p>
      <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0])} data-testid="import-file" />
      <button className="btn primary" onClick={() => fileRef.current?.click()} data-testid="import-btn"><Icon name="download" />Import data (CSV)</button>
      {imports.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Recent imports</div>
          <table className="small" data-testid="import-history"><tbody>{imports.map((i) => (
            <tr key={i.id}>
              <td>{i.file_name}<div className="muted">{new Date(i.created_at).toLocaleString()}</div></td>
              <td className="r num">{i.imported_count} added{i.skipped_count ? ` · ${i.skipped_count} skipped` : ""}</td>
              <td className="r">
                <button className="btn ghost sm danger" data-testid="undo-import" onClick={async () => {
                  if (confirmUndo !== i.id) { setConfirmUndo(i.id); toast("Click Undo again to remove this import's transactions"); return; }
                  try { await undoImport(i.id); setConfirmUndo(null); await reload(); await refresh(); toast(`Removed ${i.imported_count} imported transactions`); } catch (e) { toast((e as Error).message, true); }
                }}>{confirmUndo === i.id ? "Confirm undo" : "Undo"}</button>
              </td>
            </tr>))}</tbody></table>
        </div>
      )}
      {file && <ImportModal file={file} onClose={() => setFile(null)} onDone={async () => { setFile(null); await reload(); await refresh(); }} />}
    </Card>
  );
}

function ImportModal({ file, onClose, onDone }: { file: { name: string; header: string[]; data: string[][] }; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const kind = useMemo(() => detectFileKind(file.header), [file]);
  const [map, setMap] = useState<Mapping>(() => guessMapping(file.header));
  const [dateFormat, setDateFormat] = useState<DateFormat>(() => guessDateFormat(file.data.map((r) => r[guessMapping(file.header).date ?? 0] ?? "")));
  const [sign, setSign] = useState<SignMode>("negative_is_expense");
  const [skipDup, setSkipDup] = useState(true);
  const [createCats, setCreateCats] = useState(true);
  const [busy, setBusy] = useState(false);

  const isSummary = kind.kind === "mf_income_summary";
  const hasAmount = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;
  const autoMapped = map.date !== undefined && map.description !== undefined && hasAmount;
  const [showColumns, setShowColumns] = useState(kind.kind === "generic" && !autoMapped);
  const ready = isSummary || autoMapped;

  const summary = useMemo(() => (isSummary ? buildIncomeSummaryRows(file.header, file.data) : null), [file, isSummary]);
  const results = useMemo(() => summary ? summary.results : autoMapped ? buildRows(file.data, map, { dateFormat, sign }) : [], [summary, file, map, dateFormat, sign, autoMapped]);
  const ok = results.filter((r) => r.row); const bad = results.filter((r) => r.error);
  const months = summary ? new Set(ok.map((r) => r.row!.date.slice(0, 7))).size : 0;

  async function run() {
    setBusy(true);
    try {
      const res = await importTransactions(file.name, ok.map((r) => r.row!), skipDup, createCats);
      const parts = [`Imported ${res.imported} transaction${res.imported === 1 ? "" : "s"}`];
      if (res.skipped_duplicates) parts.push(`${res.skipped_duplicates} already in the app (skipped)`);
      if (res.categories_created) parts.push(`${res.categories_created} new categor${res.categories_created === 1 ? "y" : "ies"}`);
      if (bad.length) parts.push(`${bad.length} rows with problems left out`);
      toast(parts.join(" · ")); onDone();
    } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
  }

  const sel = (f: Field) => (
    <select value={map[f] ?? ""} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid={`map-${f}`}>
      <option value="">— not in file —</option>
      {file.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );

  if (kind.kind === "mf_unsupported") return (
    <Modal title={`Import ${file.name}`} onClose={onClose} testid="import-modal">
      <div className="stack">
        <p data-testid="import-unsupported">This is a Mack Finances <b>{kind.label}</b> export. It holds summary figures, not transactions, so it can't be imported.</p>
        <p className="small muted">You can import a <b>Transactions</b> export or an <b>Income Summary</b> export, or a CSV from your bank.</p>
        <button className="btn primary" style={{ justifySelf: "end" }} onClick={onClose}>OK</button>
      </div>
    </Modal>
  );

  return (
    <Modal title={`Import ${file.name}`} onClose={onClose} wide testid="import-modal">
      <div className="stack">
        {kind.kind === "mf_income_summary" && (
          <div className="card" style={{ background: "var(--gold-soft)", borderColor: "var(--gold)", padding: 14 }} data-testid="import-recognised">
            <b>Recognised: Mack Finances Income Summary.</b> Each month becomes one income entry per source, plus one total-spending and one saved &amp; invested entry ({months} months).
            {summary!.ignoredRows > 0 && <> The &ldquo;MONTHLY AVERAGE&rdquo; row is ignored.</>} Total and net columns are ignored because the app calculates them.
            <div className="small" style={{ marginTop: 6 }}>Note: if you already logged the individual transactions for these months, importing totals would count that money twice.</div>
          </div>
        )}
        {kind.kind === "mf_transactions" && <div className="card" style={{ background: "var(--green-soft)", padding: 14 }} data-testid="import-recognised"><b>Recognised: Mack Finances Transactions export.</b> Columns matched automatically.</div>}
        {kind.kind === "generic" && autoMapped && !showColumns && (
          <div className="row small" data-testid="import-automatched">Columns matched automatically. <a onClick={() => setShowColumns(true)}>Change column matching</a></div>
        )}
        {!isSummary && (showColumns || !autoMapped) && <>
          <div className="small muted">{file.data.length} rows found. Match your file's columns:</div>
          <div className="grid g4" style={{ gap: 10 }}>
            {FIELDS.map(({ f, label, required }) => <label className="f" key={f}>{label}{required ? " *" : ""}{sel(f)}</label>)}
          </div>
        </>}
        <div className="grid g4" style={{ gap: 10 }}>
          {!isSummary && (showColumns || !autoMapped || /\//.test(file.data[0]?.[map.date ?? 0] ?? "")) && (
            <label className="f">Date format<select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)} data-testid="date-format">
              <option value="MDY">Month/Day/Year (US)</option><option value="DMY">Day/Month/Year</option><option value="YMD">Year-Month-Day</option></select></label>)}
          {!isSummary && map.type === undefined && map.amount !== undefined && (
            <label className="f">Amounts in this file<select value={sign} onChange={(e) => setSign(e.target.value as SignMode)} data-testid="sign-mode">
              <option value="negative_is_expense">Negative = money out</option><option value="positive_is_expense">Positive = money out</option>
              <option value="all_expense">All are expenses</option><option value="all_income">All are income</option></select></label>)}
          <label className="row small" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />Skip transactions I already have</label>
          <label className="row small" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" checked={createCats} onChange={(e) => setCreateCats(e.target.checked)} />Create missing categories</label>
        </div>
        {!ready ? <div className="err-text">Choose the Date, Description and Amount (or Money in / Money out) columns.</div> : (
          <>
            <div className="row small" data-testid="import-summary">
              <span className="badge ok">{ok.length} ready</span>
              {bad.length > 0 && <span className="badge bad">{bad.length} with problems (will be left out)</span>}
            </div>
            <div style={{ overflow: "auto", maxHeight: 300, border: "1px solid var(--border)", borderRadius: 12 }}>
              <table className="small" data-testid="import-preview">
                <thead><tr><th>Line</th><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th className="r">Amount</th><th>Status</th></tr></thead>
                <tbody>{results.slice(0, 60).map((r, i) => (
                  <tr key={i}>
                    <td className="muted">{r.line}</td>
                    {r.row ? <>
                      <td className="num">{labelDate(r.row.date)} {r.row.date.slice(0, 4)}</td><td>{r.row.description}</td><td>{r.row.type.replace("_", " ")}</td>
                      <td>{r.row.category || <span className="muted">—</span>}</td><td className={"r num " + (r.row.type === "income" ? "pos" : "")}>{fmt(toCents(r.row.amount))}</td><td className="pos">OK</td>
                    </> : <td colSpan={6} className="neg">{r.error}</td>}
                  </tr>))}</tbody>
              </table>
            </div>
            {results.length > 60 && <div className="small muted">Showing the first 60 of {results.length} entries.</div>}
          </>
        )}
        <div className="row between">
          <span className="small muted">Your file stays in your browser; only the imported rows are saved to your private account.</span>
          <button className="btn primary" disabled={!ready || ok.length === 0 || busy} onClick={run} data-testid="import-run">
            {busy ? "Importing…" : `Import ${ok.length} transaction${ok.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </Modal>
  );
}
