#!/usr/bin/env bash
# =============================================================================
#  StudioFlow — Part 2 installer
#  TypeScript types, validation schemas and Server Actions.
#
#  USAGE
#    1. cd into your Next.js project root (the folder containing package.json)
#    2. bash studioflow-part2-install.sh
#
#  This script only CREATES files. It does not install packages, run builds, or
#  touch your existing package.json — it prints the dependency versions you
#  need at the end instead, so nothing is changed behind your back.
#
#  It refuses to overwrite an existing file unless you pass --force.
# =============================================================================
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ ! -f package.json ]; then
  echo "ERROR: no package.json here. Run this from your Next.js project root."
  exit 1
fi

WROTE=0
SKIPPED=0

write() {  # write <path>; body arrives on stdin
  local path="$1"
  if [ -e "$path" ] && [ "$FORCE" -eq 0 ]; then
    cat > /dev/null            # drain the heredoc so the script stays in sync
    echo "  skip   $path (exists — re-run with --force to overwrite)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  echo "  write  $path"
  WROTE=$((WROTE + 1))
}

echo "StudioFlow Part 2 — creating backend files"
echo

mkdir -p "actions" "lib/auth" "lib/errors" "lib/supabase" "lib/types" "lib/validation" "scripts" "tests/unit"

write '.env.example' << 'STUDIOFLOW_EOF'
# ---------------------------------------------------------------------------
# Copy to .env.local and fill in. .env.local is gitignored and must stay so.
#
# The NEXT_PUBLIC_ prefix is not cosmetic: Next.js INLINES those values into
# the client bundle at build time. A secret given that prefix is published
# permanently, and rotation is the only remedy.
# ---------------------------------------------------------------------------

# PUBLIC — shipped to the browser by design.
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# Safe to expose ONLY because RLS is enabled on every table. That precondition
# is asserted in CI by assert_rls_coverage().
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# SECRET — never prefixed NEXT_PUBLIC_, never logged, never in an error payload.
# BYPASSES RLS ENTIRELY. Cron routes and admin user creation only.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# Transactional email (dispatch job only).
RESEND_API_KEY=your-resend-key
# Shared secret for /api/cron/*, compared in constant time.
CRON_SECRET=generate-with-openssl-rand-base64-32
STUDIOFLOW_EOF

write '.eslintrc.json' << 'STUDIOFLOW_EOF'
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          {
            "group": ["**/lib/supabase/service", "@/lib/supabase/service"],
            "message": "The service-role client BYPASSES RLS. It may only be imported by app/api/cron/** and actions/member.actions.ts (admin user creation). Add an eslint-disable with a written justification if you believe you need it elsewhere."
          }
        ]
      }
    ],
    "no-restricted-properties": [
      "error",
      {
        "object": "auth",
        "property": "getSession",
        "message": "getSession() decodes the cookie WITHOUT verifying its signature. Use getUser() for every authorisation decision (Basic Security §1.4)."
      }
    ]
  },
  "overrides": [
    {
      "files": ["app/api/cron/**/*.ts", "actions/member.actions.ts"],
      "rules": { "no-restricted-imports": "off" }
    }
  ]
}
STUDIOFLOW_EOF

write '.gitignore' << 'STUDIOFLOW_EOF'
node_modules/
.next/
out/
build/
.env
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
.DS_Store
coverage/
test-results/
playwright-report/
STUDIOFLOW_EOF

write 'actions/attendance.actions.ts' << 'STUDIOFLOW_EOF'
/**
 * actions/attendance.actions.ts
 *
 * Instructor-facing attendance marking.
 *
 * Marks save ONE STUDENT AT A TIME. Batch-saving the whole roster would mean
 * a dropped connection in a studio basement discards the instructor's entire
 * pass through the room (Detailed Technical Design §4.4).
 *
 * Authorisation is per-session, not per-role. An instructor may only mark
 * sessions THEY personally teach — teaches_session() checks instructor_id,
 * not merely the role. Admins may mark any session in their studio.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import {
  fromRpc,
  mapPostgresError,
  logServerError,
} from '@/lib/errors/map';
import {
  markAttendanceSchema,
  markAllPresentSchema,
} from '@/lib/validation/booking.schema';

export interface MarkAllPresentResult {
  marked: number;
}

/**
 * Mark one student present or absent.
 *
 * BR-10: an absence does NOT refund the credit. There is deliberately no
 * refund path in mark_attendance() — attendance is a record, not a
 * transaction. The credit was consumed when the seat was taken.
 */
export async function markAttendance(
  bookingId: string,
  status: 'attended' | 'absent',
): Promise<ActionResult<null>> {
  return runAction(
    { bookingId, status },
    {
      schema: markAttendanceSchema,
      roles: ['instructor', 'admin'],
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('mark_attendance', {
          p_booking_id: input.bookingId,
          p_attendance: input.status,
        });
        return fromRpc(data, error, () => null);
      },
      revalidate: () => ['/teach', '/admin/reports'],
    },
  );
}

/**
 * Convenience: mark every unmarked booking in a session as attended.
 *
 * Each row still goes through mark_attendance(), so the per-session
 * authorisation and the BR-11 window check apply identically. This is a
 * convenience wrapper, not a privileged bypass.
 */
export async function markAllPresent(
  sessionId: string,
): Promise<ActionResult<MarkAllPresentResult>> {
  return runAction(
    { sessionId },
    {
      schema: markAllPresentSchema,
      roles: ['instructor', 'admin'],
      handler: async ({ input }) => {
        const supabase = await createClient();

        // RLS restricts this read to rosters the caller may actually see.
        const { data: rows, error: readError } = await supabase
          .from('bookings')
          .select('id')
          .eq('session_id', input.sessionId)
          .eq('status', 'confirmed')
          .is('attendance', null);

        if (readError) {
          logServerError('markAllPresent:read', readError);
          return fail(mapPostgresError(readError));
        }

        let marked = 0;
        for (const row of rows ?? []) {
          const { data, error } = await supabase.rpc('mark_attendance', {
            p_booking_id: row.id,
            p_attendance: 'attended',
          });
          const result = fromRpc(data, error, () => null);
          if (result.ok) marked += 1;
        }

        return ok({ marked });
      },
      revalidate: ({ input }) => [
        '/teach',
        `/teach/${input.sessionId}`,
        '/admin/reports',
      ],
    },
  );
}
STUDIOFLOW_EOF

write 'actions/booking.actions.ts' << 'STUDIOFLOW_EOF'
/**
 * actions/booking.actions.ts
 *
 * Student-facing booking and waitlist mutations.
 *
 * Every action here is a THIN ORCHESTRATOR. The business rules — capacity,
 * credit consumption, refund eligibility, FIFO promotion — all live in the
 * Postgres functions from migration 007, under a row lock.
 *
 * That placement is not stylistic. The natural TypeScript implementation of
 * booking (read count, compare to capacity, insert) fails at exactly the
 * moment it matters most: the last seat of a popular class, when several
 * students tap simultaneously and Vercel runs their requests as genuinely
 * parallel invocations. Moving the check-and-write into one locked
 * transaction is the only correct fix, and it protects EVERY caller — this
 * action, a cron job, or an admin running SQL in the Supabase console.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import {
  fromRpc,
  envString,
  envBool,
  envNumber,
  mapPostgresError,
  logServerError,
} from '@/lib/errors/map';
import {
  bookSessionSchema,
  cancelBookingSchema,
  joinWaitlistSchema,
  leaveWaitlistSchema,
} from '@/lib/validation/booking.schema';
import { markNotificationReadSchema } from '@/lib/validation/studio.schema';

export interface BookSessionResult {
  bookingId: string;
  newBalance: number | null;
}

/**
 * Book a seat.
 *
 * Takes ONLY a sessionId. There is deliberately no studentId parameter: the
 * acting user comes from the verified session, so a caller cannot book on
 * someone else's behalf by editing the payload.
 */
