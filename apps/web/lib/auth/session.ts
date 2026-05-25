import type { NextRequest } from "next/server";

export const USER_ID_COOKIE = "sp-user-id";

export function readCookieUserId(request: NextRequest): string | null {
  const value = request.cookies.get(USER_ID_COOKIE)?.value?.trim();
  return value && value.length > 0 ? value : null;
}

export function readHeaderUserId(request: NextRequest): string | null {
  const value = request.headers.get("x-user-id")?.trim();
  return value && value.length > 0 ? value : null;
}

export function resolveUserId(request: NextRequest, sessionUserId?: string | null): string | null {
  return sessionUserId ?? readHeaderUserId(request) ?? readCookieUserId(request);
}

export function hasSupabaseEnv(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && key);
}
