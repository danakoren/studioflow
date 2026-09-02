/**
 * lib/data/sessions.queries.ts
 *
 * READ-ONLY. Nothing in lib/data/ ever writes — writes go through actions/.
 *
 * Every function here obeys two rules from the Scaling document:
 *
 *   1. AGGREGATE, NEVER LOOP. Counts shown in a list are computed by the same
 *      query that fetches the list. A `.map()` containing an `await` on a data
 *      function is rejected in review — that is the N+1 (HQ-1) that turns one
 *      round trip into forty-one on the busiest page in the product.
 *
 *   2. EVERY QUERY IS BOUNDED. The schedule is always a date range, never
 *      "all sessions".
 *
 * These read as the CALLING USER, so RLS filters the rows. There is no
 * ownership filter anywhere below, and none is needed.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type {
  AttendanceStatus,
  SessionWithAvailability,
  WaitlistPosition,
} from '@/lib/types/database.types';

export interface StudioSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  cancellationWindowHours: number;
  promotionCutoffHours: number;
  /** BR-11: how long after a class ends attendance may still be marked. */
  attendanceWindowHours: number;
  /** BR-12: what an unmarked booking resolves to when the window closes. */
  unmarkedAttendanceDefault: AttendanceStatus;
}

const STUDIO_COLUMNS =
  'id, name, slug, timezone, cancellation_window_hours, promotion_cutoff_hours, attendance_window_hours, unmarked_attendance_default';

type StudioRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  cancellation_window_hours: number;
  promotion_cutoff_hours: number;
  attendance_window_hours: number;
  unmarked_attendance_default: AttendanceStatus;
};

function toStudioSummary(row: StudioRow): StudioSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    cancellationWindowHours: row.cancellation_window_hours,
    promotionCutoffHours: row.promotion_cutoff_hours,
    attendanceWindowHours: row.attendance_window_hours,
    unmarkedAttendanceDefault: row.unmarked_attendance_default,
  };
}

/**
 * The studio whose schedule the public site shows.
 *
 * v1 serves a single studio, so this takes the first one. The multi-tenant
 * schema is already in place; only this resolution step changes when a second
 * studio is onboarded (it becomes a slug lookup from the route).
 */
export async function getPrimaryStudio(): Promise<StudioSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studios')
    .select(STUDIO_COLUMNS)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logServerError('getPrimaryStudio', error);
    return null;
  }
  if (!data) return null;

  return toStudioSummary(data);
}

/**
 * One studio by id, for pages that already know which studio the viewer
 * belongs to.
 *
 * getPrimaryStudio() above takes the FIRST studio, which is correct for the
 * public schedule in a single-studio v1. It is the wrong choice once a page is
 * rendering a specific member's data: a student's cancellation window must come
 * from THEIR studio, not from whichever row happens to sort first. Reading it
 * through membership.studioId keeps that correct when a second studio is
 * onboarded.
 */
export async function getStudioById(
  studioId: string,
): Promise<StudioSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studios')
    .select(STUDIO_COLUMNS)
    .eq('id', studioId)
    .maybeSingle();

  if (error) {
    logServerError('getStudioById', error);
    return null;
  }
  if (!data) return null;

  return toStudioSummary(data);
}

/**
 * Every class type in the studio, for colour assignment.
 *
 * ==========================================================================
 * WHY THE WHOLE LIST, NOT JUST THE WEEK'S TYPES
 * ==========================================================================
 * Tones are assigned by walking this list and giving each type its nearest free
 * slot, so the list DEFINES the mapping. Passing only the types visible in the
 * current week would make Vinyasa blue in a week it shares with Reformer and
 * something else in a week it does not — colour-coding that changes meaning
 * week to week is worse than none.
 *
 * Ordered by created_at so the mapping is append-only: adding a class type
 * never repaints the ones students already recognise.
 *
 * Includes INACTIVE types deliberately. A retired class type still appears on
 * past sessions, and it should keep its colour there rather than shifting to
 * whatever slot is free now.
 */
export async function getClassTypes(
  studioId: string,
): Promise<{ id: string; name: string; color: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('class_types')
    .select('id, name, color, created_at')
    .eq('studio_id', studioId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(200);

  if (error) {
    logServerError('getClassTypes', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
  }));
}

