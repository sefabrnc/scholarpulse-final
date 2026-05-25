import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasSupabaseEnv } from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error_description") ?? searchParams.get("error");
  const nextPath = searchParams.get("next") ?? "/profile";

  if (error) {
    return NextResponse.redirect(new URL(`/profile?auth=error&message=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/profile?auth=missing_code", request.url));
  }

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(new URL("/profile?auth=callback_pending", request.url));
  }

  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/profile";
  const response = NextResponse.redirect(new URL(safeNext, request.url));

  try {
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          }
        }
      }
    );

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return NextResponse.redirect(
        new URL(`/profile?auth=error&message=${encodeURIComponent(exchangeError.message)}`, request.url)
      );
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "auth_exchange_failed";
    return NextResponse.redirect(new URL(`/profile?auth=error&message=${encodeURIComponent(message)}`, request.url));
  }

  return response;
}
