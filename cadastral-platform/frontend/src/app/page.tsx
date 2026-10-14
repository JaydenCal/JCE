import Link from "next/link";
import type { ReactNode } from "react";
import { AppWindow, NorthArrow, ScaleBar } from "@/components/home/AppWindow";
import { STEPS } from "@/components/home/data";
import { Pipeline } from "@/components/home/Pipeline";
import { CAPTION } from "@/components/home/data";
import { PlanShowcase } from "@/components/home/PlanShowcase";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
import { FAQS } from "@/components/home/faqs";

const W = "mx-auto max-w-7xl px-4 sm:px-8";
const Eyebrow = ({ children }: { children: ReactNode }) => <p className="h-eyebrow">{children}</p>;
const Rule = () => <div className={W}><div className="ticks" aria-hidden /></div>;
export default function Home() {
  return (<>
    {/* HERO */}
    <section className="relative overflow-hidden">
      <div className="grid-paper absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
      <div className={`${W} relative grid items-center gap-12 pb-16 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pb-20 lg:pt-20`}>
        <div className="rise">
          <Eyebrow>The full package &middot; NSW first</Eyebrow>
          <h1 className="h-display mt-5 text-[clamp(2.4rem,4.6vw,4.4rem)]">Civil plans and DA/CDC applications, in <span className="accent">one</span> package.</h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">Start from the lot. JCE Site Planner assesses the site and its constraints, works out the approval pathway, draws the civil plans, checks the controls with cited sources and assembles the application pack, for dwellings, granny flats and sheds. Some parts are still in development and are labelled that way.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/projects/new" className="btn-primary !px-6 !py-3">Start free trial</Link>
            <Link href="/example-output" className="btn-ghost !px-6 !py-3">See example output</Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted"><span>Indicative outputs, every value cited.</span>
            <EngineerEnquiryButton className="font-medium text-gold underline decoration-brand/50 underline-offset-4 hover:decoration-brand">Talk to an engineer &rarr;</EngineerEnquiryButton></div>
          <div className="mt-10 flex items-end gap-5 text-muted" aria-hidden><NorthArrow className="h-14 w-11" /><div><ScaleBar /><p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest">Scale 1:200 @ A3</p></div></div>
        </div>
        <div className="relative rise [animation-delay:.12s]">
          <AppWindow title="Civil plan"><div className="bg-scene p-2.5 sm:p-3"><img src="/samples/gunnedah-plan-crop.webp" alt="Plan generated for Lot 2 DP227508, Gunnedah, showing lot boundary, building envelope, setbacks, driveway crossover and swept path" width={1500} height={1370} className="block h-auto w-full rounded-sm border border-line bg-white" /><p className="mt-2 text-right font-mono text-[10px] leading-snug text-muted">{CAPTION}</p></div></AppWindow>
          <div className="absolute -bottom-8 -left-3 hidden w-[46%] sm:block lg:-left-10"><AppWindow title="3D walk-through" className="shadow-paper"><img src="/samples/viewer-orbit.webp" alt="3D viewer orbit view of a lot with dwelling" width={1000} height={620} className="block h-auto w-full" /></AppWindow></div>
        </div>
      </div>
      {/* hero timeline */}
      <div className={`${W} relative pb-10`}>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-ink/30 pt-6 sm:grid-cols-3 lg:grid-cols-7">
          {STEPS.map((s) => <li key={s.n} className="relative"><span className="absolute -top-[29px] left-0 h-2.5 w-2.5 rounded-full border border-ink bg-bg" aria-hidden /><span className="font-mono text-xs text-gold">{s.n}</span><p className="mt-1 font-display text-lg font-medium leading-tight">{s.t}</p></li>)}
        </ol>
      </div>
    </section>

    {/* FACTS */}
    <section className={`${W} py-6`} aria-label="At a glance">
      <dl className="titleblock grid-cols-2 lg:grid-cols-4 [&>div]:border-b lg:[&>div]:border-b-0 lg:[&>div:not(:last-child)]:border-r [&>div:nth-child(odd)]:border-r lg:[&>div:nth-child(odd)]:border-r">
        {[["Package", "Civil plans + DA/CDC"], ["Coverage", "NSW first"], ["Export", "DXF + PDF"], ["Every value", "Cited or unresolved"]].map(([k, v]) => <div key={k}><dt className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">{k}</dt><dd className="mt-1.5 break-words font-display text-lg font-medium sm:text-2xl">{v}</dd></div>)}
      </dl>
    </section>

    {/* HOW IT WORKS */}
    <section id="how" className={`${W} py-20 lg:py-28`}>
      <Eyebrow>How it works</Eyebrow>
      <h2 className="h-display mt-4 max-w-3xl text-[clamp(2.2rem,4.6vw,3.8rem)]">The <span className="accent">full package</span>, from lot to lodgement.</h2>
      <div className="mt-12"><Pipeline /></div>
      <p className="mt-6 max-w-3xl font-mono text-[11px] leading-relaxed text-muted">Items marked In development are being built and are not yet in the product. Approval pathways must be verified with the council or a certifier.</p>
    </section>
    <Rule />

    {/* CIVIL PLANS */}
    <section id="plans" className={`${W} py-20 lg:py-28`}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
        <div><Eyebrow>Civil plans</Eyebrow><h2 className="h-display mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)]">A real <span className="accent">plan</span>, drawn from the lot.</h2></div>
        <p className="max-w-xl text-[17px] leading-relaxed text-muted lg:justify-self-end">Lot boundary, building envelope, setbacks, driveway crossover and swept path and a title block on one A3 sheet you can zoom and export as DXF. Levels with floor level above flood level, the ESCP and stormwater sheets are in development.</p>
      </div>
      <div className="mt-10"><PlanShowcase /></div>
      <div className="mt-8 flex flex-col items-start justify-between gap-5 border border-ink/40 bg-surface p-6 sm:flex-row sm:items-center">
        <div><h3 className="font-display text-2xl font-medium">Need an engineer to certify or design it?</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">JCE Infrastructure is our industry partner. Everything this tool produces is indicative until an engineer is engaged to design, check and certify the works.</p></div>
        <EngineerEnquiryButton className={`${ENGINEER_BTN} shrink-0 !px-6 !py-3`}>Talk to an engineer</EngineerEnquiryButton>
      </div>
    </section>
    <Rule />

    {/* 3D */}
    <section className={`${W} py-20 lg:py-28`}>
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)]">
        <div><Eyebrow>3D walk-through</Eyebrow><h2 className="h-display mt-4 text-[clamp(2.2rem,4.2vw,3.4rem)]">Orbit it. Then <span className="accent">walk</span> it.</h2>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">Review the lot from above, switch on cut and fill, then drop into first person to check sightlines, clearances and driveway grade. Furnish rooms from store products with real dimensions.</p>
          <Link href="/viewer-demo" className="btn-primary mt-7">Open the live 3D demo</Link></div>
        <div className="grid gap-4 sm:grid-cols-2"><AppWindow title="Orbit"><img src="/samples/viewer-orbit.webp" alt="Orbit view in the 3D viewer" width={1000} height={620} loading="lazy" className="block h-auto w-full" /></AppWindow>
          <AppWindow title="First person" className="sm:mt-10"><img src="/samples/viewer-walk.webp" alt="First-person view in the 3D viewer" width={1000} height={620} loading="lazy" className="block h-auto w-full" /></AppWindow></div>
      </div>
    </section>

    {/* COUNCILS */}
    <section id="councils" className={`${W} py-20 lg:py-28`}>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div><Eyebrow>Councils and overseas &middot; In development</Eyebrow><h2 className="h-display mt-4 text-[clamp(2.2rem,4.2vw,3.4rem)]">Bring your own <span className="accent">municipality</span>.</h2></div>
        <p className="max-w-xl text-[17px] leading-relaxed text-muted">Custom municipalities are in development: load your council's engineering documents, set your units and design standards, and the same plans and compliance table follow your rules. Get in touch if you are a council or work outside NSW and QLD.</p>
      </div>
    </section>
    <Rule />

    {/* HONEST */}
    <section id="honest" className="border-y border-ink/20 bg-surface py-20 lg:py-28">
      <div className={W}>
        <Eyebrow>Honest by design</Eyebrow>
        <h2 className="h-display mt-4 max-w-3xl text-[clamp(2.2rem,4.6vw,3.8rem)]">It tells you what it <span className="accent">does not</span> know.</h2>
        <div className="titleblock mt-12 sm:grid-cols-2 lg:grid-cols-4 [&>div]:border-b lg:[&>div:not(:last-child)]:border-r lg:[&>div]:border-b-0 sm:[&>div:nth-child(odd)]:border-r lg:[&>div:nth-child(even)]:border-r">
          {[["Every value cited", "Setbacks and controls link back to the instrument and clause they came from, so you can check the source."],
            ["Unresolved is shown, not guessed", "If a rule cannot be found, the report says so and lists the next step, such as obtaining the s10.7 planning certificate."],
            ["Verify before excavation", "Service locations are indicative. You acknowledge that BYDA plans and physical location (potholing) come first, every time."],
            ["Indicative only", "Not a survey, not engineering design, not planning advice. Export is gated behind nine plain-language acknowledgements."]].map(([t, d], i) => <div key={t}><span className="font-mono text-xs text-gold">0{i + 1}</span><h3 className="mt-3 font-display text-xl font-medium">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{d}</p></div>)}
        </div>
        <figure className="mt-10 max-w-3xl border-l-2 border-brand pl-5"><blockquote className="font-mono text-[13px] leading-relaxed">&ldquo;TO BE CONFIRMED. Obtain the s10.7 planning certificate (EP&amp;A Act) for the lot and confirm with the council.&rdquo;</blockquote><figcaption className="mt-2 font-mono text-[10.5px] text-muted">Wording from a real generated report, where a rule could not be resolved.</figcaption></figure>
      </div>
    </section>

    {/* PRICING */}
    <section id="pricing" className={`${W} py-20 lg:py-28`}>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div><Eyebrow>Pricing</Eyebrow><h2 className="h-display mt-4 text-[clamp(2.2rem,4.2vw,3.4rem)]">Pricing <span className="accent">coming soon</span>.</h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-muted">We are finalising plans. Start a free trial now and run your first lot end to end. No prices are published yet.</p></div>
        <div className="titleblock"><div className="flex flex-wrap items-center justify-between gap-4 !p-8"><div><p className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">Plans</p><p className="mt-1 font-display text-3xl font-medium">Coming soon</p></div><Link href="/projects/new" className="btn-primary">Start free trial</Link></div></div>
      </div>
    </section>

    {/* FAQ */}
    <section id="faq" className={`${W} pb-20 lg:pb-28`}>
      <div className="grid gap-10 lg:grid-cols-[.8fr_1.4fr]"><div><Eyebrow>FAQ</Eyebrow><h2 className="h-display mt-4 text-[clamp(2.2rem,4.2vw,3.4rem)]">Questions, <span className="accent">answered</span>.</h2></div>
        <div className="border-t border-ink/30">{FAQS.slice(0, 6).map(([q, a]) => <details key={q} className="group border-b border-ink/20 py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-xl font-medium [&::-webkit-details-marker]:hidden">{q}<span aria-hidden className="font-mono text-lg text-gold transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{a}</p></details>)}</div></div>
    </section>

    {/* CTA */}
    <section className={`${W}`}><div className="grid-paper flex flex-col items-start justify-between gap-6 border border-ink/40 bg-surface p-8 sm:flex-row sm:items-center sm:p-12">
      <h2 className="h-display max-w-xl text-[clamp(2rem,3.8vw,3rem)]">Take your next lot from site to <span className="accent">lodgement</span>.</h2>
      <div className="flex flex-wrap gap-3"><Link href="/projects/new" className="btn-primary !px-6 !py-3">Start free trial</Link><EngineerEnquiryButton className={`${ENGINEER_BTN} !px-6 !py-3`}>Talk to an engineer</EngineerEnquiryButton></div></div></section>
  </>);
}
