import Link from "next/link";
const feats = [
  ["Lot and cadastre", "Pull the lot, boundary, zone and frontage in seconds."],
  ["Setbacks with citations", "Controls extracted from council instruments, each linked to its clause."],
  ["Plan alignment", "Drop in an architect's PDF and see it placed on the lot with a stated error."],
  ["Driveway and crossover", "Screen grades, widths and swept paths before you lodge."],
  ["Services and BYDA", "Spot conflicts between proposed works and known assets."],
  ["DXF and PDF export", "Hand off CAD-ready drawings once every acknowledgement is given."],
];
export default function Home() {
  return (<>
    <section className="relative overflow-hidden py-20 text-center sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 mx-auto h-72 max-w-3xl rounded-full bg-brand/20 blur-3xl" />
      <p className="h-eyebrow">Site planning, automated</p>
      <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">From lot to lodgement-ready plan, in minutes.</h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">JCE Site Planner reads the cadastre and council controls, aligns your plans, and checks driveways, services and rainwater tanks, so you can plan with confidence.</p>
      <div className="mt-9 flex flex-wrap justify-center gap-3"><Link href="/projects" className="btn-primary">Start a project</Link><Link href="/legal/terms" className="btn-ghost">Read the terms</Link></div>
    </section>
    <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {feats.map(([t, d]) => <div key={t} className="card"><div className="mb-4 h-9 w-9 rounded-xl bg-brand-soft" /><h3 className="font-bold">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p></div>)}
    </section>
    <section className="card mt-16 grid gap-6 text-center sm:grid-cols-3">
      {[["NSW + QLD", "Jurisdictions"], ["9", "Safety acknowledgements"], ["DXF + PDF", "Export formats"]].map(([a, b]) => <div key={b}><div className="text-3xl font-extrabold text-brand">{a}</div><div className="text-sm text-muted">{b}</div></div>)}
    </section>
  </>);
}
