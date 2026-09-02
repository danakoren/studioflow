/**
 * lib/data/teach.queries.ts
 *
 * READ-ONLY. Instructor-facing reads.
 *
 * ==========================================================================
 * THE FILTER HERE IS NOT THE SECURITY BOUNDARY
 * ==========================================================================
 * getTeachingSessions() filters on instructor_id = the caller. That is for
 * CORRECTNESS of the list, not for protection: an instructor is a studio
 * member, and sessions_select_members lets them read every session in their
 * studio. Without the filter they would see the whole studio's timetable, which
 * is wrong but not a leak.
 *
 * The roster is the opposite case, and it is the one that matters. Reading
 * bookings and student names for a session is gated by RLS —
 * bookings_select_own_roster and profiles_select_own_roster both route through
 * teaches_session(), which compares sessions.instructor_id to auth.uid()
 * rather than checking a role. An instructor who hand-crafts a PostgREST
 * request for a colleague's roster receives zero rows (tests PR-24, PR-26,
 * PR-33).
 *
 * ==========================================================================
 * A NOTE ON WAITLIST NAMES
 * ==========================================================================
 * profiles_select_own_roster exposes a student's name to an instructor only
 * when that student holds a CONFIRMED BOOKING in a session they teach. A
 * waitlisted student holds no booking, so their name is deliberately not
 * readable here and comes back null. That is the privacy boundary working as
 * specified (Basic Security §2.5: an instructor sees roster names "and nothing
 * else"), not a bug to be worked around — widening it would need a policy
 * change and an explicit decision.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type {
  AttendanceStatus,
  SessionStatus,
} from '@/lib/types/database.types';

export interface TeachingSession {
  id: string;
  startsAt: string;
  endsAt: string;
  status: SessionStatus;
  cancellationReason: string | null;
  className: string;
  classColor: string;
  roomName: string;
  durationMinutes: number;
  capacity: number;
  bookedCount: number;
  seatsAvailable: number;
  waitingCount: number;
}

/**
 * Sessions this user personally teaches, within an explicit window.
 *
 * BOUNDED on both sides, per Basic Scaling §2 — the caller passes the range
 * rather than the query deciding "everything". The dashboard asks for a small
 * window either side of now, because an instructor needs today's classes and
 * the ones whose attendance window is still open, not their career history.
 */
export async function getTeachingSessions(
  instructorId: string,
  fromIso: string,
  toIso: string,
  { limit = 100 } = {},
): Promise<TeachingSession[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select(
      'id, starts_at, ends_at, status, cancellation_reason, class_type_name, class_type_color, room_name, duration_minutes, capacity, booked_count, seats_available, waiting_count',
    )
    .eq('instructor_id', instructorId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) {
    logServerError('getTeachingSessions', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    className: row.class_type_name,
    classColor: row.class_type_color,
    roomName: row.room_name,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    seatsAvailable: row.seats_available,
    waitingCount: row.waiting_count,
  }));
}

/** One session, as the teaching view needs it. Null when not readable. */
export async function getTeachingSession(
  sessionId: string,
): Promise<(TeachingSession & { instructorId: string; studioId: string }) | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select(
      'id, studio_id, instructor_id, starts_at, ends_at, status, cancellation_reason, class_type_name, class_type_color, room_name, duration_minutes, capacity, booked_count, seats_available, waiting_count',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    logServerError('getTeachingSession', error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    studioId: data.studio_id,
    instructorId: data.instructor_id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    status: data.status,
    cancellationReason: data.cancellation_reason,
    className: data.class_type_name,
    classColor: data.class_type_color,
    roomName: data.room_name,
    durationMinutes: data.duration_minutes,
    capacity: data.capacity,
    bookedCount: data.booked_count,
    seatsAvailable: data.seats_available,
    waitingCount: data.waiting_count,
  };
}

export interface RosterEntry {
  bookingId: string;
  studentId: string;
  /** Null if RLS withholds the profile — the row is kept regardless. */
  studentName: string | null;
  attendance: AttendanceStatus | null;
  attendanceAutoResolved: boolean;
  /** 'self' or 'admin' — how the seat was taken. */
  source: string;
}

/**
 * The confirmed roster for one session.
 *
 * TWO QUERIES, NEVER ONE PER STUDENT: the bookings, then every referenced
 * profile in a single `in` filter. A roster of twenty with a name lookup per
 * row is the same N+1 the schedule view exists to avoid.
 *
 * Only CONFIRMED bookings appear. A cancelled seat is not part of the register
 * an instructor reads out, and profiles_select_own_roster would not expose the
 * student's name for it anyway.
 */
export async function getSessionRoster(
  sessionId: string,
): Promise<RosterEntry[]> {
  const supabase = await createClient();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, student_id, attendance, attendance_auto_resolved, source')
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')
    .order('booked_at', { ascending: true });

  if (error) {
    logServerError('getSessionRoster', error);
    return [];
  }
  if (!bookings || bookings.length === 0) return [];

  const names = await resolveNames(bookings.map((b) => b.student_id));

  return bookings
    .map((booking) => ({
      bookingId: booking.id,
      studentId: booking.student_id,
      studentName: names.get(booking.student_id) ?? null,
      attendance: booking.attendance,
      attendanceAutoResolved: booking.attendance_auto_resolved,
      source: booking.source,
    }))
    // Alphabetical by the name actually shown, so calling the register follows
    // the order on screen. Unresolved names sort last rather than interleaving.
    .sort((a, b) => {
      if (a.studentName === null) return 1;
      if (b.studentName === null) return -1;
      return a.studentName.localeCompare(b.studentName);
    });
}

export interface WaitlistEntry {
  entryId: string;
  studentId: string;
  studentName: string | null;
  position: number;
  joinedAt: string;
}

/**
 * The waiting queue for one session, in position order.
 *
 * Names are usually null here — see the note at the top of this file. The
 * count and the ordering are the useful part for an instructor: it tells them
 * whether a no-show can be filled from the door.
 */
export async function getSessionWaitlist(
  sessionId: string,
): Promise<WaitlistEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_waitlist_positions')
    .select('id, student_id, position, joined_at')
    .eq('session_id', sessionId)
    .order('position', { ascending: true });

  if (error) {
    logServerError('getSessionWaitlist', error);
    return [];
  }
  if (!data || data.length === 0) return [];

  const names = await resolveNames(data.map((row) => row.student_id));

  return data.map((row) => ({
    entryId: row.id,
    studentId: row.student_id,
    studentName: names.get(row.student_id) ?? null,
    position: row.position,
    joinedAt: row.joined_at,
  }));
}

/* -------------------------------------------------------------------------- */

/**
 * ONE query for every referenced profile.
 *
 * A missing id is not an error. RLS decides which profiles are visible, and a
 * withheld name must degrade the row rather than remove it — an instructor
 * seeing "14 booked" above a list of 12 would reasonably conclude the roster
 * was broken.
 */
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', unique);

  if (error) {
    logServerError('resolveNames', error);
    return names;
  }

  for (const row of data ?? []) names.set(row.id, row.full_name);
  return names;
}
