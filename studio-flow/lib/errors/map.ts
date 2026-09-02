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
 */
export function logServerError(scope: string, error: unknown): void {
  // Replace with a structured logger in production.
  console.error(`[studioflow:${scope}]`, error);
}