/**
 * The whole week's schedule in ONE round trip (solves HQ-1).
 *
 * v_sessions_with_availability computes booked_count, seats_available and
 * waiting_count in a single pass, so rendering forty sessions costs the same
 * as rendering one. The view is declared security_invoker = true, so RLS still
 * applies to the caller — a view that bypassed RLS would be a performance fix
 * that silently became a security hole.
 */
export async function getScheduleRange(
  studioId: string,
  fromIso: string,
  toIso: string,
): Promise<SessionWithAvailability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select('*')
    .eq('studio_id', studioId)
    .eq('status', 'scheduled')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true });

  if (error) {
    logServerError('getScheduleRange', error);
    return [];
  }
  return data ?? [];
}

export async function getSessionDetail(
  sessionId: string,
): Promise<SessionWithAvailability | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    logServerError('getSessionDetail', error);
    return null;
  }
  return data;
}

/**
 * Everything BookingPanel needs about one viewer's relationship to one
 * session, resolved server-side so the client components stay dumb.
 */
export interface ViewerSessionState {
  bookingId: string | null;
  waitlistEntryId: string | null;
  waitlistPosition: number | null;
  balance: number;
}

export async function getViewerSessionState(
  sessionId: string,
  userId: string,
): Promise<ViewerSessionState> {
  const supabase = await createClient();

  // Three independent reads, issued in parallel. They touch different tables
  // and none depends on another's result, so awaiting them in sequence would
  // triple the latency for no benefit.
  const [bookingResult, waitlistResult, balanceResult] = await Promise.all([
    supabase
      .from('bookings')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', userId)
      .eq('status', 'confirmed')
      .maybeSingle(),
    supabase
      .from('v_waitlist_positions')
      .select('id, position')
      .eq('session_id', sessionId)
      .eq('student_id', userId)
      .maybeSingle(),
    supabase
      .from('v_student_balances')
      .select('balance')
      .eq('student_id', userId)
      .maybeSingle(),
  ]);

  if (bookingResult.error) logServerError('viewerState:booking', bookingResult.error);
  if (waitlistResult.error) logServerError('viewerState:waitlist', waitlistResult.error);
  if (balanceResult.error) logServerError('viewerState:balance', balanceResult.error);

  const waitlist = waitlistResult.data as Pick<
    WaitlistPosition,
    'id' | 'position'
  > | null;

  return {
    bookingId: bookingResult.data?.id ?? null,
    waitlistEntryId: waitlist?.id ?? null,
    waitlistPosition: waitlist?.position ?? null,
    balance: balanceResult.data?.balance ?? 0,
  };
}

/** A student's upcoming confirmed bookings, joined to session detail. */
export interface UpcomingBooking {
  bookingId: string;
  sessionId: string;
  startsAt: string;
  className: string;
  instructorName: string;
  roomName: string;
}

export async function getUpcomingBookings(
  userId: string,
): Promise<UpcomingBooking[]> {
  const supabase = await createClient();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, session_id')
    .eq('student_id', userId)
    .eq('status', 'confirmed');

  if (error) {
    logServerError('getUpcomingBookings', error);
    return [];
  }
  if (!bookings || bookings.length === 0) return [];

  // One follow-up query for ALL sessions — not one per booking.
  const { data: sessions, error: sessionError } = await supabase
    .from('v_sessions_with_availability')
    .select('id, starts_at, class_type_name, instructor_name, room_name')
    .in(
      'id',
      bookings.map((booking) => booking.session_id),
    )
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });

  if (sessionError) {
    logServerError('getUpcomingBookings:sessions', sessionError);
    return [];
  }

  const bookingBySession = new Map(
    bookings.map((booking) => [booking.session_id, booking.id]),
  );

  return (sessions ?? []).flatMap((session) => {
    const bookingId = bookingBySession.get(session.id);
    if (!bookingId) return [];
    return [
      {
        bookingId,
        sessionId: session.id,
        startsAt: session.starts_at,
        className: session.class_type_name,
        instructorName: session.instructor_name,
        roomName: session.room_name,
      },
    ];
  });
}
