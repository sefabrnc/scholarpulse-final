import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "../components/layout/AppShell";
import PwaRegister from "../components/pwa/PwaRegister";
import ThemeClient from "../components/theme/ThemeClient";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScholarPulse",
  description: "Desk, timeline, and public paper discovery",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#6366F1"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeClient />
        <PwaRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
