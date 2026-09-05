/**
 * lib/data/bookings.queries.ts
 *
 * READ-ONLY. Nothing in lib/data/ ever writes — writes go through actions/.
 *
 * These reads carry NO ownership filter beyond the one that makes the intent
 * legible at the call site. The RLS policies bookings_select_own and
 * waitlist_select_own restrict rows to student_id = auth.uid(), so a student
 * cannot see another student's bookings even by crafting a direct PostgREST
 * request with their own JWT.
 *
 * ==========================================================================
 * TWO ROUND TRIPS, NEVER ONE PER ROW
 * ==========================================================================
 * Each function issues exactly two queries: one for the student's own rows,
 * then ONE more resolving every referenced session in a single `in` filter.
 * The tempting shape — mapping over bookings and awaiting a session lookup
 * inside — is the HQ-1 N+1 that the Scaling document rejects, and it is the
 * reason v_sessions_with_availability exists.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type {
  AttendanceStatus,
  BookingStatus,
  SessionStatus,
} from '@/lib/types/database.types';

/**
 * A booking joined to what the student needs to recognise it.
 *
 * Every session-derived field is NULLABLE, and that is deliberate rather than
 * defensive habit. v_sessions_with_availability inner-joins profiles for the
 * instructor name, and the policy that exposes instructor names to students
 * (profiles_select_instructors) is scoped to instructors who teach a SCHEDULED
 * session. An instructor whose only remaining session is cancelled therefore
 * becomes invisible, the inner join drops the row, and a booking the student
 * definitely holds would silently disappear from this page. Keeping the
 * booking and degrading its label is the honest failure mode.
 */
export interface StudentBooking {
  bookingId: string;
  sessionId: string;
  status: BookingStatus;
  attendance: AttendanceStatus | null;
  /** True when BR-12's default resolved this rather than an instructor marking it. */
  attendanceAutoResolved: boolean;
  creditRefunded: boolean;

  startsAt: string | null;
  endsAt: string | null;
  sessionStatus: SessionStatus | null;
  cancellationReason: string | null;
  className: string | null;
  classColor: string | null;
  instructorName: string | null;
  roomName: string | null;
  durationMinutes: number | null;
}

export interface MyBookings {
  upcoming: StudentBooking[];
  past: StudentBooking[];
}

/**
 * Bookings this student holds, split at `nowIso`.
 *
 * BOUNDED, per Basic Scaling §2: the underlying read is capped rather than
 * "every booking ever". The cap is on booked_at descending, which is the axis
 * that keeps recent activity — including everything upcoming, since an upcoming
 * class is by definition booked recently. A small studio's student will never
 * approach it; the limit exists so the query cost cannot grow without bound as
 * the product ages.
 *
 * CANCELLED bookings are excluded from both lists. A cancellation already
 * reports its own outcome in the dialog, and its credit movement is permanently
 * visible on /my/credits — leaving the row here would mean every cancellation a
 * student ever made accumulates on the page they use to see what they are
 * attending.
 */
export async function getMyBookings(
  userId: string,
  nowIso: string,
  { historyLimit = 20, fetchLimit = 200 } = {},
): Promise<MyBookings> {
  const supabase = await createClient();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(
      'id, session_id, status, attendance, attendance_auto_resolved, credit_refunded',
    )
    .eq('student_id', userId)
    .eq('status', 'confirmed')
    .order('booked_at', { ascending: false })
    .limit(fetchLimit);

  if (error) {
    logServerError('getMyBookings', error);
    return { upcoming: [], past: [] };
  }
  if (!bookings || bookings.length === 0) return { upcoming: [], past: [] };

  const sessions = await resolveSessions(
    bookings.map((booking) => booking.session_id),
  );

  const rows: StudentBooking[] = bookings.map((booking) => {
    const session = sessions.get(booking.session_id);
    return {
      bookingId: booking.id,
      sessionId: booking.session_id,
      status: booking.status,
      attendance: booking.attendance,
      attendanceAutoResolved: booking.attendance_auto_resolved,
      creditRefunded: booking.credit_refunded,

      startsAt: session?.starts_at ?? null,
      endsAt: session?.ends_at ?? null,
      sessionStatus: session?.status ?? null,
      cancellationReason: session?.cancellation_reason ?? null,
      className: session?.class_type_name ?? null,
      classColor: session?.class_type_color ?? null,
      instructorName: session?.instructor_name ?? null,
      roomName: session?.room_name ?? null,
      durationMinutes: session?.duration_minutes ?? null,
    };
  });

  const now = new Date(nowIso).getTime();

  // A booking whose session could not be resolved has no date to compare, so
  // it is treated as upcoming: surfacing it where the student will look is
  // better than filing it under history they may never open.
  const isUpcoming = (row: StudentBooking) =>
    row.startsAt === null || new Date(row.startsAt).getTime() > now;

  const upcoming = rows
    .filter(isUpcoming)
    .sort((a, b) => compareStartsAt(a, b, 'asc'));

  const past = rows
    .filter((row) => !isUpcoming(row))
    .sort((a, b) => compareStartsAt(a, b, 'desc'))
    .slice(0, historyLimit);

  return { upcoming, past };
}

