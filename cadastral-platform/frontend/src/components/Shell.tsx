"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
export const Logo = () => (
  <span className="flex items-center gap-2.5 font-display text-[19px] font-semibold tracking-tight">
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x=".5" y=".5" width="27" height="27" rx="3" className="stroke-ink/60" />
      <path d="M6 21 8 8l11-1.5 3 12.5z" className="fill-brand/25 stroke-ink" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M22.5 6v5M20.5 8l2-2.5 2 2.5" className="stroke-brand" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>JCE <span className="font-normal text-muted">Site Planner</span></span>
  </span>
);
function ThemeToggle() {
  const [d, setD] = useState(false);
  useEffect(() => { try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; setD(document.documentElement.dataset.theme === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)); } catch { /* */ } }, []);
  return <button aria-label="Toggle theme" className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted hover:border-ink hover:text-ink" onClick={() => { const n = d ? "light" : "dark"; document.documentElement.dataset.theme = n; try { localStorage.setItem("theme", n); } catch { /* */ } setD(!d); }}>{d ? "Paper" : "Night"}</button>;
}
const links: [string, string][] = [["How it works", "/#how"], ["Civil plans", "/#plans"], ["Honest by design", "/#honest"], ["Pricing", "/#pricing"], ["FAQ", "/#faq"]];
export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-ink/15 bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-8">
        <Link href="/" aria-label="JCE Site Planner home"><Logo /></Link>
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm text-muted lg:flex">
          {links.map(([t, h]) => <Link key={h} href={h} className="hover:text-ink">{t}</Link>)}
        </nav>
        <div className="hidden items-center gap-4 md:flex">
          <ThemeToggle /><EngineerEnquiryButton className={ENGINEER_BTN + " !py-[7px]"}>Talk to an engineer</EngineerEnquiryButton><Link href="/projects" className="text-sm font-medium hover:text-gold">Log in</Link>
          <Link href="/projects" className="btn-primary !py-2">Start free trial</Link>
        </div>
        <button className="btn-ghost !px-3 !py-1.5 md:hidden" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      </div>
      {open && <div className="flex flex-col gap-3 border-t border-line px-4 py-4 md:hidden">{[...links, ["Projects", "/projects"] as [string, string], ["Terms", "/legal/terms"] as [string, string]].map(([t, h]) => <Link key={h} href={h} onClick={() => setOpen(false)} className="py-1">{t}</Link>)}
        <div className="flex flex-wrap items-center gap-3 pt-2"><ThemeToggle /><EngineerEnquiryButton className={ENGINEER_BTN}>Talk to an engineer</EngineerEnquiryButton><Link href="/projects" className="btn-primary">Start free trial</Link></div></div>}
    </header>
  );
}
export const Footer = () => (
  <footer className="mt-24 border-t border-ink/15">
    <div className="mx-auto max-w-7xl px-4 sm:px-8"><div className="ticks" aria-hidden /></div>
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 text-sm text-muted sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
      <div><Logo /><p className="mt-4 max-w-sm leading-relaxed">Site and civil planning for NSW and QLD builders, designers and civil consultants.</p></div>
      <nav aria-label="Product" className="flex flex-col gap-2"><span className="h-eyebrow">Product</span>{links.map(([t, h]) => <Link key={h} href={h} className="hover:text-ink">{t}</Link>)}</nav>
      <nav aria-label="Legal" className="flex flex-col gap-2"><span className="h-eyebrow">Legal</span><Link href="/legal/terms" className="hover:text-ink">Terms of Use</Link><EngineerEnquiryButton className="text-left hover:text-ink">Talk to an engineer</EngineerEnquiryButton><Link href="/projects" className="hover:text-ink">Projects</Link></nav>
    </div>
    <div className="border-t border-line"><p className="mx-auto max-w-7xl px-4 py-5 font-mono text-[11px] leading-relaxed text-muted sm:px-8">Outputs are indicative only and are not survey, engineering or planning advice. Verify BYDA plans and locate services before excavation. JCE Site Planner.</p></div>
  </footer>
);
/** Viewer routes are full-bleed (the 3D viewer has its own top bar); the home page lays out its own sections. */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const p = usePathname() || "/";
  if (p === "/viewer-demo" || /^\/projects\/[^/]+\/viewer/.test(p)) return <>{children}</>;
  return (<><a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-3">Skip to content</a><Header />
    {p === "/" ? <main id="main">{children}</main> : <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6">{children}</main>}<Footer /></>);
}
