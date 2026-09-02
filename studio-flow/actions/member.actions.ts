/**
 * actions/member.actions.ts
 *

 * Account creation (admin-only), profile and membership state.
 *
 * NOTE WHAT IS ABSENT: there is no public registration action. Sign-up is
 * admin-driven by product decision, and the old registerStudent() was DELETED
 * rather than unlinked — a Server Action left exported stays a live POST
 * endpoint whether or not any page renders a form for it.
 */

'use server';

import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runAction } from '@/lib/auth/action';
import {
  fail,
  ok,
  type ActionResult,
} from '@/lib/types/actions.types';
import {
  fromRpc,
  mapPostgresError,
  logServerError,
} from '@/lib/errors/map';
import { toFieldErrors } from '@/lib/validation/common.schema';
import { requireMembership, requireUser } from '@/lib/auth/require';
import {
  createStudentSchema,
  createInstructorSchema,
  changePasswordSchema,
  updateProfileSchema,
  setMemberActiveSchema,
  type CreateStudentInput,
  type CreateInstructorInput,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@/lib/validation/member.schema';

export interface CreateInstructorResult {
  userId: string;
  /**
   * Shown to the admin ONCE, in this response.
   *
   * It is never stored in our schema, never written to a log, and never
   * emailed. A temporary password persisted anywhere is a durable credential
   * sitting somewhere it can be read later; returning it once means the only
   * lasting copy is in the admin's memory or handwriting
   * (Basic Security §1.6).
   */
  temporaryPassword: string;
}

export interface CreateStudentResult {
  userId: string;
  fullName: string;
  email: string;
}

/**
 * Admin creates a student account from the front desk or over the phone.
 *
 * ==========================================================================
 * PUBLIC SIGN-UP NO LONGER EXISTS — THIS IS THE ONLY WAY IN
 * ==========================================================================
 * registerStudent() was deleted rather than merely unlinked. A Server Action
 * compiles to a POST endpoint whose id ships in the client bundle, so removing
 * /register would have taken away the form while leaving public account
 * creation fully working for anyone replaying the request. Hiding a door is not
 * locking it.
 *
 * ==========================================================================
 * WHY THE SERVICE CLIENT IS SAFE HERE
 * ==========================================================================
 * This holds a key that bypasses RLS entirely, so what matters is everything
 * that happens BEFORE it is constructed:
 *
 *   1. runAction's stage 1 verifies the session with getUser().
 *   2. Stage 3 reads the caller's role from studio_members, SERVER-SIDE. Not
 *      from a JWT claim, not from the payload.
 *   3. Only then does the handler run and reach createServiceClient().
 *
 * The role written is HARD-CODED to 'student'. It is never read from the
 * request, and createStudentSchema is .strict(), so an injected `role` key is
 * rejected at stage 2 rather than silently dropped — a difference that matters,
 * because silence hides an attack in progress.
 *
 * The studio likewise comes from the ACTOR'S membership, so an admin of one
 * studio cannot create a member in another. RLS would refuse it anyway; relying
 * on the database to catch a mistake the code should not make is worse design.
 *
 * ==========================================================================
 * email_confirm: true IS LOAD-BEARING
 * ==========================================================================
 * This project has email confirmation switched ON (mailer_autoconfirm false).
 * Without this flag the account would be created but UNABLE TO SIGN IN until
 * someone clicked a confirmation link that nobody is going to send — the studio
 * is enrolling this person at the desk, not emailing them. Confirming on their
 * behalf is the whole reason the student can log in immediately.
 *
 * ==========================================================================
 * THE PASSWORD
 * ==========================================================================
 * Validated by passwordSchema (10 characters minimum), handed straight to the
 * Auth API, and never written to our schema, never logged, and never echoed in
 * an error. must_change_password is set because the admin necessarily knows the
 * password they just typed — the student rotates it at first login, which is
 * the same control instructors get (Basic Security §1.6).
 */
export async function createStudent(
  input: CreateStudentInput,
): Promise<ActionResult<CreateStudentResult>> {
  return runAction(input, {
    schema: createStudentSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const service = createServiceClient();

      const { data: created, error: createError } =
        await service.auth.admin.createUser({
          email: value.email,
          password: value.password,
          // See the note above — without this the student cannot sign in.
          email_confirm: true,
          // Read by the handle_new_user() trigger to populate profiles.full_name.
          user_metadata: { full_name: value.fullName },
        });

      if (createError || !created?.user) {
        logServerError('createStudent:createUser', createError);

        /*
         * A duplicate address gets its own message, deliberately.
         *
         * The public sign-up form was scrupulous about NOT revealing whether an
         * email was registered, because an anonymous visitor could have used it
         * to enumerate accounts. This caller is an authenticated admin of the
         * studio, and the useful answer for someone at a front desk is the true
         * one — otherwise they cannot tell a returning client from a typo.
         */
        const code = (createError as { code?: string } | null)?.code;
        const message = createError?.message ?? '';
        if (code === 'email_exists' || /already been registered/i.test(message)) {
          return fail('EMAIL_ALREADY_REGISTERED');
        }

        return fail('VALIDATION_FAILED', {
          email: ['Could not create an account with this email.'],
        });
      }

      const { error: memberError } = await service
        .from('studio_members')
        .insert({
          studio_id: context.membership.studioId,
          user_id: created.user.id,
          // HARD-CODED. Never from the payload.
          role: 'student',
          must_change_password: true,
        });

      if (memberError) {
        logServerError('createStudent:member', memberError);

        /*
         * ROLL BACK THE AUTH USER.
         *
         * Without this the failure leaves an account that exists in Supabase
         * Auth but belongs to no studio: it can sign in, it sees nothing, and it
         * appears in no admin list — so nobody can find it to fix it, and
         * retrying with the same email now fails as a duplicate. The two writes
         * cannot share a transaction (one is the Auth API, one is Postgres), so
         * compensating explicitly is the only way to keep them consistent.
         */
        const { error: rollbackError } = await service.auth.admin.deleteUser(
          created.user.id,
        );
        if (rollbackError) {
          // Now genuinely orphaned. Logged loudly with the id, because this is
          // the one case that needs a human.
          logServerError('createStudent:rollbackFailed', {
            userId: created.user.id,
            rollbackError,
          });
        }

        return fail(mapPostgresError(memberError));
      }

      return ok({
        userId: created.user.id,
        fullName: value.fullName,
        email: value.email,
      });
    },
    revalidate: () => ['/admin', '/admin/students'],
  });
}

