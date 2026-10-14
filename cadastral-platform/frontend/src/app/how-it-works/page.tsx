import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/Layout";
import { STAGES } from "@/lib/runs";
export const metadata: Metadata = { title: "How it works | JCE Site Planner", description: "From a lot to civil plans and application material, stage by stage, and what you receive at the end." };
const W = "mx-auto max-w-7xl px-4 sm:px-8";
const GET: [string, string][] = [
  ["Constraints screening", "Flood, bushfire, heritage and other mapped layers, each marked affected, no overlap found, or not checked."],
  ["Cited requirements", "Setbacks and engineering values from council documents, each with document, version, page and quote. Anything else is Unresolved."],
  ["Civil plan set", "Twelve sheets as PDF and DXF: cover, existing and proposed site, earthworks, stormwater, water and sewer, driveway and crossover, erosion and sediment control, details and notes."],
  ["Site report", "An A4 PDF with a summary, zoning, constraints in plain English, the cited requirements and the civil page."],
  ["Pathway and compliance", "Exempt, CDC or DA, with a compliance table and a draft Statement of Environmental Effects."],
  ["Application pack", "A zip assembled for the NSW Planning Portal, with an index, checklist and manifest. You or your certifier lodge it."],
  ["3D model", "Orbit the site, walk it in first person, and place store items at their real dimensions."],
];
export default function HowItWorks() {
  return (<>
    <PageHead eyebrow="How it works" title={<>From <span className="accent">lot</span> to lodgement material, in six stages.</>} lede="You choose the lot and what is being built. The platform runs the stages below in order. Each stage uses public data or cited council documents, and shows what it could not find." />
    <section className={`${W} py-16 lg:py-24`} aria-labelledby="stages">
      <h2 id="stages" className="sr-only">Stages</h2>
      <ol className="border-t border-ink/30">{STAGES.map((s) => (
        <li key={s.key} className="grid gap-3 border-b border-ink/20 py-7 md:grid-cols-[5rem_1fr_1.2fr] md:items-baseline">
          <span className="font-mono text-2xl text-gold">{s.key}</span><h3 className="font-display text-2xl font-medium">{s.title}</h3><p className="max-w-xl text-[15px] leading-relaxed text-muted">{s.detail}</p>
        </li>))}</ol>
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted">Plans are released only after you record nine acknowledgements about the limits of the outputs. If a stage fails, the stages that finished keep their results and the failed one says why.</p>
    </section>
    <section className="border-y border-ink/20 bg-surface py-16 lg:py-24"><div className={W}>
      <p className="h-eyebrow">What you receive</p><h2 className="h-display mt-4 max-w-3xl text-[clamp(2rem,4vw,3.2rem)]">Seven outputs for one lot.</h2>
      <dl className="titleblock mt-10 sm:grid-cols-2 lg:grid-cols-3 [&>div]:border-b">{GET.map(([t, d], i) => <div key={t}><dt className="font-mono text-xs text-gold">0{i + 1}</dt><dd className="mt-2 font-display text-xl font-medium">{t}</dd><dd className="mt-2 text-sm leading-relaxed text-muted">{d}</dd></div>)}</dl>
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted">Every output is an indicative draft. Not every output is available through the web app yet; the application shows which ones have been produced for your project.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link href="/projects/new" className="btn-primary">Start free trial</Link><Link href="/limits" className="btn-ghost">What it does not know</Link></div>
    </div></section>
  </>);
}
