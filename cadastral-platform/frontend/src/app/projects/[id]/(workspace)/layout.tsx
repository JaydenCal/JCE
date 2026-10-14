"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Project } from "@/lib/api";
import { DraftBadge } from "@/components/ui/Status";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";

const TABS: [string, string][] = [["", "Overview"], ["constraints", "Constraints"], ["requirements", "Requirements"], ["plans", "Plans"], ["services", "Services and driveway"], ["report", "Report"], ["pathway", "Pathway and compliance"], ["pack", "Application pack"], ["viewer", "3D model"], ["activity", "Activity"], ["download", "Acknowledge and download"]];

export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const { id } = params, path = usePathname() || "", base = `/projects/${id}`, [p, setP] = useState<Project>();
  useEffect(() => { api.project(id).then(setP).catch(() => undefined); }, [id]);
  return (
    <div className="py-8">
      <Link href="/projects" className="text-sm text-muted hover:text-ink">&larr; Projects</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="h-eyebrow">{p?.jurisdiction ?? ""} {p?.lotplan ?? ""}</p>
          <h1 className="mt-2 font-display text-3xl font-medium sm:text-4xl">{p?.title ?? "Project"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3"><DraftBadge /><EngineerEnquiryButton projectId={id} context="project" className={ENGINEER_BTN}>Talk to an engineer</EngineerEnquiryButton></div>
      </div>
      <nav aria-label="Project sections" className="-mx-4 mt-6 overflow-x-auto border-y border-ink/20 px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.map(([seg, label]) => { const href = seg ? `${base}/${seg}` : base, on = seg ? path.startsWith(href) : path === base;
            return <li key={label}><Link href={href} aria-current={on ? "page" : undefined} className={`block border-b-2 px-3 py-3 text-sm ${on ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link></li>; })}
        </ul>
      </nav>
      <div className="pt-8">{children}</div>
    </div>
  );
}
