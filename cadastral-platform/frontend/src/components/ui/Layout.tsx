import type { ReactNode } from "react";
export const Section = ({ eyebrow, title, note, children, id }: { eyebrow?: string; title: string; note?: string; children: ReactNode; id?: string }) => (
  <section id={id} aria-labelledby={id ? id + "-h" : undefined}>
    {eyebrow && <p className="h-eyebrow">{eyebrow}</p>}
    <h2 id={id ? id + "-h" : undefined} className="mt-2 font-display text-2xl font-medium sm:text-3xl">{title}</h2>
    {note && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{note}</p>}
    <div className="mt-6">{children}</div>
  </section>
);
export const PageHead = ({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) => (
  <div className="relative border-b border-ink/15">
    <div className="grid-paper absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" aria-hidden />
    <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-14 sm:px-8 lg:pb-16 lg:pt-20">
      <p className="h-eyebrow">{eyebrow}</p>
      <h1 className="h-display mt-4 max-w-4xl text-[clamp(2.2rem,4.6vw,4rem)]">{title}</h1>
      {lede && <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{lede}</p>}
      {children}
    </div>
  </div>
);
