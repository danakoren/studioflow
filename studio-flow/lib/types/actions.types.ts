/**
 * lib/types/actions.types.ts
 *
 * The single result shape returned by EVERY Server Action.
 *
 * Actions never throw for expected failures. A full class, an insufficient
 * balance and a closed attendance window are all normal outcomes that a user
 * must be told about clearly — not exceptions. Throwing is reserved for
 * genuine defects, which reach error.tsx.
 *
 * (Detailed Technical Design §4.1)
 */

import type { ErrorCode } from '@/lib/errors/codes';
import { messageFor } from '@/lib/errors/messages';

export type ActionSuccess<T> = { ok: true; data: T };

export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  /** Zod field-level errors, rendered inline next to the offending input. */
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export function ok(): ActionResult<null>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | null> {
  return { ok: true, data: data ?? null };
}

export function fail(
  code: ErrorCode,
  fieldErrors?: Record<string, string[]>,
): ActionFailure {
  return {
    ok: false,
    code,
    message: messageFor(code),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

/**
 * Narrowing helper so a caller can propagate a failure without TypeScript
 * losing the discriminant:
 *
 *   const auth = await requireMembership();
 *   if (!auth.ok) return auth;      // ActionFailure flows straight through
 */
export function isFailure<T>(r: ActionResult<T>): r is ActionFailure {
  return r.ok === false;
}
