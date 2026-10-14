import type { Metadata } from "next";
import { PageHead } from "@/components/ui/Layout";
export const metadata: Metadata = { title: "Privacy | JCE Site Planner", description: "Privacy policy placeholder." };
export default function Privacy() {
  return (<>
    <PageHead eyebrow="Legal" title="Privacy" lede="The privacy policy has not been written yet." />
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-8"><div className="hatch border border-warn/50 p-5 text-sm leading-relaxed">
      <p className="font-mono text-[11px] uppercase tracking-wider text-warn">Placeholder</p>
      <p className="mt-2">The policy, the hosting location, and how long uploads and outputs are kept are still to be decided. Until they are, treat anything you upload as stored for an unspecified period.</p>
      <p className="mt-3 text-muted">[Retention notice to be completed]</p></div></section>
  </>);
}
