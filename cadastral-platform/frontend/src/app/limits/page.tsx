import type { Metadata } from "next";
import { PageHead } from "@/components/ui/Layout";
import { ComplianceTag, DraftBadge, LayerStatus, PathwayTag, RequirementStatusTag } from "@/components/ui/Status";
export const metadata: Metadata = { title: "What it does not know | JCE Site Planner", description: "The limits of the platform: data sources and dates, coverage, unresolved values, and who must check what." };
const W = "mx-auto max-w-7xl px-4 sm:px-8";
const NOT: [string, string][] = [
  ["Not a survey", "Boundaries come from the public cadastre. An identification survey from a registered surveyor is required before relying on them."],
  ["Not engineering design", "Earthworks, retaining walls, crossovers, stormwater and tank sizes are indicative. A registered engineer must design, check and certify the works."],
  ["Not planning advice", "Pathways and compliance come from cited documents and can be wrong or out of date. Confirm with the council or a certifier."],
  ["Not a BASIX certificate or flood certificate", "Rainwater tank sizing is indicative. BASIX and flood certificates are separate."],
  ["Does not lodge for you", "It assembles an application pack. You, your planner or your certifier lodge it."],
  ["No live map of buried services", "Asset owners answer each Dial Before You Dig enquiry. You upload their responses, then potholing confirms what is there."],
];
const DATA: [string, string][] = [
  ["Cadastre, address, zoning, roads", "Public NSW spatial services, checked on 12/10/2026. The platform shows the data date with each result."],
  ["Terrain", "A public 5 m elevation grid. It is too coarse for cut and fill on a small lot, so every sheet that uses it says \"indicative, detail survey required\". Survey data will replace it."],
  ["Aerial imagery", "Taken from public imagery whose capture date can be many years old. One cached image of the Gunnedah sample lot was captured on 18/10/2011. The licence terms are being verified."],
  ["Constraints", "16 of 18 NSW layer types are live. Contaminated land and transport corridors have no public layer. Queensland has none yet."],
  ["Council rules", "Loaded for Gunnedah only. Other council areas return mostly Unresolved until their documents are loaded."],
  ["Buffer distances", "Bushfire 100 m, coastal 100 m, riparian 40 m and transport corridor 60 m are screening distances set in the platform. They are not legal thresholds."],
];
const WHO: [string, string][] = [["Registered surveyor", "Boundaries, levels and contours, and the survey that replaces public terrain."], ["Registered engineer", "Earthworks, retaining walls, crossover, stormwater and the works shown on the plans."], ["Planner or certifier", "Zoning, controls, the approval pathway, the compliance table and the Statement of Environmental Effects."]];
export default function Limits() {
  return (<>
    <PageHead eyebrow="What it does not know" title={<>It tells you what it <span className="accent">does not</span> know.</>} lede="Every output is an indicative draft for a qualified person to check. This page lists the limits, the data behind the results, and how gaps are shown." />
    <section className={`${W} py-16 lg:py-24`}>
      <p className="h-eyebrow">What it is not</p>
      <dl className="titleblock mt-6 sm:grid-cols-2 lg:grid-cols-3 [&>div]:border-b">{NOT.map(([t, d]) => <div key={t}><dt className="font-display text-xl font-medium">{t}</dt><dd className="mt-2 text-sm leading-relaxed text-muted">{d}</dd></div>)}</dl>
    </section>
    <section className="border-y border-ink/20 bg-surface py-16 lg:py-24"><div className={W}>
      <p className="h-eyebrow">How gaps are shown</p><h2 className="h-display mt-4 max-w-3xl text-[clamp(2rem,4vw,3.2rem)]">Missing is shown as missing.</h2>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div><h3 className="font-display text-xl font-medium">Constraint layers</h3><ul className="mt-4 space-y-3 text-sm">
          <li className="flex flex-wrap items-center gap-3"><LayerStatus s="affected" /><span className="text-muted">The mapped layer overlaps the lot.</span></li>
          <li className="flex flex-wrap items-center gap-3"><LayerStatus s="not_affected" /><span className="text-muted">The mapped layer does not touch the lot. This is not a clearance.</span></li>
          <li className="flex flex-wrap items-center gap-3"><LayerStatus s="not_checked" /><span className="text-muted">The source could not be queried, so nothing is said either way.</span></li></ul></div>
        <div><h3 className="font-display text-xl font-medium">Requirements and compliance</h3><ul className="mt-4 space-y-3 text-sm">
          <li className="flex flex-wrap items-center gap-3"><RequirementStatusTag s="resolved" /><span className="text-muted">A source you can open: document, version, page, quote.</span></li>
          <li className="flex flex-wrap items-center gap-3"><RequirementStatusTag s="user_confirmed" /><span className="text-muted">A value you entered. It is not checked against a source.</span></li>
          <li className="flex flex-wrap items-center gap-3"><RequirementStatusTag s="unresolved" /><span className="text-muted">No cited source found. The reason and next step are shown.</span></li>
          <li className="flex flex-wrap items-center gap-3"><ComplianceTag s="PASS" /><ComplianceTag s="FAIL" /><span className="text-muted">Only from a number compared with a cited value.</span></li>
          <li className="flex flex-wrap items-center gap-3"><PathwayTag s="UNRESOLVED" /><span className="text-muted">A pathway criterion could not be resolved.</span></li>
          <li className="flex flex-wrap items-center gap-3"><DraftBadge /><span className="text-muted">Shown on every result and next to every download.</span></li></ul></div>
      </div></div></section>
    <section className={`${W} py-16 lg:py-24`}>
      <p className="h-eyebrow">Data and coverage</p>
      <dl className="mt-6 divide-y divide-line border-y border-ink/30">{DATA.map(([t, d]) => <div key={t} className="grid gap-2 py-5 md:grid-cols-[18rem_1fr]"><dt className="font-display text-lg font-medium">{t}</dt><dd className="max-w-2xl text-[15px] leading-relaxed text-muted">{d}</dd></div>)}</dl>
      <p className="h-eyebrow mt-16">Who must check what</p>
      <dl className="titleblock mt-6 md:grid-cols-3 [&>div]:border-b">{WHO.map(([t, d]) => <div key={t}><dt className="font-display text-xl font-medium">{t}</dt><dd className="mt-2 text-sm leading-relaxed text-muted">{d}</dd></div>)}</dl>
    </section>
  </>);
}
