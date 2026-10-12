"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export const Logo = () => (
  <span className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
    <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-brand-fg"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 13V3l6 3 6-3v10l-6-3z" /></svg></span>
    JCE <span className="font-medium text-muted">Site Planner</span>
  </span>
);
function ThemeToggle() {
  const [d, setD] = useState(false);
  useEffect(() => { try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; setD(document.documentElement.dataset.theme === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)); } catch { /* */ } }, []);
  return <button aria-label="Toggle theme" className="btn-ghost !px-3 !py-1.5" onClick={() => { const n = d ? "light" : "dark"; document.documentElement.dataset.theme = n; try { localStorage.setItem("theme", n); } catch { /* */ } setD(!d); }}>{d ? "Light" : "Dark"}</button>;
}
export function Header() {
  const [open, setOpen] = useState(false);
  const links = [["Projects", "/projects"], ["Terms", "/legal/terms"]];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/"><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-muted md:flex">
          {links.map(([t, h]) => <Link key={h} href={h} className="hover:text-ink">{t}</Link>)}
          <ThemeToggle /><Link href="/projects" className="btn-primary">Open planner</Link>
        </nav>
        <button className="btn-ghost !px-3 md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>Menu</button>
      </div>
      {open && <div className="flex flex-col gap-3 border-t border-line px-4 py-4 md:hidden">{links.map(([t, h]) => <Link key={h} href={h} onClick={() => setOpen(false)}>{t}</Link>)}<ThemeToggle /></div>}
    </header>
  );
}
export const Footer = () => (
  <footer className="mt-24 border-t border-line">
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted sm:px-6 md:grid-cols-2">
      <div><Logo /><p className="mt-3 max-w-sm">AI-assisted site planning for NSW and QLD builders, designers and civil consultants.</p></div>
      <p className="md:text-right">Outputs are indicative only and are not survey, engineering or planning advice. <Link className="underline" href="/legal/terms">Terms of Use</Link></p>
    </div>
  </footer>
);
