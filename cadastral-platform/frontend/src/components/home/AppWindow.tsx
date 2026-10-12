import type { ReactNode } from "react";
/** Mock application window frame (three dots + address bar) around REAL product output. */
export function AppWindow({ title, children, className = "", bodyClass = "" }: { title: string; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <div className={`sheet overflow-hidden rounded-xl2 ${className}`}>
      <div className="flex items-center gap-3 border-b border-line bg-subtle px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-ink/25" /><i className="h-2.5 w-2.5 rounded-full bg-ink/25" /><i className="h-2.5 w-2.5 rounded-full bg-ink/25" /></span>
        <span className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-3 py-1 font-mono text-[11px] text-muted">site-planner.app &middot; {title}</span>
      </div>
      <div className={bodyClass}>{children}</div>
    </div>
  );
}
export const NorthArrow = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 40 52" className={className} fill="none" aria-hidden="true"><circle cx="20" cy="30" r="17" className="stroke-ink/50" /><path d="M20 8l7 28-7-6-7 6z" className="fill-ink" /><text x="20" y="6" textAnchor="middle" fontSize="8" className="fill-ink font-mono" fontFamily="monospace">N</text></svg>
);
export const ScaleBar = ({ className = "" }: { className?: string }) => (
  <div className={`flex items-end gap-0 ${className}`} aria-hidden><span className="h-1.5 w-8 border border-ink bg-ink" /><span className="h-1.5 w-8 border border-ink" /><span className="h-1.5 w-8 border border-ink bg-ink" /><span className="h-1.5 w-8 border border-ink" /></div>
);
