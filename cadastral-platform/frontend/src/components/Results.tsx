import type { ProjectResults } from "@/lib/api";
import { Unresolved } from "@/components/ui/Status";
const Sec = ({ t, n, children }: { t: string; n?: string; children: React.ReactNode }) => (<section className="border border-ink/30 bg-surface p-6"><h3 className="font-display text-xl font-medium">{t}</h3>{n && <p className="mt-1 text-xs text-muted">{n}</p>}<div className="mt-4 text-sm">{children}</div></section>);
/** Driveway, services and rainwater tank. Services never read "clear": with no Dial Before You Dig data they are NOT CHECKED. */
export function Results({ r }: { r: ProjectResults }) {
  const noDbyd = r.dbyd_responses === 0;
  return (<div className="grid gap-5 lg:grid-cols-2">
    <Sec t="Driveway and crossover" n="Preliminary screening only, not AS/NZS 2890.1 certification.">
      <p><span className="st-info">{r.driveway.status.replace(/_/g, " ")}</span></p>
      <p className="mt-3">Width {r.driveway.width_m} m, maximum grade {r.driveway.max_grade_pct}%, design vehicle {r.driveway.design_vehicle}</p>
      <ul className="mt-2 list-disc pl-5 text-muted">{r.driveway.notes.map((n) => <li key={n}>{n}</li>)}</ul></Sec>
    <Sec t="Services and Dial Before You Dig" n="Indicative. Obtain current BYDA plans and physically locate services before digging.">
      {noDbyd ? <div className="hatch border border-ink/30 p-3"><span className="st-nc">Not checked</span><p className="mt-2">No Dial Before You Dig responses have been uploaded, so buried services were not checked. This is not a clear result.</p><p className="mt-1 text-muted"><b className="font-medium text-ink">Next step:</b> lodge the enquiry with BYDA, then upload the asset owners&rsquo; responses.</p></div>
        : <ul className="space-y-2">{r.services.map((s) => <li key={s.label} className={`border p-3 ${s.conflict ? "border-danger/50 bg-danger/5" : "border-line"}`}><div className="flex items-center justify-between gap-3"><b>{s.label}</b>{s.conflict ? <span className="st-bad">Conflict</span> : <span className="st-muted">No conflict found</span>}</div><div className="mt-1 text-xs text-muted">{s.detail}</div></li>)}</ul>}
      <p className="mt-3 text-xs text-muted">&ldquo;No conflict found&rdquo; covers only the responses uploaded. Asset owners answer each enquiry; the platform holds no live database of buried services.</p></Sec>
    <Sec t="Rainwater tank sizing" n="Indicative only; not engineering design or certification.">
      <p><b className="font-display text-3xl font-medium text-gold">{r.rwt.tank_volume_l.toLocaleString("en-AU")} L</b> <span className="text-muted">diameter {r.rwt.diameter_m} m, {r.rwt.regime}</span></p><p className="mt-2 text-muted">{r.rwt.note}</p></Sec>
    <Sec t="Earthworks, stormwater and connections" n="Cut and fill, stormwater, water and sewer connection layouts.">
      <Unresolved reason="Earthworks volumes use a 5 m public terrain grid, which is too coarse for cut and fill on a small lot." next="Upload survey data (DXF, LandXML, CSV or LAS) to replace the public terrain." /></Sec>
  </div>);
}
