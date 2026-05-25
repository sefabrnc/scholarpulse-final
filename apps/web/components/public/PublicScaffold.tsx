"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

type PublicScaffoldProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function SourceBadge({ source, workerUnavailable }: { source?: string; workerUnavailable?: boolean }) {
  if (!source) {
    return null;
  }
  const label =
    source === "worker"
      ? "ScholarPulse index"
      : source === "openalex_fallback"
        ? "OpenAlex fallback (Worker unavailable)"
        : "OpenAlex";
  const className =
    source === "openalex_fallback" ? "public-source-badge public-source-badge-fallback" : "public-source-badge";
  return (
    <p className={className}>
      Data source: {label}
      {workerUnavailable ? " · upstream 502" : ""}
    </p>
  );
}

export function PublicScaffold({ title, subtitle, children }: PublicScaffoldProps) {
  const navItems = useMemo(
    () => [
      { href: "/search", label: "Search" },
      { href: "/topics/machine%20learning", label: "Topics" },
      { href: "/authors/geoffrey%20hinton", label: "Authors" }
    ],
    []
  );

  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <Link href="/search" className="public-brand">
            ScholarPulse
          </Link>
          <nav className="public-nav" aria-label="Public navigation">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="public-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="public-main">
        <h1 className="public-title">{title}</h1>
        <p className="public-subtitle">{subtitle}</p>
        <div className="public-content">{children}</div>
      </main>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="public-empty">{message}</p>;
}

export function LoadingState() {
  return <p className="public-muted">Loading...</p>;
}
