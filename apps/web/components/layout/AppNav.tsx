"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "../notifications/NotificationBell";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Desk" },
  { href: "/feed", label: "Feed" },
  { href: "/library", label: "Library" },
  { href: "/notes", label: "Notes" },
  { href: "/statistics", label: "Statistics" },
  { href: "/watch", label: "Watch" },
  { href: "/channels", label: "Channels" },
  { href: "/qc-report", label: "QC Report" },
  { href: "/user-report", label: "User Report" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" }
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="app-nav" aria-label="Primary">
      <div className="app-nav-inner">
        <span className="app-nav-title">ScholarPulse</span>
        <NotificationBell />
        {NAV_ITEMS.map((item) => {
          const active =
            pathname != null &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`));
          return (
            <Link key={item.href} href={item.href} className={`app-nav-link${active ? " active" : ""}`}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
