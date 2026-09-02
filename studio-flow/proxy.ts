/**
 * proxy.ts (project root)
 *
 * Next.js 16 renamed the Middleware file convention to Proxy; the behaviour is
 * unchanged. Older notes in StudioFlow_Docs/ still say "middleware" and are
 * describing this file.
 *
 * Runs on every matched request. Its ESSENTIAL job is refreshing the Supabase
 * session cookie, because Server Components cannot write cookies and a user
 * would otherwise be silently logged out when the access token expires.
 *
 * Its SECONDARY job is coarse route gating, which is an optimisation only.
 * This is NOT a security boundary: a PostgREST request issued from the browser
 * console never passes through it. RLS is the boundary.
 */

import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those need no session
     * refresh and matching them would add latency to every asset request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
