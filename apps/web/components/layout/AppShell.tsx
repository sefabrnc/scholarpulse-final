"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppNav } from "./AppNav";

const PUBLIC_PREFIXES = ["/paper", "/cite", "/timeline", "/search", "/authors", "/topics", "/offline"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const publicRoute = isPublicPath(pathname);

  if (publicRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <AppNav />
      <div className="app-content">{children}</div>
    </>
  );
}
