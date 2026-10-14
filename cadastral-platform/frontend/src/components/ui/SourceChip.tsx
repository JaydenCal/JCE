import type { Citation } from "@/lib/types";
/** Evidence beside every value: document, version, page, with the quote on demand. */
export function SourceChip({ c }: { c: Citation }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-0.5 font-mono text-[10.5px] text-muted hover:border-ink hover:text-ink [&::-webkit-details-marker]:hidden">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M2 1h4l2 2v6H2z" /></svg>
        <span className="max-w-[16rem] truncate">{c.document}</span>{c.page != null && <span>p.{c.page}</span>}
      </summary>
      <div role="group" aria-label="Source" className="absolute left-0 z-20 mt-1 w-[min(22rem,80vw)] border border-ink/40 bg-surface p-3 text-left shadow-paper">
        <p className="font-mono text-[10.5px] uppercase tracking-wider text-gold">{c.document}</p>
        <p className="mt-1 font-mono text-[10.5px] text-muted">{[c.version && `Version ${c.version}`, c.page != null && `Page ${c.page}`].filter(Boolean).join(" · ")}</p>
        <blockquote className="mt-2 border-l-2 border-brand pl-3 text-[13px] leading-relaxed text-ink">&ldquo;{c.quote}&rdquo;</blockquote>
        {c.url && <a href={c.url} className="mt-2 inline-block text-xs font-medium text-gold underline underline-offset-4" target="_blank" rel="noreferrer noopener">Open document</a>}
      </div>
    </details>
  );
}