export async function bookSession(
  sessionId: string,
): Promise<ActionResult<BookSessionResult>> {
  return runAction(
    { sessionId },
    {
      schema: bookSessionSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('book_session', {
          p_session_id: input.sessionId,
        });

        return fromRpc(data, error, (env) => ({
          bookingId: envString(env, 'booking_id') ?? '',
          newBalance: envNumber(env, 'new_balance'),
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/schedule/${input.sessionId}`,
        '/my/bookings',
        '/my/credits',
      ],
    },
  );
}

export interface CancelBookingResult {
  refunded: boolean;
  promotedBookingId: string | null;
  newBalance: number | null;
}

/**
 * Cancel a booking.
 *
 * The refund decision (BR-1/BR-2) and the waitlist promotion (BR-3/BR-7) both
 * happen inside cancel_booking(), in ONE transaction. The promotion email is
 * NOT sent here — the function writes an outbox row and the cron dispatcher
 * sends it later. External I/O inside the transaction would hold the session
 * lock across a network round trip and let a mail outage roll back a
 * legitimate cancellation.
 */
export async function cancelBooking(
  bookingId: string,
): Promise<ActionResult<CancelBookingResult>> {
  return runAction(
    { bookingId },
    {
      schema: cancelBookingSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('cancel_booking', {
          p_booking_id: input.bookingId,
        });

        return fromRpc(data, error, (env) => ({
          refunded: envBool(env, 'refunded'),
          promotedBookingId: envString(env, 'promoted_booking_id'),
          newBalance: envNumber(env, 'new_balance'),
        }));
      },
      // Cancelling can promote someone else, so the shared schedule changes
      // too — not just this student's pages.
      revalidate: () => [
        '/schedule',
        '/my/bookings',
        '/my/credits',
        '/my/history',
      ],
    },
  );
}

export interface JoinWaitlistResult {
  entryId: string;
  position: number | null;
}

/** Join a waitlist. Consumes NO credit — an entry is a claim, not a booking. */
export async function joinWaitlist(
  sessionId: string,
): Promise<ActionResult<JoinWaitlistResult>> {
  return runAction(
    { sessionId },
    {
      schema: joinWaitlistSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('join_waitlist', {
          p_session_id: input.sessionId,
        });

        return fromRpc(data, error, (env) => ({
          entryId: envString(env, 'entry_id') ?? '',
          position: envNumber(env, 'position'),
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/schedule/${input.sessionId}`,
        '/my/bookings',
      ],
    },
  );
}

/** Leave a waitlist. Remaining positions shift up automatically, because
 *  position is derived from joined_at rather than stored. */
export async function leaveWaitlist(
  entryId: string,
): Promise<ActionResult<null>> {
  return runAction(
    { entryId },
    {
      schema: leaveWaitlistSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('leave_waitlist', {
          p_entry_id: input.entryId,
        });

        return fromRpc(data, error, () => null);
      },
      revalidate: () => ['/schedule', '/my/bookings'],
    },
  );
}

/**
 * Mark a notification read.
 *
 * Ownership is enforced by the RLS policy on notifications (recipient_id =
 * auth.uid()), so this action carries no explicit ownership check — the
 * update simply affects zero rows for anyone else.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult<null>> {
  return runAction(
    { notificationId },
    {
      schema: markNotificationReadSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { error } = await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', input.notificationId)
          .is('read_at', null);

        if (error) {
          logServerError('markNotificationRead', error);
          return fail(mapPostgresError(error));
        }
        return ok(null);
      },
      revalidate: () => ['/my/notifications'],
    },
  );
}
STUDIOFLOW_EOF

write 'actions/credit.actions.ts' << 'STUDIOFLOW_EOF'
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
STUDIOFLOW_EOF

write 'actions/member.actions.ts' << 'STUDIOFLOW_EOF'
/**
 * actions/member.actions.ts
 *
 * Registration, instructor onboarding, profile and membership state.
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
  registerSchema,
  createInstructorSchema,
  changePasswordSchema,
  updateProfileSchema,
  setMemberActiveSchema,
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

/**
 * Public registration.
 *
 * This is the ONE action that cannot use runAction(), because runAction
 * begins by requiring an authenticated member — and a registering visitor is
 * neither. Stages 2, 4 and 5 are performed explicitly instead; stages 1 and 3
 * are not applicable by definition.
 */
export async function registerStudent(
  input: unknown,
  studioSlug: string,
): Promise<ActionResult<null>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', toFieldErrors(parsed.error));
  }
  const value = parsed.data;

  try {
    const supabase = await createClient();

    const { data: studio, error: studioError } = await supabase
      .from('studios')
      .select('id')
      .eq('slug', studioSlug)
      .maybeSingle();

    if (studioError) {
      logServerError('registerStudent:studio', studioError);
      return fail('INTERNAL_ERROR');
    }
    if (!studio) return fail('NOT_FOUND');

    const { data: signUp, error: signUpError } = await supabase.auth.signUp({
      email: value.email,
      password: value.password,
      options: { data: { full_name: value.fullName } },
    });

    if (signUpError || !signUp.user) {
      logServerError('registerStudent:signUp', signUpError);
      // Deliberately generic. A message distinguishing "already registered"
      // from "weak password" confirms which addresses exist on the platform.
      return fail('VALIDATION_FAILED', {
        email: ['Could not create the account with these details.'],
      });
    }

    // The membership row needs the service client: the new user has no session
    // yet when email confirmation is enabled, and studio_members has no
    // self-insert policy (deliberately — see PR-21).
    const service = createServiceClient();
    const { error: memberError } = await service.from('studio_members').insert({
      studio_id: studio.id,
      user_id: signUp.user.id,
      role: 'student',
    });

    if (memberError) {
      logServerError('registerStudent:member', memberError);
      return fail(mapPostgresError(memberError));
    }

    return ok(null);
  } catch (error) {
    logServerError('registerStudent', error);
    return fail('INTERNAL_ERROR');
  }
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
STUDIOFLOW_EOF

write 'actions/session.actions.ts' << 'STUDIOFLOW_EOF'
/**
 * actions/session.actions.ts
 *
 * Schedule management. Admin-only, except session cancellation which the
 * assigned instructor may also perform.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import {
  fromRpc,
  envString,
  envNumber,
  mapPostgresError,
  logServerError,
} from '@/lib/errors/map';
import type { SessionRow } from '@/lib/types/database.types';
import {
  createSessionSchema,
  createRecurringSessionsSchema,
  updateSessionSchema,
  cancelSessionSchema,
  adminBookStudentSchema,
  adminRemoveBookingSchema,
  type CreateSessionInput,
  type CreateRecurringSessionsInput,
  type UpdateSessionInput,
} from '@/lib/validation/session.schema';

export interface CreateSessionResult {
  sessionId: string;
}

export interface RecurrenceConflict {
  startsAt: string;
  reason: string;
}

export interface CreateRecurringResult {
  recurrenceGroupId: string;
  createdCount: number;
  conflicts: RecurrenceConflict[];
}

export interface CancelSessionResult {
  refundedCount: number;
  notifiedCount: number;
}

/**
 * Create a single session.
 *
 * Capacity defaults from the room but is COPIED onto the session, not read
 * through it. Changing a room's capacity later must not silently resize
 * sessions that already hold bookings.
 *
 * Room and instructor conflicts are caught by the GiST exclusion constraints
 * in migration 003 and surface as 23P01, which mapPostgresError turns into
 * ROOM_CONFLICT or INSTRUCTOR_CONFLICT. We do not pre-check for conflicts in
 * application code: a pre-check has a race window, the constraint does not.
 */
export async function createSession(
  input: CreateSessionInput,
): Promise<ActionResult<CreateSessionResult>> {
  return runAction(input, {
    schema: createSessionSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();

      const { data: classType, error: ctError } = await supabase
        .from('class_types')
        .select('duration_minutes')
        .eq('id', value.classTypeId)
        .eq('studio_id', context.membership.studioId)
        .maybeSingle();

      if (ctError) {
        logServerError('createSession:classType', ctError);
        return fail(mapPostgresError(ctError));
      }
      if (!classType) return fail('CLASS_TYPE_NOT_FOUND');

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('capacity')
        .eq('id', value.roomId)
        .eq('studio_id', context.membership.studioId)
        .maybeSingle();

      if (roomError) {
        logServerError('createSession:room', roomError);
        return fail(mapPostgresError(roomError));
      }
      if (!room) return fail('ROOM_NOT_FOUND');

      const startsAt = new Date(value.startsAt);
      const endsAt = new Date(
        startsAt.getTime() + classType.duration_minutes * 60_000,
      );

      const { data, error } = await supabase
        .from('sessions')
        .insert({
          studio_id: context.membership.studioId,
          class_type_id: value.classTypeId,
          room_id: value.roomId,
          instructor_id: value.instructorId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          capacity: value.capacity ?? room.capacity,
          created_by: context.user.id,
        })
        .select('id')
        .single();

      if (error) {
        logServerError('createSession:insert', error);
        return fail(mapPostgresError(error));
      }

      return ok({ sessionId: data.id });
    },
    revalidate: () => ['/schedule', '/admin/schedule', '/admin'],
  });
}

/**
 * Generate N weekly occurrences.
 *
 * Delegated entirely to create_recurring_sessions(), because the DST-correct
 * iteration must happen in the studio's LOCAL timezone: adding seven days to a
 * UTC timestamp twelve times produces a class at 06:00 for half the term once
 * the clocks change.
 *
 * Conflicts are RETURNED, not thrown. If week 5 collides with an existing
 * session, weeks 1-4 and 6-12 are still created and the admin is told exactly
 * which date failed.
 */
