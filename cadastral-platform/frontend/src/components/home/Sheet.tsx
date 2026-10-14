import type { ReactNode } from "react";
/** A page section drawn as a drawing sheet: double border, content, and a title-block strip. Our own device, taken from the plan sets the product produces. */
export const TOTAL = 12;
export function Sheet({ n, title, id, children, className = "" }: { n: number; title: string; id?: string; children: ReactNode; className?: string }) {
  const code = `JCE-SP-${String(n).padStart(2, "0")}`;
  return (
    <section id={id} aria-label={title} className="mx-auto max-w-7xl px-3 py-5 sm:px-8 sm:py-8">
      <div className="sheetframe bg-surface">
        <div className={`px-5 pb-10 pt-10 sm:px-12 sm:pt-14 lg:px-16 ${className}`}>{children}</div>
        <dl className="titlestrip" aria-hidden="true">
          <div><dt>Sheet</dt><dd>{code}</dd></div>
          <div className="grow-[3]"><dt>Title</dt><dd>{title}</dd></div>
          <div className="hidden sm:block"><dt>Status</dt><dd>Preliminary</dd></div>
          <div className="hidden md:block"><dt>Checked</dt><dd>&nbsp;</dd></div>
          <div><dt>Of</dt><dd>{n} / {TOTAL}</dd></div>
        </dl>
      </div>
    </section>
  );
}
export const Mark = ({ children }: { children: ReactNode }) => <p className="h-eyebrow flex items-center gap-3"><span className="inline-block h-px w-8 bg-brand" aria-hidden />{children}</p>;
