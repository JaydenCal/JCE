import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/Layout";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
export const metadata: Metadata = { title: "Pricing | JCE Site Planner", description: "Pricing is not published yet." };
export default function Pricing() {
  return (<>
    <PageHead eyebrow="Pricing" title={<>Pricing <span className="accent">coming soon</span>.</>} lede="We are finalising plans. No prices are published yet, and nothing is charged. Start a free trial and run your first lot end to end." />
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-24"><div className="titleblock md:grid-cols-2">
      <div className="p-8"><p className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">Plans</p><p className="mt-2 font-display text-3xl font-medium">Coming soon</p><p className="mt-3 text-sm text-muted">Plan limits and billing are not designed yet.</p><Link href="/projects/new" className="btn-primary mt-6">Start free trial</Link></div>
      <div className="p-8 md:border-l"><p className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">Engineer review</p><p className="mt-2 font-display text-3xl font-medium">By enquiry</p><p className="mt-3 text-sm text-muted">Certification and design by JCE Infrastructure is quoted separately. No response time is promised through the form.</p><EngineerEnquiryButton className={`${ENGINEER_BTN} mt-6`}>Talk to an engineer</EngineerEnquiryButton></div>
    </div></section>
  </>);
}
