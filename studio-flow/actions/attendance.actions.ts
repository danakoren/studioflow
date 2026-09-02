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
