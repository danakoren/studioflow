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

export interface UpdateSessionResult {
  /**
   * How many waitlisted students the capacity increase booked in.
   *
   * Zero for any edit that did not raise capacity, and also zero when it did
   * but nobody could take the seat — an empty queue, everyone out of credit, or
   * BR-3's promotion cutoff already passed.
   */
  promotedFromWaitlist: number;
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
): Promise<ActionResult<UpdateSessionResult>> {
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

      /*
       * Confirmed count BEFORE the write.
       *
       * Two jobs, both about capacity:
       *
       *   1. Fast-fail a decrease below the seats already taken, so the admin
       *      gets CAPACITY_BELOW_BOOKED naming the real problem instead of the
       *      generic VALIDATION_FAILED that the 23514 from
       *      sessions_guard_capacity_decrease maps to. The trigger remains the
       *      REAL guarantee — this read races with concurrent bookers and the
       *      trigger does not. Same fast-fail-plus-real-check split as the role
       *      checks elsewhere in this file.
       *
       *   2. Give the baseline for counting promotions after an increase. The
       *      sessions_fill_on_capacity_increase trigger fires inside the UPDATE,
       *      so the only way to observe what it did is to compare counts either
       *      side of it.
       */
      let bookedBefore: number | null = null;

      if (value.capacity !== undefined) {
        const { count, error: countError } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', value.sessionId)
          .eq('status', 'confirmed');

        if (countError) {
          logServerError('updateSession:count', countError);
          return fail(mapPostgresError(countError));
        }

        bookedBefore = count ?? 0;
        if (value.capacity < bookedBefore) return fail('CAPACITY_BELOW_BOOKED');
      }

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

      /*
       * Did the trigger promote anyone?
       *
       * Read back rather than computed: sessions_fill_on_capacity_increase runs
       * inside the UPDATE above, promoting until the class is full or the queue
       * is spent, and how far it got depends on who was waiting and whether
       * they still had credits. The difference in confirmed bookings is the only
       * honest answer.
       *
       * Purely informational — a miscount from a booking landing in the same
       * instant would misreport the number, never the seats themselves, which
       * the trigger holds a row lock for.
       */
      let promotedFromWaitlist = 0;

      if (bookedBefore !== null) {
        const { count, error: afterError } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', value.sessionId)
          .eq('status', 'confirmed');

        if (afterError) {
          // The update SUCCEEDED; only the tally failed. Reporting a failure
          // here would tell the admin their change did not apply when it did.
          logServerError('updateSession:countAfter', afterError);
        } else {
          promotedFromWaitlist = Math.max(0, (count ?? 0) - bookedBefore);
        }
      }

      return ok({ promotedFromWaitlist });
    },
    revalidate: ({ input }) => [
      '/schedule',
      `/schedule/${input.sessionId}`,
      '/admin/schedule',
      `/admin/sessions/${input.sessionId}`,
      // A promotion creates a booking and spends a credit for someone else, so
      // their pages are stale too.
      '/my/bookings',
      '/my/credits',
      '/teach',
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
