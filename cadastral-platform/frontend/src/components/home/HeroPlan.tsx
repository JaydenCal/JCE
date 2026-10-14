/** Hero drawing: a site plan that draws itself. Illustrative only. It shows no dimensions on purpose, because real values appear only with a cited source. */
const P = ({ d, c = "", delay = 0, dash }: { d: string; c?: string; delay?: number; dash?: string }) => <path d={d} pathLength={1} className={`${dash ? "lbl" : "draw"} ${c}`} style={{ animationDelay: `${delay}s`, ...(dash ? { strokeDasharray: dash } : {}) }} fill="none" />;
export function HeroPlan() {
  return (
    <figure className="m-0">
      <div className="grid-paper relative border border-ink/40 bg-scene">
        <svg viewBox="0 0 600 440" role="img" aria-label="A site plan drawing itself: lot boundary, setbacks, building envelope, driveway crossover and a road. Illustrative, no dimensions." className="block h-auto w-full">
          {/* road */}
          <rect x="0" y="372" width="600" height="68" className="fill-ink/10" />
          <P d="M0 372H600" c="stroke-ink" delay={0.1} /><P d="M0 440H600" c="stroke-ink/40" delay={0.1} />
          <P d="M0 406H600" c="stroke-ink/40" delay={0.3} dash="14 10" />
          {/* lot boundary */}
          <P d="M70 372 62 52 520 40 538 372Z" c="stroke-ok" delay={0.4} />
          {/* setbacks */}
          <P d="M100 340 96 100 486 92 500 340Z" c="stroke-danger" delay={1.3} dash="8 6" />
          {/* envelope */}
          <path d="M150 300 148 140 440 134 446 300Z" className="env fill-brand/15 stroke-ink" style={{ animationDelay: "2.1s" }} strokeWidth="1.6" />
          <path d="M150 300 148 140 440 134 446 300Z" fill="url(#h)" className="env" style={{ animationDelay: "2.3s" }} />
          <defs><pattern id="h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V8" className="stroke-ink/30" strokeWidth="1" /></pattern></defs>
          {/* driveway + crossover */}
          <P d="M240 300V372M300 300V372" c="stroke-ink" delay={2.8} />
          <P d="M226 372 240 358M314 372 300 358" c="stroke-ink" delay={3.0} />
          <P d="M270 300V372" c="stroke-[#e63be6]" delay={3.1} dash="3 5" />
          {/* dimension ticks, no numbers */}
          <P d="M30 372V340M24 372h12M24 340h12" c="stroke-ink/70" delay={3.3} />
          <P d="M560 372V52M554 372h12M554 52h12" c="stroke-ink/70" delay={3.4} />
          {/* labels */}
          <g className="lbl font-mono" fontSize="11" style={{ animationDelay: "3.5s" }}>
            <text x="156" y="124" className="fill-danger">SETBACK</text><text x="205" y="228" className="fill-ink">ENVELOPE</text>
            <text x="248" y="352" className="fill-ink" fontSize="9">CROSSOVER</text><text x="76" y="64" className="fill-ok">LOT BOUNDARY</text>
          </g>
          {/* honest gap callout */}
          <g className="lbl" style={{ animationDelay: "4s" }}>
            <rect x="372" y="196" width="150" height="46" className="fill-surface stroke-warn" strokeWidth="1.2" /><path d="M372 219 330 200" className="stroke-warn" strokeWidth="1" />
            <text x="382" y="214" className="fill-warn font-mono" fontSize="10" fontWeight="500">UNRESOLVED</text><text x="382" y="230" className="fill-ink font-mono" fontSize="9">MAX HEIGHT: NO SOURCE</text>
          </g>
          {/* north */}
          <g transform="translate(36 34)"><circle r="17" className="stroke-ink/50" fill="none" /><path d="M0-14 6 10 0 5-6 10Z" className="fill-ink" /></g>
        </svg>
      </div>
      <div className="grid grid-cols-[1.4fr_1.6fr_.8fr_.8fr] border border-t-0 border-ink/40 bg-surface font-mono text-[9px] uppercase tracking-wider text-muted max-sm:grid-cols-2">
        <span className="border-r border-ink/30 px-2 py-1.5">Sheet C101 · Proposed site</span><span className="px-2 py-1.5 text-warn max-sm:border-b-0">Preliminary: not for construction</span><span className="border-l border-ink/30 px-2 py-1.5">Checked</span><span className="border-l border-ink/30 px-2 py-1.5">Approved</span>
      </div>
      <figcaption className="mt-2 font-mono text-[10.5px] leading-snug text-muted">Illustration of the kind of sheet the platform produces. It is not a real lot and shows no dimensions.</figcaption>
    </figure>
  );
}
