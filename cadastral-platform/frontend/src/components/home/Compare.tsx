const COLS = ["By hand", "A general chatbot", "JCE Site Planner"] as const;
/** Qualitative only: no invented times, costs or percentages. */
const ROWS: [string, [string, string, string]][] = [
  ["Where the number came from", ["From memory or a search", "Often answers without a source", "Document, version, page and quote"]],
  ["When it does not know", ["You may not notice", "May answer anyway", "Shown as Unresolved, with the next step"]],
  ["A layer it could not query", ["Easily missed", "Not applicable", "Shown as Not checked, never as clear"]],
  ["Plans and application pack", ["Drawn and assembled by you", "Text only", "Plan set, report and pack from one run"]],
  ["Checked by a professional", ["Yes, if you pay for it", "No", "Not by the tool. An engineer is one click away"]],
];
export function Compare() {
  return (
    <div className="overflow-x-auto border border-ink/40 bg-surface">
      <table className="w-full min-w-[44rem] text-sm"><caption className="sr-only">Comparison of approaches</caption>
        <thead><tr className="border-b border-ink/40"><th className="p-4 text-left font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted">&nbsp;</th>{COLS.map((c, i) => <th key={c} scope="col" className={`p-4 text-left font-display text-lg font-medium ${i === 2 ? "bg-brand-soft" : ""}`}>{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{ROWS.map(([k, v]) => <tr key={k}><th scope="row" className="p-4 text-left font-medium">{k}</th>{v.map((x, i) => <td key={x} className={`p-4 leading-snug ${i === 2 ? "bg-brand-soft font-medium" : "text-muted"}`}>{x}</td>)}</tr>)}</tbody></table>
    </div>
  );
}
