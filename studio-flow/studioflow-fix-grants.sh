#!/usr/bin/env bash
# =============================================================================
#  StudioFlow — HOTFIX: "No studio is set up yet" / [studioflow:...] {}
#
#  Fixes two defects:
#
#    1. Migrations 001-009 never GRANT table privileges to anon/authenticated.
#       They relied on Supabase's ambient default privileges. Where those do
#       not apply, every read fails with SQLSTATE 42501 "permission denied",
#       even though the row exists and RLS allows it.
#
#    2. logServerError() logged the raw error object. PostgrestError keeps
#       `message` non-enumerable, so any serialising logger renders it as {}
#       and discards the code that would have identified the cause.
#
#  USAGE
#    bash studioflow-fix-grants.sh          # writes the files
#    bash studioflow-fix-grants.sh --force  # overwrite existing
#
#  Then apply the migration:
#    supabase db push          # or: supabase db reset
#  And diagnose:
#    node scripts/diagnose-db.mjs
# =============================================================================
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ ! -f package.json ]; then
  echo "ERROR: no package.json here. Run this from your project root."
  exit 1
fi

write() {
  local path="$1"
  if [ -e "$path" ] && [ "$FORCE" -eq 0 ]; then
    cat > /dev/null
    echo "  skip   $path (exists — re-run with --force)"
    return
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  echo "  write  $path"
}

echo "StudioFlow hotfix"
echo

mkdir -p supabase/migrations lib/errors scripts

# supabase/migrations/20260101000010_grants_fix.sql
write 'supabase/migrations/20260101000010_grants_fix.sql' << 'STUDIOFLOW_EOF'
-- ============================================================================
-- StudioFlow — Migration 010: Explicit Table Privileges  [BUG FIX]
-- ----------------------------------------------------------------------------
-- WHY THIS MIGRATION EXISTS
--
-- Migrations 001-009 enable RLS and write policies, but never GRANT table
-- privileges to the `anon` and `authenticated` roles. They relied on Supabase's
-- ambient ALTER DEFAULT PRIVILEGES, which grants ALL on new tables in `public`.
--
-- That assumption holds on a stock `supabase db reset`, and it did NOT hold in
-- every environment. When it fails, PostgREST returns:
--
--     ERROR: permission denied for table studios     (SQLSTATE 42501)
--
-- which surfaces in the app as getPrimaryStudio() failing while the row is
-- plainly visible in the SQL editor.
--
-- POSTGRESQL HAS TWO INDEPENDENT GATES, and BOTH must pass:
--
--     1. GRANT   — "may this role touch this table at all?"
--     2. RLS     — "which ROWS of it may this role see?"
--
-- A policy of USING (true) is irrelevant if the GRANT is missing: Postgres
-- refuses before it ever evaluates a policy. This is why adding more permissive
-- policies did not help — the request never reached them.
--
-- NOTE ON WHY THIS IS NOT `GRANT ALL`
--
-- `grant all on all tables in schema public` would silently re-grant DELETE on
-- bookings and UPDATE/DELETE on credit_ledger, undoing the revokes in migration
-- 005 and breaking INV-4 (an append-only ledger) along with tests PR-40, PR-41
-- and PR-42. The grants below mirror the POLICIES exactly, no wider.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Schema usage — without this, nothing in `public` is reachable at all.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- anon: READ ONLY, and only what the public schedule needs.
-- ---------------------------------------------------------------------------
-- RLS still narrows these to scheduled future sessions and active catalogue
-- rows. The GRANT opens the door; the policy decides what is behind it.
grant select on public.studios     to anon;
grant select on public.sessions    to anon;
grant select on public.rooms       to anon;
grant select on public.class_types to anon;
grant select on public.profiles    to anon;   -- instructor names on the schedule

-- anon deliberately gets NOTHING on these. Even with a policy present, the
-- missing grant is a second, independent barrier.
--   bookings, waitlist_entries, credit_grants, credit_ledger,
--   notifications, studio_members


