"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, type Terms } from "@/lib/api";
import { canAccept, extractKeyRisks, isScrolledToEnd } from "@/lib/terms";
import { Markdown } from "@/components/Markdown";

const setCookie = (v: string) => { document.cookie = `jce_terms=${v}; path=/; max-age=31536000; samesite=lax`; };

function TermsGate() {
  const router = useRouter(), next = useSearchParams().get("next") || "/projects";
  const [t, setT] = useState<Terms | null>(null), [err, setErr] = useState(""), [end, setEnd] = useState(false), [tick, setTick] = useState(false), [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { api.terms().then((x) => { setT(x); if (x.accepted) setCookie(x.terms_version_id); }).catch((e) => setErr(e.message)); }, []);
  const check = useCallback(() => { const el = box.current; if (el) setEnd(isScrolledToEnd(el)); }, []);
  useEffect(() => { if (t) check(); }, [t, check]);
  async function accept() {
    if (!t) return; setBusy(true); setErr("");
    try { await api.accept(t, end); setCookie(t.terms_version_id); router.push(next); }
    catch (e) { if (e instanceof ApiError && e.code === "TERMS_VERSION_STALE") { setErr("The Terms were updated. Please read the new version."); setEnd(false); setTick(false); setT(await api.terms()); } else setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!t) return <div className="py-16">{err ? <p className="text-danger">{err}</p> : "Loading Terms..."}</div>;
  const { intro, items, rest } = extractKeyRisks(t.body_markdown);
  return (<div className="mx-auto max-w-3xl py-12">
    <p className="h-eyebrow">Legal</p><h1 className="mt-2 text-3xl font-extrabold">Terms of Use <span className="text-lg font-medium text-muted">v{t.version_label}</span></h1>
    {t.accepted ? <p className="mt-4 rounded-xl bg-brand-soft p-4 text-sm">You have accepted this version. <a className="underline" href={next}>Continue</a></p>
      : <p className="mt-4 text-sm text-muted">Please read the Key Risks Summary and scroll through the full Terms to the end. If we publish a new version you will be asked to accept it again.</p>}
    {items.length > 0 && <section aria-label="Key Risks Summary" className="mt-6 rounded-xl2 border-2 border-warn/60 bg-warn/5 p-6">
      <h2 className="font-bold text-warn">Key Risks Summary</h2><p className="mt-1 text-sm text-muted">{intro}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{items.map((x, i) => <li key={i} dangerouslySetInnerHTML={{ __html: x.replace(/[<>&]/g, "").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>") }} />)}</ol></section>}
    <div ref={box} onScroll={check} tabIndex={0} aria-label="Full Terms" className="card mt-6 h-[28rem] overflow-y-auto"><Markdown md={rest} /></div>
    <p className="mt-2 text-xs text-muted" aria-live="polite">{end ? "You have reached the end of the Terms." : "Scroll to the end to enable acceptance."}</p>
    <label className={`mt-5 flex items-start gap-3 text-sm ${end ? "" : "opacity-50"}`}><input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" disabled={!end} checked={tick} onChange={(e) => setTick(e.target.checked)} />I have read and agree to these Terms of Use and the Key Risks Summary.</label>
    {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
    <button className="btn-primary mt-5" disabled={!canAccept({ scrolledToEnd: end, ticked: tick, busy })} onClick={accept}>Accept and continue</button>
  </div>);
}
export default function Page() { return <Suspense><TermsGate /></Suspense>; }
