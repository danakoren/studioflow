/**
 * lib/cron/authorize.ts
 *
 * The ONLY thing standing between the internet and a set of endpoints that run
 * under the service-role client with RLS bypassed. Every route in
 * app/api/cron/** calls this first, before it does anything else at all.
 *
 * ==========================================================================
 * WHY A CONSTANT-TIME COMPARISON
 * ==========================================================================
 * `a === b` on strings returns as soon as it finds a differing byte, so the
 * time it takes leaks how many leading bytes were correct. That turns secret
 * recovery into a byte-at-a-time search instead of a search of the whole
 * keyspace. These routes are publicly reachable and unrated-limited (accepted
 * risk R1), which is exactly the condition under which that attack is
 * practical.
 *
 * Both sides are hashed to a fixed 32 bytes before comparison. timingSafeEqual
 * THROWS on length mismatch, and guarding that by comparing lengths first
 * would reintroduce a length oracle; hashing removes both problems, since
 * every digest is the same size regardless of input.
 *
 * ==========================================================================
 * FAIL CLOSED
 * ==========================================================================
 * A missing or placeholder CRON_SECRET returns 503 and runs no job. The
 * tempting alternative — "no secret configured, so skip the check" — turns a
 * forgotten environment variable into an open endpoint that mutates the whole
 * studio's records.
 */

import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { logServerError } from '@/lib/errors/map';

/** The literal shipped in .env.example. Treated as "not configured". */
const PLACEHOLDER_SECRET = 'generate-with-openssl-rand-base64-32';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Returns a response to send back when the caller is NOT authorised, or null
 * when the request may proceed.
 *
 * Deliberately shaped as "truthy means stop" so a route reads:
 *
 *     const denied = authorizeCronRequest(request);
 *     if (denied) return denied;
 *
 * A route that forgets the check is visible in review as the absence of those
 * two lines, rather than as a subtly inverted boolean.
 */
export function authorizeCronRequest(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret || secret === PLACEHOLDER_SECRET) {
    logServerError(
      'cron:authorize',
      new Error('CRON_SECRET is unset or still the .env.example placeholder.'),
    );
    return NextResponse.json(
      { ok: false, error: 'cron_not_configured' },
      { status: 503 },
    );
  }

  // Vercel Cron sends the project's CRON_SECRET as a bearer token. The header
  // is read case-insensitively by Headers.get, so no normalisation is needed.
  const header = request.headers.get('authorization') ?? '';

  // Compare the WHOLE header against the whole expected value. Parsing out the
  // token first and comparing that would branch on the prefix, and the branch
  // is itself observable.
  const expected = digest(`Bearer ${secret}`);
  const presented = digest(header);

  if (!timingSafeEqual(expected, presented)) {
    // No detail in the body: whether the secret was absent, malformed or
    // merely wrong is information an attacker would otherwise be handed.
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return null;
}
