import type { Metadata } from "next";
import { PageHead } from "@/components/ui/Layout";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
export const metadata: Metadata = { title: "Custom municipality | JCE Site Planner", description: "In development: load your council's documents and standards." };
const STEPS = ["Set the council's name, units and design standards.", "Load the council's engineering documents.", "Enter the parcel for your site.", "The same plans and compliance table follow your rules, each value cited to your documents."];
export default function Custom() {
  return (<>
    <PageHead eyebrow="Custom municipality · In development" title={<>Bring your own <span className="accent">municipality</span>.</>} lede="For councils, and for sites outside NSW and Queensland. This is built in the platform but is not yet available in the web app." />
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8 lg:py-24"><ol className="titleblock md:grid-cols-4 [&>li]:border-b md:[&>li]:border-b-0 md:[&>li:not(:last-child)]:border-r">{STEPS.map((s, i) => <li key={s} className="border-ink/25 p-5"><span className="font-mono text-xs text-gold">0{i + 1}</span><p className="mt-2 text-sm leading-relaxed">{s}</p></li>)}</ol>
      <p className="mt-8 max-w-2xl text-muted">Until your documents are loaded, requirements show as Unresolved. Nothing is assumed from another council. Get in touch if you would like to be a first user.</p>
      <EngineerEnquiryButton className={`${ENGINEER_BTN} mt-6`}>Get in touch</EngineerEnquiryButton></section>
  </>);
}
