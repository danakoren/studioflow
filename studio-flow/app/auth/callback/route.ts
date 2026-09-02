/**
 * app/auth/callback/route.ts — ROUTE HANDLER.
 *
 * Session establishment. This is where a confirmation link from an email
 * becomes an actual session, and it is a Route Handler rather than a page for
 * one concrete reason: it must WRITE the session cookies. A Server Component
 * cannot (see lib/supabase/server.ts) — a Route Handler can.
 *
 * ==========================================================================
 * TWO LINK SHAPES, BOTH HANDLED
 * ==========================================================================
 * @supabase/ssr configures the PKCE flow, whose links arrive as ?code=… and are
 * redeemed with exchangeCodeForSession(). Depending on project age and email
 * template, Supabase may instead send ?token_hash=…&type=… , redeemed with
 * verifyOtp(). Supporting only the first produces an auth flow that works on
 * one project and silently fails on another, so both are accepted.
 *
 * ==========================================================================
 * THE `next` PARAMETER IS UNTRUSTED HERE TOO
 * ==========================================================================
 * This URL is reachable by anyone and travels through an email, which makes it
 * the single most attractive place in the app to attach a hostile redirect:
 * the victim is mid-authentication and following a link they have every reason
 * to trust. It is sanitised through the same safeNextPath() the login form
 * uses — the security document names this route specifically (§4.3).
 *
 * An absolute URL is built for the response because a redirect needs one; the
 * origin comes from the REQUEST URL rather than a Host header read by hand,
 * and only ever has an already-validated relative path appended to it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import { safeNextPath } from '@/lib/auth/redirect';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  const nextPath = safeNextPath(searchParams.get('next'));

  const supabase = await createClient();

  let failed = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logServerError('authCallback:exchange', error);
      failed = true;
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      logServerError('authCallback:verifyOtp', error);
      failed = true;
    }
  } else {
    // Someone opened /auth/callback directly, or the link was truncated by a
    // mail client. Not an error worth a stack trace.
    failed = true;
  }

  if (failed) {
    // Deliberately vague, and deliberately NOT an error page: an expired or
    // reused confirmation link is overwhelmingly a real user with a stale
    // email, and the useful response is the login form with an explanation.
    // The reason is in the server log, not in the URL.
    const url = new URL('/login', origin);
    url.searchParams.set('error', 'link');
    if (nextPath) url.searchParams.set('next', nextPath);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}
