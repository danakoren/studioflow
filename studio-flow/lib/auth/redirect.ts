/**
 * lib/auth/redirect.ts
 *
 * ==========================================================================
 * THE OPEN-REDIRECT GUARD (Basic Security §4.3)
 * ==========================================================================
 * The login flow and the auth callback both accept a `next` parameter so that a
 * student who clicked "Book" on a class lands back on THAT class after signing
 * in, rather than on a generic dashboard.
 *
 * That parameter is attacker-controlled. Passed to a redirect unchecked, it
 * turns our own login page into a bounce to an attacker's site — arriving with
 * the studio's domain in the referrer and the credibility of a link the user
 * followed from a real StudioFlow page. This is the classic phishing assist.
 *
 * The rule from the security document: a valid `next` is a RELATIVE path
 * beginning with a SINGLE '/'. Everything else falls back to a safe default.
 *
 * NO 'server-only' HERE, deliberately: this is a pure function over a string
 * with no secrets and no I/O, so the unit test can import it directly
 * (tests/unit/redirect.test.ts).
 */

/** Where a signed-in user goes when there is no valid `next`. */
export const DEFAULT_POST_LOGIN_PATH = '/schedule';

/** Forced destination for an instructor still holding a temporary password. */
export const CHANGE_PASSWORD_PATH = '/change-password';

/**
 * Paths that must never be a post-login destination, because landing back on
 * them immediately re-redirects and the user ends up in a loop.
 */
// '/register' is retained deliberately: the route is GONE, so honouring a
// ?next=/register would send someone to a 404 instead of somewhere useful.
const NEVER_REDIRECT_TO = new Set(['/login', '/register']);

/**
 * True if the string contains an ASCII control character.
 *
 * Written as an explicit scan rather than a regex character range on purpose:
 * a range like [\x00-\x1f] invites a literal control byte being pasted into the
 * source, which silently turns this file into binary. A char-code comparison
 * cannot be got wrong that way.
 *
 * These matter because CR/LF can split a response header, and a stray NUL or
 * tab can defeat the prefix checks below after browser normalisation.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate an untrusted `next` value into a safe same-origin path.
 *
 * Returns `fallback` for anything that is not provably a local path. The checks
 * are ordered cheapest-first and each rejects a specific real bypass:
 *
 *   'https://evil.example'   absolute URL — a different origin entirely
 *   '//evil.example'         PROTOCOL-RELATIVE: the browser reads this as a
 *                            host, not a path. The single most commonly missed
 *                            case, because it does start with '/'.
 *   '/\evil.example'         browsers normalise the backslash to '/', making
 *                            this protocol-relative too
 *   'javascript:alert(1)'    a scheme in what is claimed to be a path
 *   '/foo<CR><LF>Set-Cookie' control characters, for response splitting
 */
export function safeNextPath(
  raw: unknown,
  fallback: string = DEFAULT_POST_LOGIN_PATH,
): string {
  if (typeof raw !== 'string') return fallback;

  const value = raw.trim();

  // An absurdly long value is never a legitimate route in this app, and this is
  // a cheap way to reject junk before running any scan over it.
  if (value.length === 0 || value.length > 512) return fallback;

  if (hasControlCharacter(value)) return fallback;

  // Must be a path on THIS origin.
  if (!value.startsWith('/')) return fallback;

  // Protocol-relative, in both the literal and the browser-normalised form.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;

  // A backslash anywhere is not something this app's routes contain, and it is
  // the raw material for the normalisation trick above.
  if (value.includes('\\')) return fallback;

  // A scheme separator in the PATH portion means this is not a plain path.
  // Checked only before ?/# so a legitimate query value keeps its colon.
  const [pathname] = value.split(/[?#]/);
  if (pathname.includes(':')) return fallback;

  if (NEVER_REDIRECT_TO.has(pathname)) return fallback;

  return value;
}

/**
 * Absolute URL for Supabase to send the confirmation email back to.
 *
 * Supabase requires an absolute `emailRedirectTo`, so this is the one place a
 * full origin is assembled. The origin comes from OUR OWN configuration, never
 * from the request — a Host header is client-controlled, and trusting it here
 * would reintroduce exactly the redirect problem safeNextPath prevents.
 *
 * The `next` value is sanitised BEFORE being embedded, so a poisoned link
 * cannot smuggle an off-site destination through the email round trip.
 */
export function authCallbackUrl(nextPath?: unknown): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');

  const url = new URL('/auth/callback', origin);

  // Empty fallback: absent or hostile input simply omits the parameter, rather
  // than pinning every confirmation email to /schedule.
  const safe = safeNextPath(nextPath, '');
  if (safe) url.searchParams.set('next', safe);

  return url.toString();
}
