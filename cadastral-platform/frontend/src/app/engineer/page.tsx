"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ENQUIRY_CSS } from "@/components/enquiry/styles";
import EngineerEnquiryForm from "@/components/enquiry/EngineerEnquiryForm";

/** Standalone page version of the enquiry form (also linked from the marketing site). Optional ?project=<uuid>. */
export default function EngineerPage() {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | undefined>();
  useEffect(() => setProjectId(new URLSearchParams(window.location.search).get("project") ?? undefined), []);
  return (
    <main className="enq enq-page">
      <style>{ENQUIRY_CSS}</style>
      <div className="enq-eyebrow">Industry partner enquiry</div>
      <h1 style={{ margin: "0 0 14px", fontFamily: "var(--font-display, inherit)", fontWeight: 500, fontSize: 30 }}>Talk to a civil engineer</h1>
      <div className="enq-card">
        <EngineerEnquiryForm projectId={projectId} onDone={() => router.push("/")} doneLabel="Back to the planner" />
      </div>
    </main>
  );
}