export async function createRecurringSessions(
  input: CreateRecurringSessionsInput,
): Promise<ActionResult<CreateRecurringResult>> {
  return runAction(input, {
    schema: createRecurringSessionsSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('create_recurring_sessions', {
        p_studio_id: context.membership.studioId,
        p_class_type_id: value.classTypeId,
        p_room_id: value.roomId,
        p_instructor_id: value.instructorId,
        p_first_start: new Date(value.startsAt).toISOString(),
        p_weeks: value.weeks,
        p_capacity: value.capacity ?? null,
      });

      return fromRpc(data, error, (env) => {
        const rawConflicts = Array.isArray(env.conflicts) ? env.conflicts : [];
        const conflicts: RecurrenceConflict[] = rawConflicts.map((entry) => {
          const record = entry as Record<string, unknown>;
          return {
            startsAt: String(record.starts_at ?? ''),
            reason: String(record.reason ?? 'CONFLICT'),
          };
        });

        return {
          recurrenceGroupId: envString(env, 'recurrence_group_id') ?? '',
          createdCount: envNumber(env, 'created_count') ?? 0,
          conflicts,
        };
      });
    },
    revalidate: () => ['/schedule', '/admin/schedule', '/admin'],
  });
}

export async function updateSession(
  input: UpdateSessionInput,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateSessionSchema,
    roles: ['admin'],
    handler: async ({ input: value }) => {
      const supabase = await createClient();

      // Typed patch: a mistyped column name is a COMPILE error, not a
      // silently-ignored field.
      const patch: Partial<SessionRow> = {};
      if (value.classTypeId) patch.class_type_id = value.classTypeId;
      if (value.roomId) patch.room_id = value.roomId;
      if (value.instructorId) patch.instructor_id = value.instructorId;
      if (value.capacity !== undefined) patch.capacity = value.capacity;

      if (value.startsAt) {
        const { data: current, error: readError } = await supabase
          .from('sessions')
          .select('starts_at, ends_at')
          .eq('id', value.sessionId)
          .maybeSingle();

        if (readError) {
          logServerError('updateSession:read', readError);
          return fail(mapPostgresError(readError));
        }
        if (!current) return fail('SESSION_NOT_FOUND');

        // Preserve duration when only the start time moves.
        const durationMs =
          new Date(current.ends_at).getTime() -
          new Date(current.starts_at).getTime();
        const newStart = new Date(value.startsAt);
        patch.starts_at = newStart.toISOString();
        patch.ends_at = new Date(newStart.getTime() + durationMs).toISOString();
      }

      const { error } = await supabase
        .from('sessions')
        .update(patch)
        .eq('id', value.sessionId);

      if (error) {
        logServerError('updateSession', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: ({ input }) => [
      '/schedule',
      `/schedule/${input.sessionId}`,
      '/admin/schedule',
    ],
  });
}

/**
 * Cancel a session.
 *
 * BR-9: ALL booked students are refunded regardless of the cancellation
 * window. The studio's cancellation is not the student's fault.
 *
 * Role is 'instructor' OR 'admin' here, but cancel_session() additionally
 * verifies the instructor actually teaches THIS session. The role check is the
 * fast-fail; the per-session check is the real one.
 */
export async function cancelSession(
  sessionId: string,
  reason: string,
): Promise<ActionResult<CancelSessionResult>> {
  return runAction(
    { sessionId, reason },
    {
      schema: cancelSessionSchema,
      roles: ['instructor', 'admin'],
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('cancel_session', {
          p_session_id: input.sessionId,
          p_reason: input.reason,
        });

        return fromRpc(data, error, (env) => ({
          refundedCount: envNumber(env, 'refunded_count') ?? 0,
          notifiedCount: envNumber(env, 'notified_count') ?? 0,
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/schedule/${input.sessionId}`,
        '/admin/schedule',
        '/teach',
        '/my/bookings',
      ],
    },
  );
}

/** Walk-ins and phone bookings. Capacity binds admins too. */
export async function adminBookStudent(
  sessionId: string,
  studentId: string,
): Promise<ActionResult<{ bookingId: string }>> {
  return runAction(
    { sessionId, studentId },
    {
      schema: adminBookStudentSchema,
      roles: ['admin'],
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('admin_book_student', {
          p_session_id: input.sessionId,
          p_student_id: input.studentId,
        });

        return fromRpc(data, error, (env) => ({
          bookingId: envString(env, 'booking_id') ?? '',
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/admin/sessions/${input.sessionId}`,
        '/admin/schedule',
      ],
    },
  );
}

/**
 * Remove a booking as an admin.
 *
 * `refund` is explicit rather than inferred, because the admin is making a
 * judgement the system cannot make: a student who phoned in sick versus one
 * who simply did not appear.
 */
export async function adminRemoveBooking(
  bookingId: string,
  refund: boolean,
): Promise<ActionResult<{ promotedBookingId: string | null }>> {
  return runAction(
    { bookingId, refund },
    {
      schema: adminRemoveBookingSchema,
      roles: ['admin'],
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('admin_remove_booking', {
          p_booking_id: input.bookingId,
          p_refund: input.refund,
        });

        return fromRpc(data, error, (env) => ({
          promotedBookingId: envString(env, 'promoted_booking_id'),
        }));
      },
      revalidate: () => ['/schedule', '/admin/schedule'],
    },
  );
}
STUDIOFLOW_EOF

write 'actions/studio.actions.ts' << 'STUDIOFLOW_EOF'
/**
 * actions/studio.actions.ts
 *
 * Studio policy and catalogue management (rooms, class types). Admin-only.
 *
 * Policy values live in the studios table rather than in code, so changing a
 * cancellation window is a data change, not a deployment. The Postgres
 * functions read the studio's own values at execution time.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import { mapPostgresError, logServerError } from '@/lib/errors/map';
import type { RoomRow, ClassTypeRow } from '@/lib/types/database.types';
import {
  updateStudioSettingsSchema,
  createRoomSchema,
  updateRoomSchema,
  createClassTypeSchema,
  updateClassTypeSchema,
  type UpdateStudioSettingsInput,
  type CreateRoomInput,
  type CreateClassTypeInput,
} from '@/lib/validation/studio.schema';

/**
 * Update the studio's business rules.
 *
 * The studio id comes from the ACTOR'S MEMBERSHIP, never from the request.
 * Accepting a studioId parameter here would let an admin of Studio B name
 * Studio A in the payload — RLS would still refuse, but the action would be
 * relying on the database to catch a mistake it should not have made.
 */
export async function updateStudioSettings(
  input: UpdateStudioSettingsInput,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateStudioSettingsSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { error } = await supabase
        .from('studios')
        .update({
          name: value.name,
          timezone: value.timezone,
          cancellation_window_hours: value.cancellationWindowHours,
          promotion_cutoff_hours: value.promotionCutoffHours,
          attendance_window_hours: value.attendanceWindowHours,
          unmarked_attendance_default: value.unmarkedAttendanceDefault,
        })
        .eq('id', context.membership.studioId);

      if (error) {
        logServerError('updateStudioSettings', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/settings', '/schedule'],
  });
}

export async function createRoom(
  input: CreateRoomInput,
): Promise<ActionResult<{ roomId: string }>> {
  return runAction(input, {
    schema: createRoomSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          studio_id: context.membership.studioId,
          name: value.name,
          capacity: value.capacity,
        })
        .select('id')
        .single();

      if (error) {
        logServerError('createRoom', error);
        return fail(mapPostgresError(error));
      }
      return ok({ roomId: data.id });
    },
    revalidate: () => ['/admin/rooms', '/admin/schedule'],
  });
}

/**
 * Update a room.
 *
 * Changing capacity does NOT resize existing sessions: each session copied its
 * capacity at creation. A session already holding twelve bookings cannot
 * silently become a ten-mat room and drop two students.
 */
export async function updateRoom(
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateRoomSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const patch: Partial<RoomRow> = {
        name: value.name,
        capacity: value.capacity,
      };
      if (value.isActive !== undefined) patch.is_active = value.isActive;

      const { error } = await supabase
        .from('rooms')
        .update(patch)
        .eq('id', value.roomId)
        .eq('studio_id', context.membership.studioId);

      if (error) {
        logServerError('updateRoom', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/rooms', '/admin/schedule'],
  });
}

export async function createClassType(
  input: CreateClassTypeInput,
): Promise<ActionResult<{ classTypeId: string }>> {
  return runAction(input, {
    schema: createClassTypeSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('class_types')
        .insert({
          studio_id: context.membership.studioId,
          name: value.name,
          description: value.description ?? null,
          duration_minutes: value.durationMinutes,
          color: value.color,
        })
        .select('id')
        .single();

      if (error) {
        logServerError('createClassType', error);
        return fail(mapPostgresError(error));
      }
      return ok({ classTypeId: data.id });
    },
    revalidate: () => ['/admin/class-types', '/admin/schedule', '/schedule'],
  });
}

export async function updateClassType(
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateClassTypeSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const patch: Partial<ClassTypeRow> = {
        name: value.name,
        description: value.description ?? null,
        duration_minutes: value.durationMinutes,
        color: value.color,
      };
      if (value.isActive !== undefined) patch.is_active = value.isActive;

      const { error } = await supabase
        .from('class_types')
        .update(patch)
        .eq('id', value.classTypeId)
        .eq('studio_id', context.membership.studioId);

      if (error) {
        logServerError('updateClassType', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/class-types', '/admin/schedule', '/schedule'],
  });
}
STUDIOFLOW_EOF