/**
 * Admin creates an instructor account with a temporary password.
 *
 * The role is HARD-CODED to 'instructor'. It is never read from the payload —
 * a role accepted from a client request is a privilege-escalation vector.
 */
export async function createInstructor(
  input: CreateInstructorInput,
): Promise<ActionResult<CreateInstructorResult>> {
  return runAction(input, {
    schema: createInstructorSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const service = createServiceClient();

      // 18 random bytes, base64url: ~144 bits of entropy, and short enough to
      // read aloud once.
      const temporaryPassword = randomBytes(18).toString('base64url');

      const { data: created, error: createError } =
        await service.auth.admin.createUser({
          email: value.email,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: value.fullName },
        });

      if (createError || !created.user) {
        logServerError('createInstructor:createUser', createError);
        return fail('VALIDATION_FAILED', {
          email: ['Could not create an account with this email.'],
        });
      }

      const { error: memberError } = await service
        .from('studio_members')
        .insert({
          studio_id: context.membership.studioId,
          user_id: created.user.id,
          role: 'instructor',
          must_change_password: true,
        });

      if (memberError) {
        logServerError('createInstructor:member', memberError);

        // Same compensating delete as createStudent — this path had the same
        // orphaned-auth-user bug. See the long note there for why the two
        // writes cannot share a transaction.
        const { error: rollbackError } = await service.auth.admin.deleteUser(
          created.user.id,
        );
        if (rollbackError) {
          logServerError('createInstructor:rollbackFailed', {
            userId: created.user.id,
            rollbackError,
          });
        }

        return fail(mapPostgresError(memberError));
      }

      return ok({ userId: created.user.id, temporaryPassword });
    },
    revalidate: () => ['/admin/instructors'],
  });
}

/**
 * Change own password, then clear the rotation flag.
 *
 * The flag is cleared by complete_password_rotation(), a SECURITY DEFINER
 * function that touches exactly one boolean on exactly the caller's own row.
 * studio_members has no self-update policy at all, because granting one would
 * let a student set role = 'admin' (test PR-21). A narrow function is the
 * correct way to permit one specific field change without opening the table.
 */
export async function changePassword(
  input: ChangePasswordInput,
): Promise<ActionResult<null>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', toFieldErrors(parsed.error));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });

    if (error) {
      logServerError('changePassword', error);
      return fail('VALIDATION_FAILED', {
        newPassword: ['Could not update the password. Try a different one.'],
      });
    }

    const { data, error: rpcError } = await supabase.rpc(
      'complete_password_rotation',
      {},
    );
    const rotation = fromRpc(data, rpcError, () => null);
    if (!rotation.ok) return rotation;

    return ok(null);
  } catch (error) {
    logServerError('changePassword', error);
    return fail('INTERNAL_ERROR');
  }
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateProfileSchema,
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: value.fullName, phone: value.phone ?? null })
        // RLS already restricts this to the caller's own row; the explicit
        // filter makes the intent legible at the call site.
        .eq('id', context.user.id);

      if (error) {
        logServerError('updateProfile', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/my/profile'],
  });
}

/**
 * Activate or deactivate a member.
 *
 * Nothing is ever hard-deleted. Setting is_active = false makes every RLS
 * helper return false for that person, so an existing valid JWT becomes inert
 * immediately — access revocation does not wait for a session to expire.
 */
export async function setMemberActive(
  memberId: string,
  isActive: boolean,
): Promise<ActionResult<null>> {
  return runAction(
    { memberId, isActive },
    {
      schema: setMemberActiveSchema,
      roles: ['admin'],
      handler: async ({ input, context }) => {
        const supabase = await createClient();
        const { error } = await supabase
          .from('studio_members')
          .update({ is_active: input.isActive })
          .eq('id', input.memberId)
          .eq('studio_id', context.membership.studioId);

        if (error) {
          logServerError('setMemberActive', error);
          return fail(mapPostgresError(error));
        }
        return ok(null);
      },
      revalidate: () => ['/admin/students', '/admin/instructors'],
    },
  );
}

/** Sign out and clear the session cookies. */
export async function signOut(): Promise<ActionResult<null>> {
  const membership = await requireMembership();
  if (!membership.ok && membership.code === 'NOT_AUTHENTICATED') {
    return ok(null); // already signed out; idempotent
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return ok(null);
}
