"use client";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { missingAcks } from "@/lib/acks";
import { Acknowledgements, useAcks } from "@/components/Acknowledgements";
import { ArtifactList } from "@/components/ArtifactList";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
import { SampleBanner } from "@/components/ui/Status";
export default function Download({ params }: { params: { id: string } }) {
  const id = params.id, { present, save } = useAcks(id), missing = missingAcks(present), art = useRemote(() => api.artifacts(id), [id]);
  return (<div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
    <div>
      <p className="h-eyebrow">Step 1 of 2</p><h2 className="mt-2 font-display text-3xl font-medium">Acknowledge the limits</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Downloads are released when all nine acknowledgements are recorded for this project. Read each one. None is ticked for you.</p>
      <div className="mt-6"><Acknowledgements projectId={id} present={present} onChange={save} /></div>
    </div>
    <div className="lg:sticky lg:top-24 lg:self-start">
      {art.sample && <SampleBanner what="The file list" />}
      <p className="h-eyebrow">Step 2 of 2</p><h2 className="mt-2 font-display text-3xl font-medium">Download</h2>
      <p className={`mt-3 text-sm ${missing.length ? "text-warn" : "text-ok"}`} role="status">{missing.length ? `${9 - missing.length} of 9 acknowledgements recorded. ${missing.length} still missing, so downloads are held.` : "All 9 acknowledgements recorded. Downloads are released."}</p>
      <div className="mt-4">{art.data && <ArtifactList items={art.data} projectId={id} />}</div>
      <div className="mt-6 border border-ink/30 bg-surface p-5 text-sm"><p className="font-medium">Need an engineer to design, check or certify it?</p><p className="mt-1 text-xs leading-relaxed text-muted">JCE Infrastructure is our industry partner. Outputs stay indicative until a registered engineer is engaged.</p><EngineerEnquiryButton projectId={id} context="export" className={`${ENGINEER_BTN} mt-3`}>Talk to an engineer</EngineerEnquiryButton></div>
    </div>
  </div>);
}