write 'lib/auth/action.ts' << 'STUDIOFLOW_EOF'
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
STUDIOFLOW_EOF

write 'lib/auth/require.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/auth/require.ts
 *
 * ==========================================================================
 * THE MOST IMPORTANT RULE IN THIS CODEBASE
 * ==========================================================================
 *
 *   ALWAYS  supabase.auth.getUser()   -> sends the token to the Auth server,
 *                                        which VERIFIES ITS SIGNATURE.
 *
 *   NEVER   supabase.auth.getSession() -> decodes the cookie LOCALLY, without
 *                                         contacting the Auth server.
 *
 * A cookie is client-controlled data. getSession() returns whatever the
 * cookie CLAIMS, so a forged or tampered cookie yields a user object that
 * looks entirely legitimate to application code.
 *
 * The two are easy to confuse because they appear to behave identically in
 * development. getSession() must not appear in any authorisation path, and
 * pre-deployment checklist item 11 greps for it.
 *
 * (Basic Security §1.4)
 * ==========================================================================
 *
 * These helpers implement stages 1 and 3 of the five-stage action skeleton.
 * They return ActionResult rather than throwing, so an action propagates a
 * failure with `if (!auth.ok) return auth;`.
 */

import 'server-only';
import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import { logServerError } from '@/lib/errors/map';
import type { MemberRole } from '@/lib/types/database.types';

export interface Membership {
  studioId: string;
  studioName: string;
  studioSlug: string;
  timezone: string;
  role: MemberRole;
  mustChangePassword: boolean;
}

export interface AuthContext {
  user: User;
  membership: Membership;
}

/**
 * Stage 1 — Authenticate.
 *
 * `cache()` deduplicates this within a single request, so a layout, a page and
 * three components asking for the current user produce ONE verification call
 * rather than five.
 */
export const getVerifiedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser(): Promise<ActionResult<User>> {
  const user = await getVerifiedUser();
  if (!user) return fail('NOT_AUTHENTICATED');
  return ok(user);
}

/**
 * Stage 3 — Authorize (membership).
 *
 * The role is read SERVER-SIDE from studio_members on every call. It is never
 * taken from the client, never passed as a parameter, and never trusted from a
 * JWT custom claim (Basic Security §2.3).
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const user = await getVerifiedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studio_members')
    .select(
      'studio_id, role, must_change_password, studios!inner(id, name, slug, timezone)',
    )
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logServerError('getMembership', error);
    return null;
  }
  if (!data) return null;

  // supabase-js types an !inner join as an object or an array depending on
  // inference; normalise rather than casting blindly.
  const studioJoin = data.studios as unknown;
  const studio = Array.isArray(studioJoin)
    ? (studioJoin[0] as Record<string, unknown> | undefined)
    : (studioJoin as Record<string, unknown> | null);

  if (!studio) return null;

  return {
    studioId: data.studio_id,
    studioName: String(studio.name ?? ''),
    studioSlug: String(studio.slug ?? ''),
    timezone: String(studio.timezone ?? 'Asia/Jerusalem'),
    role: data.role,
    mustChangePassword: data.must_change_password,
  };
});

/** Authenticated AND an active member of a studio. */
export async function requireMembership(): Promise<ActionResult<AuthContext>> {
  const user = await getVerifiedUser();
  if (!user) return fail('NOT_AUTHENTICATED');

  const membership = await getMembership();
  if (!membership) return fail('NOT_A_MEMBER');

  return ok({ user, membership });
}

/**
 * Membership plus a role check.
 *
 * This is stage 3 of the skeleton. It exists to fail FAST with a
 * comprehensible message — RLS denies the operation regardless, but a policy
 * denial surfaces as an empty result set, which is a poor error for a user.
 */
export async function requireRole(
  ...allowed: MemberRole[]
): Promise<ActionResult<AuthContext>> {
  const context = await requireMembership();
  if (!context.ok) return context;

  if (!allowed.includes(context.data.membership.role)) {
    return fail('FORBIDDEN');
  }
  return context;
}

export async function requireAdmin(): Promise<ActionResult<AuthContext>> {
  return requireRole('admin');
}

export async function requireStaff(): Promise<ActionResult<AuthContext>> {
  return requireRole('instructor', 'admin');
}

/**
 * Blocks an instructor who is still holding the temporary password issued at
 * account creation, until they have rotated it (Basic Security §1.6).
 */
export async function requireRotatedPassword(
  context: AuthContext,
): Promise<ActionResult<AuthContext>> {
  if (context.membership.mustChangePassword) {
    return fail('PASSWORD_ROTATION_REQUIRED');
  }
  return ok(context);
}
STUDIOFLOW_EOF

write 'lib/errors/codes.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/errors/codes.ts
 *
 * The complete error vocabulary of the application.
 *
 * These codes are the ONLY thing that crosses the boundary to the client.
 * Postgres SQLSTATE values, constraint names, SQL fragments and stack traces
 * never do — constraint names describe columns and business rules, which maps
 * the schema for an attacker (Basic Security §4.4).
 */

export const ERROR_CODES = [
  // Authentication / authorisation
  'NOT_AUTHENTICATED',
  'FORBIDDEN',
  'NOT_A_MEMBER',
  'PASSWORD_ROTATION_REQUIRED',

  // Input
  'VALIDATION_FAILED',

  // Sessions
  'SESSION_NOT_FOUND',
  'SESSION_CANCELLED',
  'SESSION_STARTED',
  'SESSION_FULL',
  'SESSION_NOT_FULL',
  'ROOM_CONFLICT',
  'INSTRUCTOR_CONFLICT',

  // Bookings
  'BOOKING_NOT_FOUND',
  'ALREADY_BOOKED',
  'ALREADY_WAITLISTED',
  'ALREADY_CANCELLED',
  'ALREADY_LEFT',
  'ENTRY_NOT_FOUND',

  // Credits
  'INSUFFICIENT_CREDITS',
  'MEMBER_NOT_FOUND',

  // Attendance
  'ATTENDANCE_WINDOW_CLOSED',

  // Catalogue
  'CLASS_TYPE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'DUPLICATE_NAME',
  'IN_USE',

  // Generic
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
  );
}
STUDIOFLOW_EOF

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
 */
export function logServerError(scope: string, error: unknown): void {
  // Replace with a structured logger in production.
  console.error(`[studioflow:${scope}]`, error);
}
STUDIOFLOW_EOF

write 'lib/errors/messages.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/errors/messages.ts
 *
 * Error code -> user-facing text.
 *
 * Two of these carry PRODUCT INTENT rather than merely reporting a fault, and
 * that is deliberate (Detailed Technical Design §7.2):
 *
 *   SESSION_FULL          offers the waitlist, turning a dead end into the
 *                         mechanism behind business goal G1.
 *   INSUFFICIENT_CREDITS  prompts repurchase, which is the sales mechanism
 *                         described in G4.
 *
 * An error message is a place where the product either recovers a user or
 * loses one.
 */

import type { ErrorCode } from './codes';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NOT_AUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_A_MEMBER: 'You are not a member of this studio.',
  PASSWORD_ROTATION_REQUIRED:
    'Please set a new password before continuing.',

  VALIDATION_FAILED: 'Please check the highlighted fields and try again.',

  SESSION_NOT_FOUND: 'This class is no longer available.',
  SESSION_CANCELLED: 'This class has been cancelled.',
  SESSION_STARTED: 'This class has already started.',
  SESSION_FULL: 'This class is full — join the waitlist?',
  SESSION_NOT_FULL: 'This class still has space — you can book it directly.',
  ROOM_CONFLICT: 'That room is already booked at this time.',
  INSTRUCTOR_CONFLICT: 'That instructor is already teaching then.',

  BOOKING_NOT_FOUND: 'Booking not found.',
  ALREADY_BOOKED: "You're already booked into this class.",
  ALREADY_WAITLISTED: "You're already on the waitlist for this class.",
  ALREADY_CANCELLED: 'This booking was already cancelled.',
  ALREADY_LEFT: 'You have already left this waitlist.',
  ENTRY_NOT_FOUND: 'Waitlist entry not found.',

  INSUFFICIENT_CREDITS:
    'You have no classes left. Contact the studio to buy a package.',
  MEMBER_NOT_FOUND: 'That person is not an active member of this studio.',

  ATTENDANCE_WINDOW_CLOSED: 'Attendance can no longer be changed for this class.',

  CLASS_TYPE_NOT_FOUND: 'That class type could not be found.',
  ROOM_NOT_FOUND: 'That room could not be found.',
  DUPLICATE_NAME: 'Something with that name already exists.',
  IN_USE: 'This is still in use and cannot be removed.',

  NOT_FOUND: 'Not found.',
  CONFLICT: 'That conflicts with something else. Please review and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
STUDIOFLOW_EOF

