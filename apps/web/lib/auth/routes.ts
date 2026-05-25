/** Routes that never require auth (shareable / auth entry). */
export const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/signin",
  "/auth",
  "/paper",
  "/cite",
  "/timeline",
  "/search",
  "/authors",
  "/topics",
  "/offline",
  "/manifest.webmanifest",
  "/sw.js",
  "/api/public"
] as const;

/** App sections gated when SP_REQUIRE_AUTH=1. */
export const PROTECTED_ROUTE_PREFIXES = [
  "/feed",
  "/library",
  "/notes",
  "/statistics",
  "/watch",
  "/channels",
  "/profile",
  "/settings",
  "/desk",
  "/user-report",
  "/qc-report"
] as const;

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") {
    return false;
  }
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") {
    return true;
  }
  if (isPublicPath(pathname)) {
    return false;
  }
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