-- ---------------------------------------------------------------------------
-- authenticated: SELECT everywhere; RLS decides which rows.
-- ---------------------------------------------------------------------------
grant select on public.profiles         to authenticated;
grant select on public.studios          to authenticated;
grant select on public.studio_members   to authenticated;
grant select on public.rooms            to authenticated;
grant select on public.class_types      to authenticated;
grant select on public.sessions         to authenticated;
grant select on public.bookings         to authenticated;
grant select on public.waitlist_entries to authenticated;
grant select on public.credit_grants    to authenticated;
grant select on public.credit_ledger    to authenticated;
grant select on public.notifications    to authenticated;


-- ---------------------------------------------------------------------------
-- authenticated: writes, matched ONE-TO-ONE with the policies in migration 005.
-- ---------------------------------------------------------------------------

-- profiles_update_own
grant update on public.profiles to authenticated;

-- studios_update_admin
grant update on public.studios to authenticated;

-- studio_members_insert_admin / studio_members_update_admin
grant insert, update on public.studio_members to authenticated;

-- rooms_write_admin / class_types_write_admin.
-- NOTE: no DELETE. Those policies are FOR ALL, but nothing in this system is
-- ever hard-deleted — catalogue rows are retired with is_active = false. The
-- withheld privilege enforces that discipline even if a policy is loosened.
grant insert, update on public.rooms       to authenticated;
grant insert, update on public.class_types to authenticated;

-- sessions_insert_admin / sessions_update_admin / sessions_update_own_taught
grant insert, update on public.sessions to authenticated;

-- bookings_update_admin (attendance corrections, admin edits).
-- NO INSERT: bookings are created ONLY by book_session() and
-- admin_book_student(), which are SECURITY DEFINER. Granting INSERT here would
-- let a client create a booking that skips the capacity check and the row lock
-- — the exact hole that INV-1 depends on being closed.
grant update on public.bookings to authenticated;

-- notifications_update_own (marking as read)
grant update on public.notifications to authenticated;

-- waitlist_entries: SELECT ONLY. Entries are created and transitioned solely
-- by join_waitlist(), leave_waitlist() and __promote_from_waitlist().

-- credit_grants: SELECT ONLY. Grants are issued solely by grant_credits().
-- A client that could INSERT here could mint credits (tests PR-14, PR-15).


-- ---------------------------------------------------------------------------
-- service_role: full access. Used only by cron routes; RLS is bypassed anyway.
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to service_role;


-- ---------------------------------------------------------------------------
-- Views (re-asserted; harmless if migration 006 already ran)
-- ---------------------------------------------------------------------------
grant select on public.v_sessions_with_availability  to anon, authenticated;
grant select on public.v_waitlist_positions          to authenticated;
grant select on public.v_student_balances            to authenticated;
grant select on public.v_grant_ledger_reconciliation to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- RE-ASSERT THE HARD REVOKES.
-- ---------------------------------------------------------------------------
-- These run LAST so that no grant above can widen them by accident. If a future
-- migration adds a broad grant, re-running this block restores the guarantees.
--
-- INV-4: the credit ledger is append-only for EVERY role, including admins.
revoke insert, update, delete on public.credit_ledger from anon, authenticated;

-- Nothing is ever hard-deleted (Detailed Technical Design §3.13).
revoke delete on public.bookings         from anon, authenticated;
revoke delete on public.sessions         from anon, authenticated;
revoke delete on public.waitlist_entries from anon, authenticated;
revoke delete on public.credit_grants    from anon, authenticated;
revoke delete on public.profiles         from anon, authenticated;
revoke delete on public.studio_members   from anon, authenticated;
revoke delete on public.rooms            from anon, authenticated;
revoke delete on public.class_types      from anon, authenticated;
revoke delete on public.studios          from anon, authenticated;
revoke delete on public.notifications    from anon, authenticated;

-- Bookings and waitlist entries may only be created by SECURITY DEFINER
-- functions, never by a direct client insert.
revoke insert on public.bookings         from anon, authenticated;
revoke insert on public.waitlist_entries from anon, authenticated;
revoke insert on public.credit_grants    from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Default privileges for FUTURE tables.
-- ---------------------------------------------------------------------------
-- Deliberately narrow: a table added later gets NOTHING until someone grants
-- it explicitly. A new table silently inheriting write access to `anon` is a
-- worse failure than a new table that visibly does not work yet.
alter default privileges in schema public
  grant select on tables to authenticated;

alter default privileges in schema public
  grant all on tables to service_role;