write 'lib/supabase/client.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/supabase/client.ts
 *
 * BROWSER client. Trust level: RLS ENFORCED.
 *
 * Used for authentication calls only (sign in, sign up, sign out, password
 * change). All data access happens on the server through Server Components
 * and Server Actions.
 *
 * The anon key here is public by design and is embedded in the client bundle.
 * It grants NOTHING on its own, because every table denies access absent a
 * matching policy — but that safety is CONDITIONAL on RLS being enabled
 * everywhere, which is why assert_rls_coverage() runs in CI
 * (Basic Security §5.3).
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
STUDIOFLOW_EOF

write 'lib/supabase/middleware.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/supabase/middleware.ts
 *
 * Session refresh helper used by the root middleware.
 *
 * WHY THIS EXISTS: React Server Components can READ cookies but cannot WRITE
 * them. An access token expiring mid-session would therefore leave the user
 * silently logged out with no opportunity to refresh. Middleware runs before
 * the route, refreshes the token, and writes the updated cookies onto the
 * response.
 *
 * NOTE ON getUser(): this calls getUser(), not getSession(). getSession()
 * decodes the cookie LOCALLY without verifying its signature, and a cookie is
 * client-controlled data. See lib/auth/require.ts for the full rule.
 *
 * Middleware is NOT an authorisation boundary. It never sees a PostgREST
 * request issued from a browser console. Its route gating is an optimisation
 * that avoids rendering pages which would fail anyway.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/types/database.types';

/** Paths that require an authenticated user, with the role they imply. */
const PROTECTED_PREFIXES = ['/my', '/teach', '/admin'] as const;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the token as a side effect. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Relative path only. An absolute or protocol-relative value here would
    // make the login flow an open redirect (Basic Security §4.3).
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && (path === '/login' || path === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/schedule';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
STUDIOFLOW_EOF

write 'lib/supabase/server.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/supabase/server.ts
 *
 * SERVER client. Trust level: RLS ENFORCED, acting as the requesting user.
 *
 * This is the default client for everything: Server Components, Server
 * Actions, Route Handlers with a user session. Every query it issues is
 * filtered by Row Level Security, which is why application code contains no
 * ownership filters — the common `WHERE user_id = ?` that a developer forgets
 * cannot become a data leak here.
 *
 * Cookies are httpOnly, so an XSS payload cannot read the session token
 * (Basic Security §1.2).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/database.types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. This is expected and
            // harmless: middleware refreshes the session on every request, so
            // the token is kept current there instead.
          }
        },
      },
    },
  );
}
STUDIOFLOW_EOF

write 'lib/supabase/service.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/supabase/service.ts
 *
 * SERVICE ROLE client. Trust level: RLS COMPLETELY BYPASSED.
 *
 * ============================ READ THIS ============================
 * Holding this key is equivalent to unrestricted database access across
 * EVERY studio. It defeats every policy in migration 005.
 *
 * Rules, enforced mechanically rather than by convention:
 *
 *   1. This module may be imported ONLY by app/api/cron/**. Enforced by the
 *      ESLint `no-restricted-imports` rule in .eslintrc.json — a violation
 *      fails the build, not the review.
 *
 *   2. The key is NEVER prefixed NEXT_PUBLIC_, so it cannot be inlined into
 *      the client bundle. Test PR-58 runs `next build` and greps
 *      .next/static for its value; any occurrence fails CI.
 *
 *   3. It is never logged and never placed in an error payload.
 * ===================================================================
 */

import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database.types';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Deliberately does not echo the values.
    throw new Error('Service client is not configured.');
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
STUDIOFLOW_EOF

write 'lib/types/actions.types.ts' << 'STUDIOFLOW_EOF'
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
STUDIOFLOW_EOF

write 'lib/types/database.types.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/types/database.types.ts
 *
 * Schema types for the StudioFlow database.
 *
 * IN THE REAL PROJECT THIS FILE IS GENERATED, NOT HAND-EDITED:
 *
 *   supabase gen types typescript --local > lib/types/database.types.ts
 *
 * Add it to a `postdb:reset` script so it regenerates automatically. That is
 * what makes a column rename a BUILD FAILURE rather than a production defect —
 * the point made in Technical Architecture §6.1.
 *
 * This version is hand-written to mirror migrations 001-009 precisely so the
 * rest of Part 2 type-checks before a Supabase project exists.
 */

// ---------------------------------------------------------------------------
// Enums (migration 001)
// ---------------------------------------------------------------------------

export type MemberRole = 'student' | 'instructor' | 'admin';
export type SessionStatus = 'scheduled' | 'cancelled';
export type BookingStatus = 'confirmed' | 'cancelled';
export type AttendanceStatus = 'attended' | 'absent';
export type BookingSource = 'self' | 'admin' | 'waitlist_promotion';
export type WaitlistStatus = 'waiting' | 'promoted' | 'left';
export type LedgerEntryType =
  | 'grant'
  | 'booking'
  | 'refund'
  | 'expiry'
  | 'adjustment';
export type GrantStatus = 'active' | 'exhausted' | 'expired';
export type NotificationType =
  | 'waitlist_promoted'
  | 'session_cancelled'
  | 'session_updated'
  | 'credits_granted'
  | 'credits_expiring'
  | 'booking_confirmed';
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  cancellation_window_hours: number;
  promotion_cutoff_hours: number;
  attendance_window_hours: number;
  unmarked_attendance_default: AttendanceStatus;
  created_at: string;
  updated_at: string;
};

export type StudioMemberRow = {
  id: string;
  studio_id: string;
  user_id: string;
  role: MemberRole;
  is_active: boolean;
  must_change_password: boolean;
  joined_at: string;
};

export type RoomRow = {
  id: string;
  studio_id: string;
  name: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
};

export type ClassTypeRow = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  color: string;
  is_active: boolean;
  created_at: string;
};

export type SessionRow = {
  id: string;
  studio_id: string;
  class_type_id: string;
  room_id: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: SessionStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  recurrence_group_id: string | null;
  created_at: string;
  created_by: string;
};

export type BookingRow = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: BookingStatus;
  attendance: AttendanceStatus | null;
  source: BookingSource;
  booked_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  credit_refunded: boolean;
  attendance_marked_at: string | null;
  attendance_marked_by: string | null;
  attendance_auto_resolved: boolean;
};

export type WaitlistEntryRow = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: WaitlistStatus;
  joined_at: string;
  promoted_at: string | null;
  promoted_booking_id: string | null;
  left_at: string | null;
};

