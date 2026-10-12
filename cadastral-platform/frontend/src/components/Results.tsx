import type { ProjectResults } from "@/lib/api";
const Sec = ({ t, n, children }: { t: string; n?: string; children: React.ReactNode }) => (<section className="card"><h3 className="font-bold">{t}</h3>{n && <p className="mt-1 text-xs text-muted">{n}</p>}<div className="mt-4 text-sm">{children}</div></section>);
export function Results({ r }: { r: ProjectResults }) {
  return (<div className="grid gap-5 lg:grid-cols-2">
    <Sec t="Lot summary" n="Cadastre is indicative, not a survey.">
      <dl className="grid grid-cols-2 gap-3">{[["Lot/plan", r.lot.lotplan], ["Jurisdiction", r.lot.jurisdiction], ["Council", r.lot.lga], ["Zone", r.lot.zone], ["Area", r.lot.area_m2 + " m2"], ["Frontage", r.lot.frontage_m + " m"], ["Road", r.lot.road]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl></Sec>
    <Sec t="Setbacks" n="Extracted automatically. Verify against the current instrument.">
      <ul className="divide-y divide-line">{r.setbacks.map((s) => <li key={s.control} className="flex justify-between gap-4 py-2"><div><div className="font-semibold">{s.control}</div><div className="text-xs text-muted">{s.citation}</div></div><div className="font-bold text-gold">{s.value_m.toFixed(1)} m</div></li>)}</ul></Sec>
    <Sec t="Driveway and crossover" n="Preliminary screening only, not AS/NZS 2890.1 certification.">
      <p><span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold">{r.driveway.status.replace(/_/g, " ")}</span></p>
      <p className="mt-3">Width {r.driveway.width_m} m, max grade {r.driveway.max_grade_pct}%, design vehicle {r.driveway.design_vehicle}</p>
      <ul className="mt-2 list-disc pl-5 text-muted">{r.driveway.notes.map((n) => <li key={n}>{n}</li>)}</ul></Sec>
    <Sec t="Services and DBYD" n="Indicative. Obtain BYDA plans and physically locate services before digging.">
      <ul className="space-y-2">{r.services.map((s) => <li key={s.label} className={`rounded-xl border p-3 ${s.conflict ? "border-danger/50 bg-danger/5" : "border-line"}`}><div className="flex justify-between"><b>{s.label}</b><span className={s.conflict ? "font-bold text-danger" : "text-ok"}>{s.conflict ? "Conflict" : "Clear"}</span></div><div className="text-xs text-muted">{s.detail}</div></li>)}</ul></Sec>
    <Sec t="Rainwater tank sizing" n="Indicative only; not engineering design or certification.">
      <p><b className="text-2xl text-gold">{r.rwt.tank_volume_l.toLocaleString("en-AU")} L</b> <span className="text-muted">dia. {r.rwt.diameter_m} m, {r.rwt.regime}</span></p><p className="mt-2 text-muted">{r.rwt.note}</p></Sec>
  </div>);
}
