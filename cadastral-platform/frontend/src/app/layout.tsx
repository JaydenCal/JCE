import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Jost } from "next/font/google";
import { AppChrome } from "@/components/Shell";
const display = Jost({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
export const metadata: Metadata = { title: "JCE Site Planner: Civil plans + DA/CDC applications, one package", description: "Site assessment, approval pathway, civil plans, 3D design, compliance table and application pack for NSW and QLD. Some features are in development." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-AU" className={`${display.variable} ${body.variable} ${mono.variable}`}><body><AppChrome>{children}</AppChrome></body></html>);
}