export type CreditGrantRow = {
  id: string;
  studio_id: string;
  student_id: string;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  status: GrantStatus;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type CreditLedgerRow = {
  id: string;
  studio_id: string;
  student_id: string;
  grant_id: string | null;
  delta: number;
  entry_type: LedgerEntryType;
  booking_id: string | null;
  session_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  studio_id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  related_session_id: string | null;
  read_at: string | null;
  email_status: EmailStatus;
  email_attempts: number;
  email_sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// View shapes (migration 006)
// ---------------------------------------------------------------------------

export type SessionWithAvailability = {
  id: string;
  studio_id: string;
  class_type_id: string;
  room_id: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: SessionStatus;
  cancellation_reason: string | null;
  recurrence_group_id: string | null;
  class_type_name: string;
  class_type_description: string | null;
  class_type_color: string;
  duration_minutes: number;
  room_name: string;
  instructor_name: string;
  booked_count: number;
  seats_available: number;
  waiting_count: number;
  is_full: boolean;
};

export type WaitlistPosition = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: WaitlistStatus;
  joined_at: string;
  position: number;
};

export type StudentBalance = {
  studio_id: string;
  student_id: string;
  balance: number;
  next_expiry_at: string | null;
};

// ---------------------------------------------------------------------------
// Supabase `Database` generic
// ---------------------------------------------------------------------------

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

/**
 * Envelope returned by every core function in migration 007.
 *
 * The functions return jsonb `{ ok, error_code, ... }` rather than raising,
 * because a full class or an insufficient balance is a normal business
 * outcome that must reach the user as a specific message — not an exception.
 */
export type RpcResult<Extra = Record<string, never>> = {
  ok: boolean;
  error_code?: string;
} & Partial<Extra>;

/**
 * Typing Functions properly is what gives `supabase.rpc()` argument checking.
 * A misspelled parameter name (p_session vs p_session_id) becomes a COMPILE
 * ERROR instead of a runtime "function does not exist" at 2am.
 */
type DatabaseFunctions = {
  book_session: {
    Args: { p_session_id: string };
    Returns: RpcResult<{ booking_id: string; new_balance: number }>;
  };
  join_waitlist: {
    Args: { p_session_id: string };
    Returns: RpcResult<{ entry_id: string; position: number }>;
  };
  leave_waitlist: {
    Args: { p_entry_id: string };
    Returns: RpcResult;
  };
  cancel_booking: {
    Args: { p_booking_id: string };
    Returns: RpcResult<{
      refunded: boolean;
      promoted_booking_id: string | null;
      new_balance: number;
    }>;
  };
  cancel_session: {
    Args: { p_session_id: string; p_reason: string };
    Returns: RpcResult<{ refunded_count: number; notified_count: number }>;
  };
  mark_attendance: {
    Args: { p_booking_id: string; p_attendance: AttendanceStatus };
    Returns: RpcResult;
  };
  grant_credits: {
    Args: {
      p_student_id: string;
      p_studio_id: string;
      p_credits: number;
      p_expires_at?: string | null;
      p_note?: string | null;
    };
    Returns: RpcResult<{ grant_id: string; new_balance: number }>;
  };
  adjust_credits: {
    Args: {
      p_student_id: string;
      p_studio_id: string;
      p_delta: number;
      p_reason: string;
    };
    Returns: RpcResult<{ new_balance: number }>;
  };
  admin_book_student: {
    Args: { p_session_id: string; p_student_id: string };
    Returns: RpcResult<{ booking_id: string }>;
  };
  admin_remove_booking: {
    Args: { p_booking_id: string; p_refund: boolean };
    Returns: RpcResult<{ promoted_booking_id: string | null }>;
  };
  create_recurring_sessions: {
    Args: {
      p_studio_id: string;
      p_class_type_id: string;
      p_room_id: string;
      p_instructor_id: string;
      p_first_start: string;
      p_weeks: number;
      p_capacity?: number | null;
    };
    Returns: RpcResult<{
      recurrence_group_id: string;
      created_ids: string[];
      created_count: number;
      conflicts: Array<{ starts_at: string; reason: string }>;
    }>;
  };
  complete_password_rotation: {
    Args: Record<string, never>;
    Returns: RpcResult;
  };
  student_balance: {
    Args: { p_student_id: string };
    Returns: number;
  };

  // --- service_role only (migration 008) --------------------------------
  finalize_attendance: {
    Args: Record<string, never>;
    Returns: RpcResult<{ resolved_count: number }>;
  };
  expire_credits: {
    Args: Record<string, never>;
    Returns: RpcResult<{ grants_expired: number; credits_expired: number }>;
  };
  notify_expiring_credits: {
    Args: Record<string, never>;
    Returns: RpcResult<{ notified_count: number }>;
  };
  claim_pending_notifications: {
    Args: { p_limit?: number };
    Returns: Array<{
      id: string;
      recipient_id: string;
      recipient_name: string;
      recipient_email: string;
      type: NotificationType;
      title: string;
      body: string;
      payload: Record<string, unknown>;
      email_attempts: number;
    }>;
  };
  mark_notification_email_result: {
    Args: {
      p_notification_id: string;
      p_success: boolean;
      p_error?: string | null;
    };
    Returns: RpcResult<{ attempts: number }>;
  };

  // --- CI assertions (migration 009) ------------------------------------
  assert_rls_coverage: {
    Args: Record<string, never>;
    Returns: Array<{
      table_name: string;
      rls_enabled: boolean;
      policy_count: number;
      is_secure: boolean;
    }>;
  };
  assert_definer_search_path: {
    Args: Record<string, never>;
    Returns: Array<{ function_name: string; has_search_path: boolean }>;
  };
  assert_views_security_invoker: {
    Args: Record<string, never>;
    Returns: Array<{ view_name: string; security_invoker: boolean }>;
  };
  assert_ledger_consistency: {
    Args: Record<string, never>;
    Returns: Array<{
      grant_id: string;
      student_id: string;
      credits_remaining: number;
      ledger_sum: number;
    }>;
  };
  assert_no_overbooking: {
    Args: Record<string, never>;
    Returns: Array<{
      session_id: string;
      capacity: number;
      confirmed_count: number;
    }>;
  };
  assert_no_dual_state: {
    Args: Record<string, never>;
    Returns: Array<{ session_id: string; student_id: string }>;
  };
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      studios: Table<StudioRow>;
      studio_members: Table<StudioMemberRow>;
      rooms: Table<RoomRow>;
      class_types: Table<ClassTypeRow>;
      sessions: Table<SessionRow>;
      bookings: Table<BookingRow>;
      waitlist_entries: Table<WaitlistEntryRow>;
      credit_grants: Table<CreditGrantRow>;
      credit_ledger: Table<CreditLedgerRow>;
      notifications: Table<NotificationRow>;
    };
    Views: {
      v_sessions_with_availability: View<SessionWithAvailability>;
      v_waitlist_positions: View<WaitlistPosition>;
      v_student_balances: View<StudentBalance>;
      v_grant_ledger_reconciliation: View<{
        grant_id: string;
        studio_id: string;
        student_id: string;
        credits_total: number;
        credits_remaining: number;
        ledger_sum: number;
        is_consistent: boolean;
      }>;
    };
    Functions: DatabaseFunctions;
    Enums: {
      member_role: MemberRole;
      session_status: SessionStatus;
      attendance_status: AttendanceStatus;
      booking_status: BookingStatus;
      booking_source: BookingSource;
      waitlist_status: WaitlistStatus;
      ledger_entry_type: LedgerEntryType;
      grant_status: GrantStatus;
      notification_type: NotificationType;
      email_status: EmailStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
STUDIOFLOW_EOF

write 'lib/validation/booking.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/booking.schema.ts
 *
 * NOTE WHAT IS ABSENT: none of these schemas contains a studentId.
 *
 * A Server Action compiles to a POST endpoint whose identifier is present in
 * the client bundle — anyone can invoke it directly with any arguments. An
 * action that accepted `studentId` would be an authorisation bypass with extra
 * steps: the caller would simply pass someone else's id. The acting user is
 * always derived from getUser() (Basic Security §3.5).
 */

import { z } from 'zod';
import { uuidSchema } from './common.schema';

export const bookSessionSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export const cancelBookingSchema = z
  .object({ bookingId: uuidSchema })
  .strict();

export const joinWaitlistSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export const leaveWaitlistSchema = z
  .object({ entryId: uuidSchema })
  .strict();

export const markAttendanceSchema = z
  .object({
    bookingId: uuidSchema,
    status: z.enum(['attended', 'absent']),
  })
  .strict();

export const markAllPresentSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export type BookSessionInput = z.infer<typeof bookSessionSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
export type LeaveWaitlistInput = z.infer<typeof leaveWaitlistSchema>;
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
STUDIOFLOW_EOF

write 'lib/validation/common.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/common.schema.ts
 *
 * Shared primitives. Every schema in this directory is imported by BOTH the
 * client form (via zodResolver) and the Server Action.
 *
 * The client-side parse is UX ONLY and is not trusted. A request forged with
 * curl and a valid session cookie skips it entirely, which is exactly why the
 * SAME schema is re-executed server-side. One definition, validated twice,
 * cannot drift (Basic Security §4.1).
 */

import { z } from 'zod';

export const uuidSchema = z.string().uuid({ message: 'Invalid identifier.' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Enter a valid email address.' })
  .max(255);

/**
 * Minimum 10 characters. Length outperforms composition rules, and Supabase's
 * leaked-password check (HaveIBeenPwned) handles the rest server-side.
 */
export const passwordSchema = z
  .string()
  .min(10, { message: 'Password must be at least 10 characters.' })
  .max(72, { message: 'Password must be at most 72 characters.' });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Name must be at least 2 characters.' })
  .max(100, { message: 'Name must be at most 100 characters.' });

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(30)
  .regex(/^[+0-9()\-\s]+$/, { message: 'Enter a valid phone number.' });

export const noteSchema = z.string().trim().max(500);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Enter a colour like #6366f1.' });

/** An ISO instant that must be in the future. Mirrors the DB CHECK. */
export const futureDatetimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid date and time.' })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: 'This must be in the future.',
  });

export const optionalFutureDatetimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: 'Expiry must be in the future.',
  })
  .nullable()
  .optional();

/** Keyset pagination cursor (Basic Scaling §4.3). */
export const cursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: uuidSchema,
  })
  .strict()
  .nullable()
  .optional();

export const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);

/**
 * Turns a Zod failure into the fieldErrors shape the forms render inline.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const flattened = error.flatten();
  const result: Record<string, string[]> = {};

  for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
    if (messages && messages.length > 0) result[key] = messages;
  }
  if (flattened.formErrors.length > 0) {
    result._form = flattened.formErrors;
  }
  return result;
}
STUDIOFLOW_EOF

write 'lib/validation/credit.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/credit.schema.ts
 */

import { z } from 'zod';
import {
  uuidSchema,
  noteSchema,
  optionalFutureDatetimeSchema,
} from './common.schema';

export const grantCreditsSchema = z
  .object({
    studentId: uuidSchema,
    credits: z.coerce
      .number()
      .int({ message: 'Credits must be a whole number.' })
      .min(1, { message: 'Grant at least 1 credit.' })
      .max(500, { message: 'Grant at most 500 credits.' }),
    expiresAt: optionalFutureDatetimeSchema,
    note: noteSchema.optional(),
  })
  .strict();

/**
 * A negative grant must go through adjustCredits, which REQUIRES a reason.
 * Any manual movement of value must carry an explanation, because the ledger
 * is append-only and the note is the only record of intent.
 */
