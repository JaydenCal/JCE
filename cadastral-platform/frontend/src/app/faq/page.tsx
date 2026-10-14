import type { Metadata } from "next";
import { PageHead } from "@/components/ui/Layout";
import { FAQS } from "@/components/home/faqs";
export const metadata: Metadata = { title: "FAQ | JCE Site Planner", description: "Coverage, limits, uploads, acknowledgements and what unresolved means." };
export default function Faq() {
  return (<>
    <PageHead eyebrow="FAQ" title={<>Questions, <span className="accent">answered</span>.</>} />
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-8 lg:py-24"><div className="border-t border-ink/30">{FAQS.map(([q, a]) => (
      <details key={q} className="group border-b border-ink/20 py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-xl font-medium [&::-webkit-details-marker]:hidden">{q}<span aria-hidden className="font-mono text-lg text-gold transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{a}</p></details>))}</div></section>
  </>);
}
