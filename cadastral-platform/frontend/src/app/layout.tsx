import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Jost } from "next/font/google";
import { AppChrome } from "@/components/Shell";
const display = Jost({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
export const metadata: Metadata = { title: "JCE Site Planner", description: "Site to civil plan in minutes: lot, zoning, constraints, civil design and a 3D walk-through for NSW and QLD." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-AU" className={`${display.variable} ${body.variable} ${mono.variable}`}><body><AppChrome>{children}</AppChrome></body></html>);
}
