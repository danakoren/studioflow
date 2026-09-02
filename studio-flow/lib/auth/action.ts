/**
 * lib/auth/action.ts
 *
 * The five-stage skeleton, made structural.
 *
 *   1. AUTHENTICATE  getUser() -> reject if no verified session
 *   2. VALIDATE      Zod safeParse -> reject with fieldErrors
 *   3. AUTHORIZE     role / ownership check -> reject FORBIDDEN
 *   4. EXECUTE       RPC or scoped write
 *   5. REVALIDATE    invalidate exactly the affected routes
 *
 * ORDER MATTERS. Validating before authorising means authorisation logic
 * never receives unparsed input. Authorising before executing means invalid
 * callers never reach the database. The database applies RLS regardless —
 * stage 3 exists so failures produce useful messages rather than confusing
 * empty result sets (Detailed Technical Design §4.2).
 *
 * Wrapping the pipeline here rather than repeating it in twenty files means a
 * new action CANNOT accidentally omit a stage, and the security review of this
 * application is a review of this file plus the handlers.
 */

import 'server-only';
import type { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { MemberRole } from '@/lib/types/database.types';
import {
  fail,
  type ActionResult,
  type ActionFailure,
} from '@/lib/types/actions.types';
import { toFieldErrors } from '@/lib/validation/common.schema';
import { logServerError } from '@/lib/errors/map';
import { requireMembership, requireRole, type AuthContext } from './require';

export interface ActionConfig<TSchema extends z.ZodTypeAny, TOut> {
  /** Stage 2 schema. Omit only for actions that take no input. */
  schema: TSchema;
  /** Stage 3. Omitted means "any active member". */
  roles?: MemberRole[];
  /** Stage 4. */
  handler: (args: {
    input: z.infer<TSchema>;
    context: AuthContext;
  }) => Promise<ActionResult<TOut>>;
  /** Stage 5. Static list, or derived from the input and result. */
  revalidate?:
    | string[]
    | ((args: { input: z.infer<TSchema>; result: TOut }) => string[]);
}

export async function runAction<TSchema extends z.ZodTypeAny, TOut>(
  raw: unknown,
  config: ActionConfig<TSchema, TOut>,
): Promise<ActionResult<TOut>> {
  try {
    // ---- Stage 1 + 3: authenticate, then authorise by role ---------------
    const auth = config.roles
      ? await requireRole(...config.roles)
      : await requireMembership();
    if (!auth.ok) return auth;

    // ---- Stage 2: validate --------------------------------------------
    const parsed = config.schema.safeParse(raw);
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', toFieldErrors(parsed.error));
    }
    const input = parsed.data as z.infer<TSchema>;

    // ---- Stage 4: execute ---------------------------------------------
    const result = await config.handler({ input, context: auth.data });
    if (!result.ok) return result;

    // ---- Stage 5: revalidate ------------------------------------------
    const paths =
      typeof config.revalidate === 'function'
        ? config.revalidate({ input, result: result.data })
        : (config.revalidate ?? []);

    // Narrow, never broad. revalidatePath('/', 'layout') would discard the
    // entire route cache on every booking, turning one student's action into a
    // cache miss for everyone (Basic Scaling §4.5).
    for (const path of paths) revalidatePath(path);

    return result;
  } catch (error) {
    // Stage 4 threw: a genuine defect, not an expected outcome. Full detail is
    // logged server-side; the client sees only the generic code.
    logServerError('action', error);
    return fail('INTERNAL_ERROR');
  }
}

/** Type guard used by handlers to propagate a nested failure verbatim. */
export function propagate<T>(result: ActionResult<T>): ActionFailure | null {
  return result.ok ? null : result;
}
