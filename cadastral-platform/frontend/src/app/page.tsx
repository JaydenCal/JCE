import Link from "next/link";
import { AppWindow } from "@/components/home/AppWindow";
import { CAPTION, STEPS } from "@/components/home/data";
import { Pipeline } from "@/components/home/Pipeline";
import { PlanShowcase } from "@/components/home/PlanShowcase";
import { HeroPlan } from "@/components/home/HeroPlan";
import { Mark, Sheet } from "@/components/home/Sheet";
import { Evidence } from "@/components/home/Evidence";
import { Roles } from "@/components/home/Roles";
import { Compare } from "@/components/home/Compare";
import { FAQS } from "@/components/home/faqs";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import EngineerEnquiryForm from "@/components/enquiry/EngineerEnquiryForm";
import { ENQUIRY_CSS } from "@/components/enquiry/styles";
import { ENGINEER_BTN } from "@/components/styles";

const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="h-display mt-5 max-w-3xl text-[clamp(2rem,4.2vw,3.5rem)]">{children}</h2>;
export default function Home() {
  return (<>
    {/* 01 COVER */}
    <Sheet n={1} title="Cover, index and locality" className="!pt-8 sm:!pt-10">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <div className="rise">
          <Mark>The full package &middot; NSW first</Mark>
          <h1 className="h-display mt-5 text-[clamp(2.4rem,4.6vw,4.4rem)]">Civil plans and DA/CDC applications, <span className="accent">drawn</span> from the lot.</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">Start from the address. JCE Site Planner screens the site, reads the council&rsquo;s own documents, works out the approval pathway and draws the civil plans. Every value carries its source. Anything it cannot find is left on the sheet as <b className="font-medium text-ink">unresolved</b>, not guessed.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3"><Link href="/projects/new" className="btn-primary !px-6 !py-3">Start free trial</Link><Link href="/example-output" className="btn-ghost !px-6 !py-3">See example output</Link></div>
          <p className="mt-5 text-sm text-muted">Indicative drafts for a surveyor, engineer or planner to check. <EngineerEnquiryButton className="font-medium text-gold underline decoration-brand/50 underline-offset-4 hover:decoration-brand">Talk to an engineer &rarr;</EngineerEnquiryButton></p>
        </div>
        <div className="rise [animation-delay:.12s]"><HeroPlan /></div>
      </div>
      <div className="mt-12 border-t border-ink/40 pt-6">
        <p className="font-mono text-[10.5px] uppercase tracking-[.2em] text-muted">Sheet index</p>
        <ol className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">{STEPS.map((s, i) => <li key={s.n}><a href={["#process", "#process", "#plans", "#viewer", "#evidence", "#process", "#contact"][i]} className="group flex items-baseline gap-3 border-b border-dotted border-ink/30 py-2 hover:text-gold"><span className="font-mono text-xs text-gold">C{i}00</span><span className="font-display text-[15px] font-medium leading-tight">{s.t}</span></a></li>)}</ol>
      </div>
    </Sheet>

    {/* 02 PROBLEM */}
    <Sheet n={2} title="Problem statement">
      <Mark>The problem</Mark><H2>A site package is <span className="accent">slow</span> to prepare and easy to get wrong.</H2>
      <div className="mt-10 grid gap-0 border-y border-ink/30 md:grid-cols-3 md:divide-x md:divide-ink/25 [&>div]:p-6 [&>div:first-child]:pl-0">
        {[["Scattered", "Zoning, overlays, council controls and engineering standards sit in different places and formats."], ["Unsourced", "A setback copied into a drawing rarely says which document, version and page it came from."], ["Found late", "A missing rule or an unchecked layer is usually discovered at assessment, after the drawings are done."]].map(([t, d], i) => <div key={t}><span className="font-mono text-xs text-gold">Note {i + 1}</span><h3 className="mt-3 font-display text-2xl font-medium">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{d}</p></div>)}
      </div>
    </Sheet>

    {/* 03 PROCESS */}
    <Sheet n={3} title="Process: lot to lodgement" id="process">
      <Mark>How it works</Mark><H2>From lot to lodgement, <span className="accent">one run</span>.</H2>
      <div className="mt-10"><Pipeline /></div>
      <p className="mt-6 max-w-3xl font-mono text-[11px] leading-relaxed text-muted">Items marked In development are being built and are not yet in the product. Approval pathways must be verified with the council or a certifier. <Link href="/how-it-works" className="text-gold underline underline-offset-4">The stages in detail</Link></p>
    </Sheet>

    {/* 04 EVIDENCE */}
    <Sheet n={4} title="Cited requirements" id="evidence">
      <Mark>Every value, with its source</Mark><H2>Pick a control. See <span className="accent">where it came from</span>.</H2>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">Each requirement links to the document, version, page and quote behind it. With no source, no number is shown. The line is marked unresolved and says what to do next.</p>
      <div className="mt-10"><Evidence /></div>
    </Sheet>

    {/* 05 SCHEDULE */}
    <Sheet n={5} title="Schedule of approaches">
      <Mark>Compared</Mark><H2>Not another <span className="accent">chatbot</span>.</H2>
      <div className="mt-8"><Compare /></div>
    </Sheet>

    {/* 06 ISSUED TO */}
    <Sheet n={6} title="Issued to" id="roles">
      <Mark>Who it is for</Mark><H2>Issued to <span className="accent">you</span>.</H2>
      <div className="mt-8"><Roles /></div>
    </Sheet>

    {/* 07 PLANS */}
    <Sheet n={7} title="Civil plan set" id="plans">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-end"><div><Mark>Civil plans</Mark><H2>A real <span className="accent">plan</span> set, twelve sheets.</H2></div>
        <p className="max-w-xl text-[17px] leading-relaxed text-muted lg:justify-self-end">Cover, existing and proposed site, earthworks, stormwater, water and sewer, driveway and crossover, erosion and sediment control, details and notes. PDF and DXF. Every sheet reads preliminary, with the checked and approved boxes left blank on purpose.</p></div>
      <div className="mt-10"><PlanShowcase /></div>
      <div className="mt-8 flex flex-col items-start justify-between gap-5 border border-ink/40 p-6 sm:flex-row sm:items-center"><div><h3 className="font-display text-2xl font-medium">Need an engineer to design, check or certify it?</h3><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">JCE Infrastructure is our industry partner. Everything this tool produces is indicative until an engineer is engaged.</p></div><EngineerEnquiryButton className={`${ENGINEER_BTN} shrink-0 !px-6 !py-3`}>Talk to an engineer</EngineerEnquiryButton></div>
    </Sheet>

    {/* 08 3D */}
    <Sheet n={8} title="3D model" id="viewer">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.4fr)]">
        <div><Mark>3D model</Mark><H2>Orbit it. Then <span className="accent">walk</span> it.</H2>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">Review the lot from above, switch on cut and fill, then drop into first person to check sightlines, clearances and driveway grade. Place store items at their real size.</p>
          <Link href="/viewer-demo" className="btn-primary mt-7">Open the live 3D demo</Link></div>
        <div className="grid gap-4 sm:grid-cols-2"><AppWindow title="Orbit"><img src="/samples/viewer-orbit.webp" alt="Orbit view in the 3D viewer" width={1000} height={620} loading="lazy" className="block h-auto w-full" /></AppWindow>
          <AppWindow title="First person" className="sm:mt-10"><img src="/samples/viewer-walk.webp" alt="First-person view in the 3D viewer" width={1000} height={620} loading="lazy" className="block h-auto w-full" /></AppWindow></div>
      </div>
    </Sheet>

    {/* 09 LIMITS */}
    <Sheet n={9} title="Limits and general conditions" id="honest">
      <Mark>Honest by design</Mark><H2>It tells you what it <span className="accent">does not</span> know.</H2>
      <div className="mt-10 grid border-y border-ink/30 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-ink/25 [&>div]:p-6 [&>div:first-child]:pl-0">
        {[["Every value cited", "Setbacks and controls link to the document, version and page they came from."], ["Unresolved, not guessed", "If a rule cannot be found it is listed with the next step, such as obtaining the s10.7 planning certificate."], ["Not checked is not clear", "A layer that could not be queried says so. It is never shown as clear."], ["Indicative only", "Not a survey, not engineering design, not planning advice. Downloads are held until nine acknowledgements are recorded."]].map(([t, d], i) => <div key={t}><span className="font-mono text-xs text-gold">0{i + 1}</span><h3 className="mt-3 font-display text-xl font-medium">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{d}</p></div>)}
      </div>
      <p className="mt-6"><Link href="/limits" className="font-medium text-gold underline underline-offset-4">Data sources, coverage and who must check what</Link></p>
    </Sheet>

    {/* 10 PRICING + COUNCILS */}
    <Sheet n={10} title="Pricing and custom municipality" id="pricing">
      <div className="grid gap-10 lg:grid-cols-2 lg:divide-x lg:divide-ink/25">
        <div><Mark>Pricing</Mark><H2>Pricing <span className="accent">coming soon</span>.</H2><p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">We are finalising plans. No prices are published and nothing is charged. Run your first lot end to end.</p><Link href="/projects/new" className="btn-primary mt-6">Start free trial</Link></div>
        <div className="lg:pl-10"><Mark>Custom municipality &middot; In development</Mark><H2>Your <span className="accent">council</span>, your rules.</H2><p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">Load your engineering documents, units and design standards, and the same plans and compliance table follow them.</p><Link href="/custom-municipality" className="btn-ghost mt-6">Read more</Link></div>
      </div>
    </Sheet>

    {/* 11 GENERAL NOTES */}
    <Sheet n={11} title="General notes" id="faq">
      <div className="grid gap-10 lg:grid-cols-[.7fr_1.4fr]"><div><Mark>FAQ</Mark><H2>General <span className="accent">notes</span>.</H2><p className="mt-4"><Link href="/faq" className="font-medium text-gold underline underline-offset-4">All notes</Link></p></div>
        <ol className="border-t border-ink/40">{FAQS.slice(0, 6).map(([q, a], i) => <li key={q}><details className="group border-b border-ink/20 py-4"><summary className="flex cursor-pointer list-none items-baseline gap-4 font-display text-xl font-medium [&::-webkit-details-marker]:hidden"><span className="font-mono text-xs text-gold">{i + 1}.</span><span className="flex-1">{q}</span><span aria-hidden className="font-mono text-lg text-gold transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-2xl pl-8 text-[15px] leading-relaxed text-muted">{a}</p></details></li>)}</ol></div>
    </Sheet>

    {/* 12 CONTACT */}
    <Sheet n={12} title="Enquiry to JCE Infrastructure" id="contact">
      <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]"><div><Mark>Contact</Mark><H2>Talk to a civil <span className="accent">engineer</span>.</H2><p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">JCE Infrastructure is our industry partner. Ask about certification, design, a custom municipality, or anything this page does not answer. No response time is promised through this form.</p></div>
        <div className="enq enq-page !max-w-none !p-0"><style>{ENQUIRY_CSS}</style><div className="enq-card"><EngineerEnquiryForm /></div></div></div>
    </Sheet>
    <p className="sr-only">{CAPTION}</p>
  </>);
}