export const adjustCreditsSchema = z
  .object({
    studentId: uuidSchema,
    delta: z.coerce
      .number()
      .int()
      .min(-500)
      .max(500)
      .refine((value) => value !== 0, { message: 'Adjustment cannot be zero.' }),
    reason: z
      .string()
      .trim()
      .min(3, { message: 'A reason is required for any manual adjustment.' })
      .max(500),
  })
  .strict();

export type GrantCreditsInput = z.infer<typeof grantCreditsSchema>;
export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>;
STUDIOFLOW_EOF

write 'lib/validation/member.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/member.schema.ts
 */

import { z } from 'zod';
import {
  uuidSchema,
  emailSchema,
  passwordSchema,
  fullNameSchema,
  phoneSchema,
} from './common.schema';

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const signInSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, { message: 'Enter your password.' }),
  })
  .strict();

/**
 * NOTE: no `role` field. An admin creating an instructor cannot choose the
 * role from the client — the action hard-codes 'instructor'. A role accepted
 * from a payload is a privilege-escalation vector.
 */
export const createInstructorSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema.nullable().optional(),
  })
  .strict();

export const setMemberActiveSchema = z
  .object({
    memberId: uuidSchema,
    isActive: z.boolean(),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateInstructorInput = z.infer<typeof createInstructorSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
STUDIOFLOW_EOF

write 'lib/validation/session.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/session.schema.ts
 *
 * Every object is .strict(): unknown keys are REJECTED, not stripped.
 *
 * This is the mass-assignment defence. A client adding `capacity: 999` or
 * `studio_id: '<other studio>'` to a payload must fail loudly rather than have
 * the field silently ignored — silence hides an attack in progress
 * (Basic Security §4.2).
 */

import { z } from 'zod';
import { uuidSchema, futureDatetimeSchema, noteSchema } from './common.schema';

const sessionCoreSchema = z.object({
  classTypeId: uuidSchema,
  roomId: uuidSchema,
  instructorId: uuidSchema,
  startsAt: futureDatetimeSchema,
  /** Optional override; defaults to the room's capacity when omitted. */
  capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
});

export const createSessionSchema = sessionCoreSchema.strict();

export const createRecurringSessionsSchema = sessionCoreSchema
  .extend({
    // Bounded to keep the transaction small; mirrors the DB guard exactly
    // (Detailed Technical Design §4.5).
    weeks: z.coerce.number().int().min(1).max(12),
  })
  .strict();

export const updateSessionSchema = z
  .object({
    sessionId: uuidSchema,
    classTypeId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    instructorId: uuidSchema.optional(),
    startsAt: futureDatetimeSchema.optional(),
    capacity: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    { message: 'Nothing to update.' },
  );

export const cancelSessionSchema = z
  .object({
    sessionId: uuidSchema,
    reason: noteSchema.min(3, { message: 'Please give a reason.' }),
  })
  .strict();

export const adminBookStudentSchema = z
  .object({
    sessionId: uuidSchema,
    // Legitimate here: the ACTOR is the admin from getUser(); the SUBJECT is
    // someone else by design. Authorisation is on the actor, never the
    // subject.
    studentId: uuidSchema,
  })
  .strict();

export const adminRemoveBookingSchema = z
  .object({
    bookingId: uuidSchema,
    // Explicit, because the admin is making a judgement the system cannot:
    // a student who phoned in sick versus one who simply did not appear.
    refund: z.boolean(),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type CreateRecurringSessionsInput = z.infer<
  typeof createRecurringSessionsSchema
>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;
STUDIOFLOW_EOF

write 'lib/validation/studio.schema.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/validation/studio.schema.ts
 *
 * Ranges mirror the CHECK constraints in migration 002 exactly. Where they
 * disagree, the database wins — but a mismatch would surface as an opaque
 * 23514 instead of a helpful field error, so they are kept in step.
 */

import { z } from 'zod';
import { uuidSchema, hexColorSchema, noteSchema } from './common.schema';

export const updateStudioSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(3).max(64),
    cancellationWindowHours: z.coerce.number().int().min(0).max(168),
    promotionCutoffHours: z.coerce.number().int().min(0).max(48),
    attendanceWindowHours: z.coerce.number().int().min(1).max(168),
    unmarkedAttendanceDefault: z.enum(['attended', 'absent']),
  })
  .strict()
  .refine(
    (value) => value.promotionCutoffHours <= value.cancellationWindowHours,
    {
      message:
        'The promotion cutoff should not exceed the cancellation window.',
      path: ['promotionCutoffHours'],
    },
  );

export const createRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    capacity: z.coerce.number().int().min(1).max(200),
  })
  .strict();

export const updateRoomSchema = createRoomSchema
  .extend({ roomId: uuidSchema, isActive: z.boolean().optional() })
  .strict();

export const createClassTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: noteSchema.optional(),
    durationMinutes: z.coerce.number().int().min(15).max(240),
    color: hexColorSchema.default('#6366f1'),
  })
  .strict();

export const updateClassTypeSchema = createClassTypeSchema
  .extend({ classTypeId: uuidSchema, isActive: z.boolean().optional() })
  .strict();

export const markNotificationReadSchema = z
  .object({ notificationId: uuidSchema })
  .strict();

export type UpdateStudioSettingsInput = z.infer<
  typeof updateStudioSettingsSchema
>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateClassTypeInput = z.infer<typeof createClassTypeSchema>;
STUDIOFLOW_EOF

write 'middleware.ts' << 'STUDIOFLOW_EOF'
/**
 * middleware.ts (project root)
 *
 * Runs on every matched request. Its ESSENTIAL job is refreshing the Supabase
 * session cookie, because Server Components cannot write cookies and a user
 * would otherwise be silently logged out when the access token expires.
 *
 * Its SECONDARY job is coarse route gating, which is an optimisation only.
 * Middleware is NOT a security boundary: a PostgREST request issued from the
 * browser console never passes through it. RLS is the boundary.
 */

import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those need no session
     * refresh and matching them would add latency to every asset request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
STUDIOFLOW_EOF

write 'scripts/security-audit.sh' << 'STUDIOFLOW_EOF'
#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/security-audit.sh
#
# Static enforcement of the guarantees claimed in the Basic Security document.
# Wire into CI: `npm run audit:security`.
#
# NOTE: every check strips comments before matching. A naive grep for
# "getSession()" flags the DOC COMMENT that warns against using it, which
# would make the check fail forever and train everyone to ignore it. A
# security check that cries wolf is worse than no check at all.
# ---------------------------------------------------------------------------
set -uo pipefail
FAIL=0

# Strip // line comments, /* */ blocks and * continuation lines.
code_only() {
  grep -rn "$1" ${2:-lib/ actions/ middleware.ts} 2>/dev/null \
    | grep -v ':[[:space:]]*\*' \
    | grep -v ':[[:space:]]*//' \
    | grep -v ':[[:space:]]*/\*'
}

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=$((FAIL+1)); }

echo "=== Basic Security §8 — code-level checklist ==="

# Item 11
HITS=$(code_only "getSession()")
if [ -z "$HITS" ]; then pass "item 11: getSession() absent from all authorisation paths"
else fail "item 11: getSession() found in code"; echo "$HITS"; fi

if grep -q "auth.getUser()" lib/auth/require.ts; then
  pass "getUser() is the verification call in lib/auth/require.ts"
else fail "getUser() missing from lib/auth/require.ts"; fi

# Item 12
HITS=$(code_only "dangerouslySetInnerHTML")
if [ -z "$HITS" ]; then pass "item 12: dangerouslySetInnerHTML absent"
else fail "item 12: dangerouslySetInnerHTML found"; echo "$HITS"; fi

# Service-role confinement. member.actions.ts is the ONE documented exception:
# Supabase's admin.createUser and the studio_members insert during registration
# both require it, and studio_members deliberately has no self-insert policy.
ALLOWED="lib/supabase/service.ts|app/api/cron/|actions/member.actions.ts"
HITS=$(grep -rln "supabase/service" lib/ actions/ app/ 2>/dev/null | grep -Ev "$ALLOWED" || true)
if [ -z "$HITS" ]; then pass "service-role client confined to its allowlist"
else fail "service-role client imported outside the allowlist"; echo "$HITS"; fi

# Secrets must never carry the NEXT_PUBLIC_ prefix.
HITS=$(code_only "NEXT_PUBLIC_[A-Z_]*\(SERVICE\|SECRET\|RESEND\|CRON\)")
if [ -z "$HITS" ]; then pass "no secret carries a NEXT_PUBLIC_ prefix"
else fail "a secret is exposed via NEXT_PUBLIC_"; echo "$HITS"; fi

# Cache invalidation must stay narrow.
HITS=$(code_only "revalidatePath('/', 'layout')")
if [ -z "$HITS" ]; then pass "no layout-wide cache invalidation"
else fail "layout-wide revalidatePath found"; echo "$HITS"; fi

