import { NorthArrow } from "@/components/home/AppWindow";
/** Provider-agnostic lot outline (brief decision 11 is open). Draws the boundary ring (local metres) as plain SVG, so no basemap licence is involved.
 *  When `schematic` is true the ring is placeholder geometry and is labelled as such. */
export function LotMap({ ring, schematic = false, label }: { ring: [number, number][]; schematic?: boolean; label: string }) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1, h = maxY - minY || 1, pad = Math.max(w, h) * 0.18, d = ring.map(([x, y], i) => `${i ? "L" : "M"}${(x - minX + pad).toFixed(2)} ${(maxY - y + pad).toFixed(2)}`).join(" ") + "Z";
  return (
    <figure className="m-0">
      <div className="grid-paper relative border border-ink/30 bg-scene">
        <svg viewBox={`0 0 ${w + pad * 2} ${h + pad * 2}`} role="img" aria-label={label} className="block h-auto max-h-80 w-full"><path d={d} className="fill-brand/15 stroke-ink" strokeWidth={Math.max(w, h) / 120} vectorEffect="non-scaling-stroke" /></svg>
        <NorthArrow className="absolute right-3 top-3 h-12 w-9" />
        {schematic && <span className="st-warn absolute bottom-3 left-3 bg-surface">Schematic outline</span>}
      </div>
      <figcaption className="mt-2 font-mono text-[10.5px] leading-snug text-muted">Indicative, not a survey. An identification survey from a registered surveyor is required before relying on any boundary.</figcaption>
    </figure>
  );
}