-- ---------------------------------------------------------------------------
-- Diagnostic: report the effective privilege matrix.
-- ---------------------------------------------------------------------------
-- Run `select * from public.assert_grant_coverage();` to see, per table, what
-- anon and authenticated may actually do. `anon_select` false on `studios`
-- is precisely the 42501 that motivated this migration.
create or replace function public.assert_grant_coverage()
returns table (
  table_name          text,
  anon_select         boolean,
  authenticated_select boolean,
  authenticated_insert boolean,
  authenticated_update boolean,
  authenticated_delete boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.relname::text,
    has_table_privilege('anon',          'public.' || c.relname, 'select'),
    has_table_privilege('authenticated', 'public.' || c.relname, 'select'),
    has_table_privilege('authenticated', 'public.' || c.relname, 'insert'),
    has_table_privilege('authenticated', 'public.' || c.relname, 'update'),
    has_table_privilege('authenticated', 'public.' || c.relname, 'delete')
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

revoke all on function public.assert_grant_coverage() from public, anon, authenticated;
grant execute on function public.assert_grant_coverage() to service_role;
STUDIOFLOW_EOF

# lib/errors/map.ts (OVERWRITES the Part 2 file — this is the fixed version)
rm -f lib/errors/map.ts
write 'lib/errors/map.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/errors/map.ts
 *
 * Translates everything the database can return into the application's own
 * ErrorCode vocabulary, so that raw Postgres detail never reaches a browser.
 *
 * There are two distinct channels to handle, and confusing them is a common
 * source of silent bugs:
 *
 *   1. A PostgrestError — the request itself failed (RLS denial, constraint
 *      violation, bad SQL). Surfaces as `error` from supabase-js.
 *
 *   2. An RPC envelope — the function RAN and deliberately returned
 *      { ok: false, error_code: 'SESSION_FULL' }. This is a normal business
 *      outcome, not a fault, and `error` is null.
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { isErrorCode, type ErrorCode } from './codes';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';

/** Envelope returned by every core Postgres function in migration 007. */
export type RpcEnvelope = {
  ok?: boolean;
  error_code?: string;
  [key: string]: unknown;
};

/**
 * PostgreSQL SQLSTATE -> ErrorCode.
 *
 * Note that the constraint NAME is used only to distinguish room from
 * instructor conflicts, and is never itself returned to the client.
 */
export function mapPostgresError(error: PostgrestError): ErrorCode {
  const code = error.code ?? '';
  const detail = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();

  switch (code) {
    // unique_violation
    case '23505':
      if (detail.includes('one_confirmed_per_student')) return 'ALREADY_BOOKED';
      if (detail.includes('one_waiting_per_student')) return 'ALREADY_WAITLISTED';
      return 'DUPLICATE_NAME';

    // exclusion_violation — the GiST constraints from migration 003
    case '23P01':
      if (detail.includes('instructor')) return 'INSTRUCTOR_CONFLICT';
      return 'ROOM_CONFLICT';

    // check_violation
    case '23514':
      return 'VALIDATION_FAILED';

    // foreign_key_violation
    case '23503':
      return 'NOT_FOUND';

    // not_null_violation
    case '23502':
      return 'VALIDATION_FAILED';

    // insufficient_privilege — an RLS policy or a REVOKE denied the write
    case '42501':
      return 'FORBIDDEN';

    // PGRST116: "JSON object requested, multiple (or no) rows returned".
    // With RLS this is usually a denied read rather than a missing row, so it
    // is deliberately mapped to NOT_FOUND: telling an attacker "this exists
    // but you may not see it" is itself a disclosure.
    case 'PGRST116':
      return 'NOT_FOUND';

    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Convert a raw supabase-js response into an ActionResult.
 *
 * `extract` maps the successful envelope into the action's payload type, so
 * callers never index into loose `unknown` fields at the call site.
 */
export function fromRpc<T>(
  data: unknown,
  error: PostgrestError | null,
  extract: (env: RpcEnvelope) => T,
): ActionResult<T> {
  if (error) {
    logServerError('rpc', error);
    return fail(mapPostgresError(error));
  }

  if (data === null || typeof data !== 'object') {
    logServerError('rpc', new Error(`Unexpected RPC payload: ${String(data)}`));
    return fail('INTERNAL_ERROR');
  }

  const envelope = data as RpcEnvelope;

  if (envelope.ok !== true) {
    const raw = envelope.error_code;
    // An unrecognised code must NOT be forwarded verbatim — it could carry
    // database detail. Fall back to the generic message and log the specific.
    if (!isErrorCode(raw)) {
      logServerError('rpc', new Error(`Unmapped error_code: ${String(raw)}`));
      return fail('INTERNAL_ERROR');
    }
    return fail(raw);
  }

  return ok(extract(envelope));
}

/** Narrow an envelope field to a string id without unchecked casting. */
export function envString(env: RpcEnvelope, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' ? value : null;
}

export function envBool(env: RpcEnvelope, key: string): boolean {
  return env[key] === true;
}

export function envNumber(env: RpcEnvelope, key: string): number | null {
  const value = env[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Server-side only. Full detail is logged here and NOWHERE else — never
 * returned, never rendered, never placed in a client-visible payload.
 *
 * ==========================================================================
 * WHY THIS DOES NOT JUST `console.error(scope, error)`
 * ==========================================================================
 * PostgrestError extends Error, and Error keeps `message` and `stack` as
 * NON-ENUMERABLE own properties. Anything that serialises by enumerating keys
 * — a structured logger, a log shipper, or the Next.js dev server forwarding
 * server logs to the browser — therefore renders the whole thing as:
 *
 *     [studioflow:getPrimaryStudio] {}
 *
 * An empty object. Every useful field — code, message, hint — silently
 * discarded, leaving a failure that looks like it has no cause.
 *
 * Pulling the fields out EXPLICITLY guarantees they survive serialisation.
 * `code` is the important one: 42501 is a missing GRANT, PGRST205 is a stale
 * schema cache, 23505 is a unique violation. Those point at three completely
 * different fixes, and without the code you are guessing.
 * ==========================================================================
 */
export function logServerError(scope: string, error: unknown): void {
  const prefix = `[studioflow:${scope}]`;

  if (error && typeof error === 'object') {
    const candidate = error as Partial<PostgrestError> & { name?: string };

    // Duck-typed rather than `instanceof`: supabase-js has shipped
    // PostgrestError both as a plain object and as an Error subclass, and a
    // fetch failure produces a third shape again.
    if ('message' in candidate || 'code' in candidate) {
      console.error(prefix, {
        name: candidate.name ?? 'Error',
        code: candidate.code ?? '(none)',
        message: candidate.message ?? '(no message)',
        details: candidate.details ?? null,
        hint: candidate.hint ?? null,
      });

      // A short, actionable note for the failures that are otherwise easy to
      // misdiagnose — each of these has bitten this project at least once.
      const advice = adviseOnPostgresCode(candidate.code);
      if (advice) console.error(`${prefix} HINT: ${advice}`);
      return;
    }
  }

  console.error(prefix, error);
}

/**
 * Maps the error codes that are commonly misread to the fix that resolves them.
 *
 * 42501 in particular is worth calling out. PostgreSQL has TWO independent
 * gates — the GRANT ("may this role touch this table at all?") and RLS ("which
 * rows may it see?"). A policy of USING (true) is irrelevant if the GRANT is
 * missing, because Postgres refuses before any policy is evaluated. Adding
 * more permissive policies then appears to do nothing, which sends people
 * looking in exactly the wrong place.
 */
function adviseOnPostgresCode(code: string | undefined): string | null {
  switch (code) {
    case '42501':
      return 'Permission denied at the GRANT level, before RLS was consulted. Adding policies will not help. Apply migration 010 (explicit table grants), or run: grant select on <table> to anon, authenticated;';
    case '42P01':
      return 'Relation does not exist. Migrations may not have been applied to the database this app is pointed at — check NEXT_PUBLIC_SUPABASE_URL.';
    case 'PGRST205':
    case 'PGRST202':
      return "PostgREST's schema cache is stale. Run: notify pgrst, 'reload schema';  (or restart the API container).";
    case 'PGRST301':
      return 'The JWT was rejected. Check that NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to the project at NEXT_PUBLIC_SUPABASE_URL.';
    case '':
    case undefined:
      return 'Empty error code usually means the request never reached PostgREST — a wrong URL, an unreachable host, or a proxy returning a non-PostgREST body.';
    default:
      return null;
  }
}
STUDIOFLOW_EOF

# scripts/diagnose-db.mjs
write 'scripts/diagnose-db.mjs' << 'STUDIOFLOW_EOF'
#!/usr/bin/env node
/**
 * scripts/diagnose-db.mjs
 *
 * Run:  node scripts/diagnose-db.mjs
 *
 * Bisects a failing data fetch in about ten seconds, by going one layer at a
 * time from "is the env even loaded" to "can anon actually read studios".
 *
 * It talks to PostgREST with plain fetch BEFORE involving supabase-js, so the
 * raw HTTP status and body are visible. That distinction matters: supabase-js
 * normalises errors into a shape whose `message` is non-enumerable, and any
 * logger that serialises by enumerating keys turns the whole thing into `{}`.
 * Raw fetch has no such problem.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

let failures = 0;
const pass = (m) => console.log(`${GREEN}PASS${RESET}  ${m}`);
const fail = (m, fix) => {
  failures += 1;
  console.log(`${RED}FAIL${RESET}  ${m}`);
  if (fix) console.log(`      ${YELLOW}FIX:${RESET} ${fix}`);
};
const info = (m) => console.log(`${DIM}      ${m}${RESET}`);

console.log('\nStudioFlow — database connectivity diagnosis\n');

// ---------------------------------------------------------------------------
// 1. Environment
// ---------------------------------------------------------------------------
const envPath = resolve(process.cwd(), '.env.local');

if (!existsSync(envPath)) {
  fail(
    '.env.local not found in the current directory',
    'It must sit next to package.json. Next.js only reads it from the project root.',
  );
} else {
  pass('.env.local found');
}

const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) {
  fail('NEXT_PUBLIC_SUPABASE_URL is not set', 'Add it to .env.local.');
} else if (url.endsWith('/')) {
  fail(
    `NEXT_PUBLIC_SUPABASE_URL has a trailing slash: ${url}`,
    'Remove it — it produces a double slash in every request path.',
  );
} else {
  pass(`NEXT_PUBLIC_SUPABASE_URL = ${url}`);
}

if (!anonKey) {
  fail('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
} else {
  // A Supabase anon key is a JWT; its payload carries the role and project ref.
  const parts = anonKey.split('.');
  if (parts.length !== 3) {
    fail('The anon key is not a JWT', 'Copy it again from the API settings.');
  } else {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.role !== 'anon') {
        fail(
          `The key in NEXT_PUBLIC_SUPABASE_ANON_KEY has role "${payload.role}", not "anon"`,
          payload.role === 'service_role'
            ? 'You have pasted the SERVICE ROLE key into a NEXT_PUBLIC_ variable. That publishes it to the browser — rotate it immediately.'
            : 'Use the anon/public key.',
        );
      } else {
        pass(`anon key is a valid JWT (role: ${payload.role})`);
      }
      if (payload.ref && url && !url.includes(payload.ref)) {
        fail(
          `Key belongs to project "${payload.ref}" but the URL points elsewhere`,
          'The URL and the key must come from the SAME project.',
        );
      }
    } catch {
      fail('Could not decode the anon key payload');
    }
  }
}

if (!url || !anonKey) {
  console.log(`\n${RED}Stopping — cannot continue without a URL and key.${RESET}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Reachability
// ---------------------------------------------------------------------------
console.log('');
try {
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: anonKey },
  });
  pass(`PostgREST reachable (HTTP ${response.status})`);
} catch (error) {
  fail(
    `Cannot reach ${url}`,
    'Local Supabase not started? Try `supabase start`. On a cloud project, check the URL.',
  );
  info(String(error));
  console.log('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. The exact query getPrimaryStudio() runs — as raw HTTP
// ---------------------------------------------------------------------------
console.log('');
console.log(`${DIM}      Running the getPrimaryStudio() query as anon…${RESET}`);

const query =
  `${url}/rest/v1/studios` +
  `?select=id,name,slug,timezone,cancellation_window_hours,promotion_cutoff_hours` +
  `&order=created_at.asc&limit=1`;

const response = await fetch(query, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
});

const bodyText = await response.text();
let body;
try {
  body = JSON.parse(bodyText);
} catch {
  body = bodyText;
}

if (response.ok) {
  if (Array.isArray(body) && body.length > 0) {
    pass(`studios readable by anon — found "${body[0].name}"`);
    console.log(`\n${GREEN}The database layer is fine.${RESET}`);
    console.log(
      'If the app still shows "No studio is set up yet", the app is not reading',
    );
    console.log(
      'this same .env.local — restart `npm run dev` (env is read at startup only).',
    );
  } else {
    fail(
      'Query succeeded but returned ZERO rows',
      "This IS an RLS block, or the table is empty. Check: select count(*) from public.studios;",
    );
    info(
      'Note: an RLS block returns [] with NO error, so getPrimaryStudio would',
    );
    info('return null WITHOUT logging anything. If you saw a log line, this is');
    info('not your problem.');
  }
} else {
  const code = body?.code ?? '(none)';
  const message = body?.message ?? bodyText.slice(0, 200);

  fail(`HTTP ${response.status} — code ${code}`);
  info(`message: ${message}`);
  if (body?.hint) info(`hint: ${body.hint}`);
  if (body?.details) info(`details: ${body.details}`);

  console.log('');
  switch (code) {
    case '42501':
      console.log(`${YELLOW}DIAGNOSIS: missing GRANT, not an RLS problem.${RESET}`);
      console.log(
        'PostgreSQL checks table privileges BEFORE it evaluates row policies,',
      );
      console.log(
        'so a policy of USING (true) never runs. Adding more policies cannot fix this.',
      );
      console.log('');
      console.log('  Apply migration 010, or as a one-off:');
      console.log('    grant usage on schema public to anon, authenticated;');
      console.log('    grant select on public.studios to anon, authenticated;');
      break;
    case 'PGRST205':
    case 'PGRST202':
      console.log(`${YELLOW}DIAGNOSIS: stale PostgREST schema cache.${RESET}`);
      console.log("    notify pgrst, 'reload schema';");
      console.log('  or restart the API container / `supabase stop && supabase start`.');
      break;
    case '42P01':
      console.log(`${YELLOW}DIAGNOSIS: the table does not exist here.${RESET}`);
      console.log(
        '  Migrations were applied to a DIFFERENT database than the one this URL points at.',
      );
      break;
    case 'PGRST301':
      console.log(`${YELLOW}DIAGNOSIS: the JWT was rejected.${RESET}`);
      console.log('  The anon key does not belong to the project at this URL.');
      break;
    default:
      console.log(`${YELLOW}Look up PostgREST/Postgres code ${code}.${RESET}`);
  }
}

console.log('');
process.exit(failures > 0 ? 1 : 0);
STUDIOFLOW_EOF

chmod +x scripts/diagnose-db.mjs 2>/dev/null || true

echo
echo "-----------------------------------------------------------------"
echo "NEXT STEPS"
echo
echo "1) Apply the migration to your database:"
echo
echo "     supabase db push"
echo "       (or, to rebuild from scratch:  supabase db reset)"
echo
echo "   If you applied the migrations by hand, paste"
echo "   supabase/migrations/20260101000010_grants_fix.sql into the SQL editor."
echo
echo "2) Confirm the fix:"
echo
echo "     node scripts/diagnose-db.mjs"
echo
echo "   It runs the exact getPrimaryStudio() query as anon over raw HTTP and"
echo "   prints the real status code."
echo
echo "3) Restart the dev server. Next.js reads .env.local at STARTUP only:"
echo
echo "     npm run dev"
echo
echo "-----------------------------------------------------------------"
echo "WHY YOUR EXTRA RLS POLICY DID NOT HELP"
echo
echo "PostgreSQL has two independent gates, and both must pass:"
echo
echo "   1. GRANT  — may this role touch the table at all?"
echo "   2. RLS    — which ROWS of it may this role see?"
echo
echo "The GRANT is checked FIRST. With it missing, Postgres refuses before any"
echo "policy is evaluated, so USING (true) never runs."
echo
echo "A useful tell: an RLS block returns ZERO ROWS with NO ERROR. Because"
echo "getPrimaryStudio only logs when error is non-null, the fact that you saw"
echo "a log line at all proved RLS was not the cause."
echo "-----------------------------------------------------------------"
