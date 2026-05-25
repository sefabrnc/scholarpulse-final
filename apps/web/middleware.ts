import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isProtectedPath, isPublicPath } from "./lib/auth/routes";
import { hasSupabaseEnv, readCookieUserId, readHeaderUserId, resolveUserId, USER_ID_COOKIE } from "./lib/auth/session";

const AUTH_REDIRECT_PATH = "/profile";

function applyUserIdHeaders(response: NextResponse, request: NextRequest, userId: string) {
  response.headers.set("x-user-id", userId);
  request.headers.set("x-user-id", userId);
}

function applyUserIdCookie(response: NextResponse, userId: string) {
  response.cookies.set(USER_ID_COOKIE, userId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

async function resolveSessionUserId(request: NextRequest, response: NextResponse): Promise<string | null> {
  if (!hasSupabaseEnv()) {
    return null;
  }

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

    const {
      data: { session }
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next({
    request: {
      headers: request.headers
    }
  });

  const sessionUserId = await resolveSessionUserId(request, response);
  const resolvedUserId = resolveUserId(request, sessionUserId);

  if (resolvedUserId) {
    applyUserIdHeaders(response, request, resolvedUserId);
    if (sessionUserId) {
      applyUserIdCookie(response, sessionUserId);
    }
  }

  if (isPublicPath(pathname)) {
    return response;
  }

  const requireAuth = process.env.SP_REQUIRE_AUTH === "1";
  if (requireAuth && isProtectedPath(pathname) && !resolvedUserId) {
    const url = request.nextUrl.clone();
    url.pathname = AUTH_REDIRECT_PATH;
    url.searchParams.set("auth", "required");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
