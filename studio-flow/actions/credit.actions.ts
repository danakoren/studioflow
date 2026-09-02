/**
 * actions/credit.actions.ts
 *
 * Credit grants and adjustments. Admin-only, without exception.
 *
 * These actions never write to credit_grants or credit_ledger directly. Both
 * tables are unreachable for a client: students have no write policy at all,
 * and the ledger has no UPDATE or DELETE policy for ANY role including admin.
 * All movement happens inside SECURITY DEFINER functions, so a credit can be
 * caused but never authored.
 *
 * That is what makes the balance non-forgeable. Without it the credit system
 * would be decorative (Basic Security §2.5, tests PR-14/PR-15/PR-40/PR-41).
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { type ActionResult } from '@/lib/types/actions.types';
import { fromRpc, envString, envNumber } from '@/lib/errors/map';
import {
  grantCreditsSchema,
  adjustCreditsSchema,
  type GrantCreditsInput,
  type AdjustCreditsInput,
} from '@/lib/validation/credit.schema';

export interface GrantCreditsResult {
  grantId: string;
  newBalance: number | null;
}

export interface AdjustCreditsResult {
  newBalance: number | null;
}

/**
 * Grant a class package.
 *
 * studentId is a parameter here and that is correct: the ACTOR is the admin
 * from getUser(), and the SUBJECT is another person by design. Authorisation
 * is always on the actor, never the subject. The studio comes from the actor's
 * membership, never from the request — otherwise an admin of Studio B could
 * name Studio A in the payload.
 */
export async function grantCredits(
  input: GrantCreditsInput,
): Promise<ActionResult<GrantCreditsResult>> {
  return runAction(input, {
    schema: grantCreditsSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('grant_credits', {
        p_student_id: value.studentId,
        p_studio_id: context.membership.studioId,
        p_credits: value.credits,
        p_expires_at: value.expiresAt ?? null,
        p_note: value.note ?? null,
      });

      return fromRpc(data, error, (env) => ({
        grantId: envString(env, 'grant_id') ?? '',
        newBalance: envNumber(env, 'new_balance'),
      }));
    },
    revalidate: ({ input }) => [
      '/admin/students',
      `/admin/students/${input.studentId}`,
      '/my/credits',
    ],
  });
}

/**
 * Manual correction. A reason is REQUIRED and is written into the ledger note.
 *
 * Because the ledger is append-only, a correction is a NEW row and the
 * original entry remains visible. An admin cannot rewrite history to conceal
 * an adjustment — the control against an insider (threat T5).
 */
export async function adjustCredits(
  input: AdjustCreditsInput,
): Promise<ActionResult<AdjustCreditsResult>> {
  return runAction(input, {
    schema: adjustCreditsSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('adjust_credits', {
        p_student_id: value.studentId,
        p_studio_id: context.membership.studioId,
        p_delta: value.delta,
        p_reason: value.reason,
      });

      return fromRpc(data, error, (env) => ({
        newBalance: envNumber(env, 'new_balance'),
      }));
    },
    revalidate: ({ input }) => [
      '/admin/students',
      `/admin/students/${input.studentId}`,
      '/my/credits',
    ],
  });
}