export interface StudentWaitlistEntry {
  entryId: string;
  sessionId: string;
  /** DERIVED by v_waitlist_positions from joined_at — never stored. */
  position: number;
  joinedAt: string;
  startsAt: string | null;
  className: string | null;
  classColor: string | null;
  instructorName: string | null;
  roomName: string | null;
}

/**
 * Waitlist entries this student is still waiting on.
 *
 * The position comes from v_waitlist_positions, which derives it with
 * row_number() over joined_at. It is not stored anywhere: a stored position
 * would have to be renumbered on every departure, which is write amplification
 * and a source of gaps and duplicates under concurrency. The view also filters
 * to status = 'waiting', so promoted and abandoned entries never appear here.
 */
export async function getMyWaitlistEntries(
  userId: string,
  nowIso: string,
  { limit = 50 } = {},
): Promise<StudentWaitlistEntry[]> {
  const supabase = await createClient();

  const { data: entries, error } = await supabase
    .from('v_waitlist_positions')
    .select('id, session_id, position, joined_at')
    .eq('student_id', userId)
    .order('joined_at', { ascending: true })
    .limit(limit);

  if (error) {
    logServerError('getMyWaitlistEntries', error);
    return [];
  }
  if (!entries || entries.length === 0) return [];

  const sessions = await resolveSessions(
    entries.map((entry) => entry.session_id),
  );
  const now = new Date(nowIso).getTime();

  return entries
    .map((entry) => {
      const session = sessions.get(entry.session_id);
      return {
        entryId: entry.id,
        sessionId: entry.session_id,
        position: entry.position,
        joinedAt: entry.joined_at,
        startsAt: session?.starts_at ?? null,
        className: session?.class_type_name ?? null,
        classColor: session?.class_type_color ?? null,
        instructorName: session?.instructor_name ?? null,
        roomName: session?.room_name ?? null,
      };
    })
    // A place in a queue for a class that has already begun is not actionable.
    .filter(
      (entry) =>
        entry.startsAt === null || new Date(entry.startsAt).getTime() > now,
    );
}

/* -------------------------------------------------------------------------- */

type ResolvedSession = {
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  cancellation_reason: string | null;
  class_type_name: string;
  class_type_color: string;
  instructor_name: string;
  room_name: string;
  duration_minutes: number;
};

/** ONE query for every referenced session, keyed by id. */
async function resolveSessions(
  sessionIds: string[],
): Promise<Map<string, ResolvedSession>> {
  const unique = [...new Set(sessionIds)];
  const result = new Map<string, ResolvedSession>();
  if (unique.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select(
      'id, starts_at, ends_at, status, cancellation_reason, class_type_name, class_type_color, instructor_name, room_name, duration_minutes',
    )
    .in('id', unique);

  if (error) {
    // Deliberately not fatal. The caller renders a degraded row rather than
    // dropping a booking the student holds — see the note on StudentBooking.
    logServerError('resolveSessions', error);
    return result;
  }

  for (const row of data ?? []) {
    result.set(row.id, {
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      status: row.status,
      cancellation_reason: row.cancellation_reason,
      class_type_name: row.class_type_name,
      class_type_color: row.class_type_color,
      instructor_name: row.instructor_name,
      room_name: row.room_name,
      duration_minutes: row.duration_minutes,
    });
  }
  return result;
}

/** Unresolved sessions sort last in both directions. */
function compareStartsAt(
  a: StudentBooking,
  b: StudentBooking,
  direction: 'asc' | 'desc',
): number {
  if (a.startsAt === null) return 1;
  if (b.startsAt === null) return -1;
  const delta =
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  return direction === 'asc' ? delta : -delta;
}
