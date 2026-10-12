import "./globals.css";
import type { Metadata } from "next";
import { Footer, Header } from "@/components/Shell";
export const metadata: Metadata = { title: "JCE Site Planner", description: "Autonomous cadastral and civil site planning for NSW and QLD." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-AU"><body><Header /><main className="mx-auto max-w-6xl px-4 sm:px-6">{children}</main><Footer /></body></html>);
}
