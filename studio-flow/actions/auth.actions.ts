/**
 * actions/auth.actions.ts
 *
 * Session establishment. The counterpart to the registration and sign-out
 * handlers, which live in member.actions.ts because they also write
 * studio_members rows — this file is deliberately limited to the credential
 * exchange itself.
 *
 * ==========================================================================
 * WHY THIS CANNOT USE runAction()
 * ==========================================================================
 * runAction() begins by requiring an authenticated, active member. A visitor
 * signing in is by definition neither, so stages 1 and 3 of the five-stage
 * skeleton do not apply. Stages 2 (validate) and 4 (execute) are performed
 * explicitly below, in that order, exactly as registerStudent() does.
 *
 * Stage 5 (revalidate) is also absent, and that is not an oversight: signing in
 * changes nothing on the server. What changes is which rows RLS will return to
 * this caller, so the CLIENT refreshes its router cache after a success — see
 * the note in components/auth/LoginForm.tsx.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import { logServerError } from '@/lib/errors/map';
import { toFieldErrors } from '@/lib/validation/common.schema';
import { signInSchema } from '@/lib/validation/member.schema';
import {
  safeNextPath,
  CHANGE_PASSWORD_PATH,
} from '@/lib/auth/redirect';

export interface SignInResult {
  /**
   * Where the client should navigate. Resolved SERVER-SIDE and already
   * sanitised, so the browser never decides its own post-login destination
   * from a URL parameter.
   */
  redirectTo: string;
}

/**
 * Email + password sign-in.
 *
 * NOTE ON THE ERROR PATH: every failure mode Supabase can report here — wrong
 * password, no such account, unconfirmed email, rate limited — collapses into
 * one INVALID_CREDENTIALS result. That is a requirement, not laziness
 * (Basic Security §1.5): a message that distinguishes "no such user" from
 * "wrong password" is a user-enumeration oracle, and one that says "confirm
 * your email" confirms an address is registered. The specific reason is logged
 * server-side, where it is useful and invisible.
 */
export async function signIn(
  input: unknown,
  nextPath?: unknown,
): Promise<ActionResult<SignInResult>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', toFieldErrors(parsed.error));
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error || !data.user) {
      logServerError('signIn', error);
      return fail('INVALID_CREDENTIALS');
    }

    // ---- The temporary-password gate (Basic Security §1.6, step 7) --------
    // An instructor still holding the password their admin read out to them is
    // sent to rotate it before anything else becomes reachable.
    //
    // This reads studio_members DIRECTLY rather than through getMembership().
    // getMembership() is wrapped in React cache(), and within this same request
    // getVerifiedUser() may already have resolved to null (there was no session
    // when the action started) — a cached null would make every freshly
    // signed-in instructor look like a non-member.
    const { data: member, error: memberError } = await supabase
      .from('studio_members')
      .select('must_change_password')
      .eq('user_id', data.user.id)
      .eq('is_active', true)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // A failure here must not block a legitimate sign-in: the session is
    // already established, and the /my layout re-checks the same flag before
    // rendering anything. Logged, then treated as "no rotation required".
    if (memberError) logServerError('signIn:membership', memberError);

    if (member?.must_change_password) {
      return ok({ redirectTo: CHANGE_PASSWORD_PATH });
    }

    // Authenticated-but-not-a-member is a real state, not an error: the person
    // exists in auth.users but no admin has added them to a studio yet. They
    // are signed in and sent to the public schedule, where RoleNav renders the
    // reduced navigation for exactly this case.
    return ok({ redirectTo: safeNextPath(nextPath) });
  } catch (error) {
    logServerError('signIn', error);
    return fail('INTERNAL_ERROR');
  }
}
