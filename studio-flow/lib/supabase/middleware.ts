/**
 * lib/supabase/middleware.ts
 *
 * Session refresh helper used by the root middleware.
 *
 * WHY THIS EXISTS: React Server Components can READ cookies but cannot WRITE
 * them. An access token expiring mid-session would therefore leave the user
 * silently logged out with no opportunity to refresh. Middleware runs before
 * the route, refreshes the token, and writes the updated cookies onto the
 * response.
 *
 * NOTE ON getUser(): this calls getUser(), not getSession(). getSession()
 * decodes the cookie LOCALLY without verifying its signature, and a cookie is
 * client-controlled data. See lib/auth/require.ts for the full rule.
 *
 * Middleware is NOT an authorisation boundary. It never sees a PostgREST
 * request issued from a browser console. Its route gating is an optimisation
 * that avoids rendering pages which would fail anyway.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/types/database.types';

/**
 * Paths that require an authenticated user, with the role they imply.
 *
 * /change-password is here because the temporary-password rotation screen is
 * useless without a session — the update runs as the caller. It is NOT under
 * /my, so it would otherwise fall through as public and render a form that
 * fails on submit (Basic Security §1.6).
 */
const PROTECTED_PREFIXES = [
  '/my',
  '/teach',
  '/admin',
  '/change-password',
] as const;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the token as a side effect. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Relative path only. An absolute or protocol-relative value here would
    // make the login flow an open redirect (Basic Security §4.3).
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // /register no longer exists — sign-up is admin-driven — so only /login is
  // bounced. A signed-in visitor who lands there goes to their schedule.
  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/schedule';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