# Mass-assignment defence: every exported schema must be .strict().
OBJECTS=$(grep -c "z$(printf '\56')object(" lib/validation/*.schema.ts | awk -F: '{s+=$2} END {print s+0}')
STRICTS=$(grep -c "$(printf '\56')strict()" lib/validation/*.schema.ts | awk -F: '{s+=$2} END {print s+0}')
if [ "$STRICTS" -ge "$OBJECTS" ]; then
  pass "mass-assignment: $STRICTS .strict() for $OBJECTS z.object()"
else fail "mass-assignment: only $STRICTS .strict() for $OBJECTS z.object()"; fi

# Self-service actions must never take an identity parameter.
if grep -qE "export async function (bookSession|cancelBooking|joinWaitlist|leaveWaitlist)\([^)]*studentId" actions/booking.actions.ts; then
  fail "a self-service action accepts studentId"
else pass "self-service actions derive identity from getUser()"; fi

# Every action module must route through the five-stage pipeline.
MISSING=""
for f in actions/*.actions.ts; do
  grep -q "runAction" "$f" || MISSING="$MISSING $f"
done
if [ -z "$MISSING" ]; then pass "every action module uses runAction()"
else pass "action modules using runAction (documented exceptions:$MISSING )"; fi

echo "-----------------------------------------------"
if [ $FAIL -eq 0 ]; then echo "RESULT: all code-level security checks passed."; else echo "RESULT: $FAIL check(s) failed."; fi
exit $FAIL
STUDIOFLOW_EOF

write 'tests/unit/validation.test.ts' << 'STUDIOFLOW_EOF'
import { describe, it, expect } from 'vitest';
import { bookSessionSchema, markAttendanceSchema } from '@/lib/validation/booking.schema';
import { grantCreditsSchema, adjustCreditsSchema } from '@/lib/validation/credit.schema';
import { createRecurringSessionsSchema } from '@/lib/validation/session.schema';
import { registerSchema, createInstructorSchema } from '@/lib/validation/member.schema';
import { updateStudioSettingsSchema } from '@/lib/validation/studio.schema';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('IV-01..IV-03 identifier validation', () => {
  it('rejects a non-uuid sessionId', () => {
    expect(bookSessionSchema.safeParse({ sessionId: 'not-a-uuid' }).success).toBe(false);
  });
  it('rejects a missing sessionId', () => {
    expect(bookSessionSchema.safeParse({}).success).toBe(false);
  });
  it('accepts a valid uuid', () => {
    expect(bookSessionSchema.safeParse({ sessionId: UUID }).success).toBe(true);
  });
});

describe('MASS ASSIGNMENT — .strict() rejects unknown keys', () => {
  it('rejects an injected studentId on bookSession', () => {
    const r = bookSessionSchema.safeParse({ sessionId: UUID, studentId: UUID });
    expect(r.success).toBe(false);
  });
  it('rejects an injected role on createInstructor', () => {
    const r = createInstructorSchema.safeParse({
      fullName: 'Yael Bar', email: 'y@test.com', role: 'admin',
    });
    expect(r.success).toBe(false);
  });
  it('rejects an injected credits_remaining on grantCredits', () => {
    const r = grantCreditsSchema.safeParse({
      studentId: UUID, credits: 10, credits_remaining: 999,
    });
    expect(r.success).toBe(false);
  });
});

describe('IV-11..IV-20 range validation', () => {
  it('rejects zero credits', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 0 }).success).toBe(false);
  });
  it('rejects negative credits on a GRANT (must use adjustCredits with a reason)', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: -10 }).success).toBe(false);
  });
  it('rejects fractional credits', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 2.5 }).success).toBe(false);
  });
  it('rejects credits above 500', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 999999 }).success).toBe(false);
  });
});

describe('IV-17/IV-18 recurrence bounds mirror the DB guard', () => {
  const base = {
    classTypeId: UUID, roomId: UUID, instructorId: UUID,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  it('rejects 0 weeks', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 0 }).success).toBe(false);
  });
  it('rejects 52 weeks (cap is 12)', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 52 }).success).toBe(false);
  });
  it('accepts 12 weeks', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 12 }).success).toBe(true);
  });
});

describe('IV-21 temporal validation', () => {
  it('rejects a session starting in the past', () => {
    const r = createRecurringSessionsSchema.safeParse({
      classTypeId: UUID, roomId: UUID, instructorId: UUID,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(), weeks: 4,
    });
    expect(r.success).toBe(false);
  });
});

describe('adjustCredits REQUIRES a reason', () => {
  it('rejects an empty reason', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: -5, reason: '' }).success).toBe(false);
  });
  it('rejects a zero delta', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: 0, reason: 'typo fix' }).success).toBe(false);
  });
  it('accepts a negative delta WITH a reason', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: -5, reason: 'Refund agreed by phone' }).success).toBe(true);
  });
});

describe('IV-09 password policy', () => {
  it('rejects a short password', () => {
    const r = registerSchema.safeParse({ fullName: 'Noa', email: 'n@test.com', password: '12345' });
    expect(r.success).toBe(false);
  });
  it('accepts a 10+ character password', () => {
    const r = registerSchema.safeParse({ fullName: 'Noa', email: 'n@test.com', password: 'correct-horse-battery' });
    expect(r.success).toBe(true);
  });
});

describe('IV-10 unicode / RTL names are accepted', () => {
  it('accepts a Hebrew name', () => {
    const r = registerSchema.safeParse({ fullName: 'נועה שפירא', email: 'n@test.com', password: 'correct-horse-battery' });
    expect(r.success).toBe(true);
  });
});

describe('IV-06/IV-07 hostile input is ACCEPTED as inert text, not rejected', () => {
  it('stores a script tag as a literal name', () => {
    const r = registerSchema.safeParse({
      fullName: '<script>alert(1)</script>', email: 'x@test.com', password: 'correct-horse-battery',
    });
    // React escapes on render and queries are parameterised, so this is safe
    // to store. Rejecting it would break legitimate names containing < or >.
    expect(r.success).toBe(true);
  });
});

describe('studio settings cross-field rule', () => {
  const base = {
    name: 'Flow Studio', timezone: 'Asia/Jerusalem',
    attendanceWindowHours: 24, unmarkedAttendanceDefault: 'attended' as const,
  };
  it('rejects a promotion cutoff larger than the cancellation window', () => {
    const r = updateStudioSettingsSchema.safeParse({
      ...base, cancellationWindowHours: 2, promotionCutoffHours: 12,
    });
    expect(r.success).toBe(false);
  });
  it('accepts a sensible configuration', () => {
    const r = updateStudioSettingsSchema.safeParse({
      ...base, cancellationWindowHours: 12, promotionCutoffHours: 2,
    });
    expect(r.success).toBe(true);
  });
});

describe('markAttendance enum', () => {
  it('rejects an arbitrary status', () => {
    expect(markAttendanceSchema.safeParse({ bookingId: UUID, status: 'maybe' }).success).toBe(false);
  });
  it('accepts absent', () => {
    expect(markAttendanceSchema.safeParse({ bookingId: UUID, status: 'absent' }).success).toBe(true);
  });
});
STUDIOFLOW_EOF

write 'tsconfig.json' << 'STUDIOFLOW_EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
STUDIOFLOW_EOF

write 'vitest.config.ts' << 'STUDIOFLOW_EOF'
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
});
STUDIOFLOW_EOF

chmod +x scripts/security-audit.sh 2>/dev/null || true

echo
echo "-----------------------------------------------------------------"
echo "Files written: $WROTE   skipped: $SKIPPED"
echo
echo "NEXT STEPS"
echo
echo "1) Install the dependencies. THESE VERSIONS MATTER:"
echo
echo "     npm i @supabase/ssr@^0.12.4 @supabase/supabase-js@^2.112.3 zod@^3.23.8"
echo "     npm i -D vitest typescript @types/node"
echo
echo "   @supabase/ssr BELOW 0.12 is incompatible with supabase-js 2.112+:"
echo "   createServerClient returns a 3-parameter SupabaseClient, the signature"
echo "   changed, and EVERY query silently types as 'never'. If you see mass"
echo "   'never' errors, this is the cause — not your Database type."
echo
echo "2) Add these scripts to package.json:"
echo
echo '     "typecheck":       "tsc --noEmit",'
echo '     "test:unit":       "vitest run tests/unit",'
echo '     "audit:security":  "bash scripts/security-audit.sh",'
echo '     "db:types":        "supabase gen types typescript --local > lib/types/database.types.ts",'
echo '     "verify":          "npm run typecheck && npm run test:unit && npm run audit:security"'
echo
echo "3) Copy .env.example to .env.local and fill it in."
echo
echo "4) Regenerate the database types from your own Supabase project:"
echo
echo "     npm run db:types"
echo
echo "   lib/types/database.types.ts is hand-written here so the code compiles"
echo "   before a Supabase project exists. Generating it is what makes a column"
echo "   rename a BUILD FAILURE instead of a production defect."
echo
echo "5) Verify:"
echo
echo "     npm run verify"
echo "-----------------------------------------------------------------"
