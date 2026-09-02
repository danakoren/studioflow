/**
 * lib/data/admin.queries.ts
 *
 * READ-ONLY. Studio-owner reads.
 *
 * ==========================================================================
 * EVERY FUNCTION TAKES studioId FROM THE CALLER'S MEMBERSHIP
 * ==========================================================================
 * Not from a route parameter, and not from a form field. An admin of Studio B
 * naming Studio A would be refused by is_studio_admin() in the policies
 * regardless — but an action that has to rely on the database to catch a
 * mistake it should not have made is a worse design than one that cannot make
 * it. The pages below read membership.studioId server-side and pass it here.
 *
 * ==========================================================================
 * AGGREGATION HAPPENS IN ONE PASS, NOT PER ROW
 * ==========================================================================
 * The reports and the student list are the two places where an N+1 is most
 * tempting: "for each student, fetch their balance", "for each session, count
 * attendance". Both would be one query per row on the pages an owner opens
 * most. Each function here issues a small fixed number of queries and joins in
 * memory — which is the right trade for a studio of tens-to-hundreds of
 * members, and is why v_student_balances exists (Scaling HQ-2 / HQ-4).
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type { MemberRole } from '@/lib/types/database.types';

/* ========================================================================== */
/* Catalogue — the options every session form needs                            */
/* ========================================================================== */

export interface CatalogueOption {
  id: string;
  name: string;
  /** Rooms only. */
  capacity?: number;
  /** Class types only. */
  durationMinutes?: number;
  color?: string;
}

export interface Catalogue {
  classTypes: CatalogueOption[];
  rooms: CatalogueOption[];
  instructors: CatalogueOption[];
}

/**
 * Everything a session needs to be created: active class types, active rooms,
 * and the people who may teach.
 *
 * THREE queries in parallel rather than three awaited in sequence — they are
 * independent, and a form that cannot render until all three return should wait
 * for the slowest, not the sum.
 */
export async function getCatalogue(studioId: string): Promise<Catalogue> {
  const supabase = await createClient();

  const [classTypes, rooms, members] = await Promise.all([
    supabase
      .from('class_types')
      .select('id, name, duration_minutes, color')
      .eq('studio_id', studioId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('rooms')
      .select('id, name, capacity')
      .eq('studio_id', studioId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('studio_members')
      .select('user_id, role, profiles!inner(id, full_name)')
      .eq('studio_id', studioId)
      .eq('is_active', true)
      .in('role', ['instructor', 'admin'])
      .order('role'),
  ]);

  if (classTypes.error) logServerError('getCatalogue:classTypes', classTypes.error);
  if (rooms.error) logServerError('getCatalogue:rooms', rooms.error);
  if (members.error) logServerError('getCatalogue:instructors', members.error);

  return {
    classTypes: (classTypes.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      durationMinutes: row.duration_minutes,
      color: row.color,
    })),
    rooms: (rooms.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      capacity: row.capacity,
    })),
    // An admin may also teach, so admins appear as assignable instructors —
    // which matches teaches_session(), where the role check is
    // role in ('instructor','admin').
    instructors: (members.data ?? []).map((row) => {
      const profile = normaliseJoin(row.profiles);
      return {
        id: row.user_id,
        name: String(profile?.full_name ?? 'Unnamed'),
      };
    }),
  };
}

/* ========================================================================== */
/* Sessions in a window                                                        */
/* ========================================================================== */

export interface AdminSession {
  id: string;
  /** Needed for stable colour-coding — see lib/design/class-tone.ts. */
  classTypeId: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'cancelled';
  cancellationReason: string | null;
  className: string;
  classColor: string;
  roomName: string;
  instructorName: string;
  instructorId: string;
  capacity: number;
  bookedCount: number;
  seatsAvailable: number;
  waitingCount: number;
}

export async function getAdminSessions(
  studioId: string,
  fromIso: string,
  toIso: string,
  { limit = 200 } = {},
): Promise<AdminSession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select(
      'id, class_type_id, starts_at, ends_at, status, cancellation_reason, class_type_name, class_type_color, room_name, instructor_name, instructor_id, capacity, booked_count, seats_available, waiting_count',
    )
    .eq('studio_id', studioId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) {
    logServerError('getAdminSessions', error);
    return [];
  }

  return (data ?? []).map(mapAdminSession);
}

export async function getAdminSession(
  sessionId: string,
): Promise<(AdminSession & { studioId: string; classTypeId: string; roomId: string }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select(
      'id, studio_id, class_type_id, room_id, starts_at, ends_at, status, cancellation_reason, class_type_name, class_type_color, room_name, instructor_name, instructor_id, capacity, booked_count, seats_available, waiting_count',
    )
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    logServerError('getAdminSession', error);
    return null;
  }
  if (!data) return null;

  return {
    ...mapAdminSession(data),
    studioId: data.studio_id,
    classTypeId: data.class_type_id,
    roomId: data.room_id,
  };
}

/* ========================================================================== */
/* Students                                                                    */
/* ========================================================================== */

export interface StudentSummary {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  isActive: boolean;
  joinedAt: string;
  balance: number;
  nextExpiryAt: string | null;
  /** Start time of their most recent class marked 'attended'. */
  lastAttendedAt: string | null;
}

/**
 * The studio's member list with balances and last attendance.
 *
 * THREE queries, not one-per-student (Scaling HQ-4):
 *   1. members joined to profiles
 *   2. v_student_balances for the whole studio  <- the reason that view exists
 *   3. attended bookings joined to their session start times
 *
 * Then joined in memory. A studio of 200 members costs the same three round
 * trips as a studio of 5.
 */
export async function getStudentList(
  studioId: string,
  { limit = 500 } = {},
): Promise<StudentSummary[]> {
  const supabase = await createClient();

  const [members, balances, attendance] = await Promise.all([
    supabase
      .from('studio_members')
      .select('id, user_id, role, is_active, joined_at, profiles!inner(id, full_name, email)')
      .eq('studio_id', studioId)
      .order('joined_at', { ascending: false })
      .limit(limit),
    supabase
      .from('v_student_balances')
      .select('student_id, balance, next_expiry_at')
      .eq('studio_id', studioId),
    supabase
      .from('bookings')
      .select('student_id, sessions!inner(starts_at)')
      .eq('studio_id', studioId)
      .eq('status', 'confirmed')
      .eq('attendance', 'attended')
      .order('booked_at', { ascending: false })
      .limit(2000),
  ]);

  if (members.error) {
    logServerError('getStudentList:members', members.error);
    return [];
  }
  if (balances.error) logServerError('getStudentList:balances', balances.error);
  if (attendance.error) logServerError('getStudentList:attendance', attendance.error);

  const balanceBy = new Map(
    (balances.data ?? []).map((row) => [
      row.student_id,
      { balance: row.balance ?? 0, nextExpiryAt: row.next_expiry_at ?? null },
    ]),
  );

  // Keep only the LATEST attended session per student.
  const lastAttended = new Map<string, string>();
  for (const row of attendance.data ?? []) {
    const session = normaliseJoin(row.sessions);
    const startsAt = session?.starts_at ? String(session.starts_at) : null;
    if (!startsAt) continue;
    const current = lastAttended.get(row.student_id);
    if (!current || startsAt > current) lastAttended.set(row.student_id, startsAt);
  }

  return (members.data ?? []).map((row) => {
    const profile = normaliseJoin(row.profiles);
    const money = balanceBy.get(row.user_id);
    return {
      memberId: row.id,
      userId: row.user_id,
      name: String(profile?.full_name ?? 'Unnamed'),
      email: String(profile?.email ?? ''),
      role: row.role,
      isActive: row.is_active,
      joinedAt: row.joined_at,
      balance: money?.balance ?? 0,
      nextExpiryAt: money?.nextExpiryAt ?? null,
      lastAttendedAt: lastAttended.get(row.user_id) ?? null,
    };
  });
}

/** One member, for the student detail page. */
export async function getStudentDetail(
  studioId: string,
  userId: string,
): Promise<StudentSummary | null> {
  const all = await getStudentList(studioId);
  return all.find((student) => student.userId === userId) ?? null;
}

/* ========================================================================== */
/* Dashboard                                                                   */
/* ========================================================================== */

export interface AdminDashboard {
  todaysSessions: AdminSession[];
  /** Registers whose BR-11 window is open with at least one unmarked booking. */
  registersAwaitingAttention: AdminSession[];
  upcomingCount: number;
  activeMemberCount: number;
  studentsWithNoCredits: number;
  totalCreditsOutstanding: number;
}

export async function getAdminDashboard(
  studioId: string,
  nowIso: string,
  timeZone: string,
  attendanceWindowHours: number,
): Promise<AdminDashboard> {
  const lookbackDays = Math.ceil(attendanceWindowHours / 24) + 1;

  const [sessions, students, unmarked] = await Promise.all([
    getAdminSessions(
      studioId,
      shiftDays(nowIso, -lookbackDays),
      shiftDays(nowIso, 30),
    ),
    getStudentList(studioId),
    getUnmarkedSessionIds(studioId, shiftDays(nowIso, -lookbackDays), nowIso),
  ]);

  const todayKey = localDay(nowIso, timeZone);
  const now = new Date(nowIso).getTime();

  const todaysSessions = sessions.filter(
    (session) => localDay(session.startsAt, timeZone) === todayKey,
  );

  const registersAwaitingAttention = sessions.filter((session) => {
    if (session.status === 'cancelled') return false;
    if (!unmarked.has(session.id)) return false;
    const opens = new Date(session.startsAt).getTime();
    const closes =
      new Date(session.endsAt).getTime() + attendanceWindowHours * 3_600_000;
    return now >= opens && now <= closes;
  });

  const studentsOnly = students.filter((s) => s.role === 'student' && s.isActive);

  return {
    todaysSessions,
    registersAwaitingAttention,
    upcomingCount: sessions.filter(
      (s) => s.status === 'scheduled' && new Date(s.startsAt).getTime() > now,
    ).length,
    activeMemberCount: students.filter((s) => s.isActive).length,
    studentsWithNoCredits: studentsOnly.filter((s) => s.balance === 0).length,
    totalCreditsOutstanding: studentsOnly.reduce((sum, s) => sum + s.balance, 0),
  };
}

/** Session ids in the window that still have at least one unmarked booking. */
async function getUnmarkedSessionIds(
  studioId: string,
  fromIso: string,
  toIso: string,
): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select('session_id, sessions!inner(starts_at)')
    .eq('studio_id', studioId)
    .eq('status', 'confirmed')
    .is('attendance', null)
    .gte('sessions.starts_at', fromIso)
    .lt('sessions.starts_at', toIso)
    .limit(1000);

  if (error) {
    logServerError('getUnmarkedSessionIds', error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.session_id));
}

/* ========================================================================== */
/* Reports                                                                     */
/* ========================================================================== */

export interface RateBreakdown {
  label: string;
  sessions: number;
  capacity: number;
  booked: number;
  attended: number;
  /** Design §447: fill rate is ATTENDED seats over capacity, not booked. */
  fillRate: number | null;
}

export interface AdminReports {
  windowDays: number;
  sessionsInWindow: number;
  overall: {
    capacity: number;
    booked: number;
    attended: number;
    absent: number;
    unmarked: number;
    fillRate: number | null;
    attendanceRate: number | null;
    noShowRate: number | null;
  };
  byClassType: RateBreakdown[];
  byInstructor: RateBreakdown[];
  byTimeSlot: RateBreakdown[];
  waitlist: {
    total: number;
    promoted: number;
    conversionRate: number | null;
  };
  inactiveStudents: { userId: string; name: string; lastAttendedAt: string | null }[];
}

/**
 * The owner's report (C28–C31).
 *
 * Only FINISHED sessions count. Including a class that starts tomorrow would
 * drag every fill rate toward zero and make the whole report meaningless — a
 * seat that has not had the chance to be filled is not an unfilled seat.
 */
export async function getAdminReports(
  studioId: string,
  nowIso: string,
  timeZone: string,
  { windowDays = 30, inactiveDays = 30 } = {},
): Promise<AdminReports> {
  const supabase = await createClient();
  const fromIso = shiftDays(nowIso, -windowDays);

  const sessions = (
    await getAdminSessions(studioId, fromIso, nowIso, { limit: 500 })
  ).filter(
    (session) =>
      session.status === 'scheduled' &&
      new Date(session.endsAt).getTime() <= new Date(nowIso).getTime(),
  );

  const sessionIds = sessions.map((s) => s.id);

  const [bookings, waitlist, students] = await Promise.all([
    sessionIds.length
      ? supabase
          .from('bookings')
          .select('session_id, student_id, status, attendance')
          .in('session_id', sessionIds)
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('waitlist_entries')
      .select('id, status, joined_at')
      .eq('studio_id', studioId)
      .gte('joined_at', fromIso)
      .limit(2000),
    getStudentList(studioId),
  ]);

  if (bookings.error) logServerError('getAdminReports:bookings', bookings.error);
  if (waitlist.error) logServerError('getAdminReports:waitlist', waitlist.error);

  const bySession = new Map<
    string,
    { booked: number; attended: number; absent: number; unmarked: number }
  >();
  for (const id of sessionIds) {
    bySession.set(id, { booked: 0, attended: 0, absent: 0, unmarked: 0 });
  }
  for (const row of bookings.data ?? []) {
    const bucket = bySession.get(row.session_id);
    if (!bucket || row.status !== 'confirmed') continue;
    bucket.booked += 1;
    if (row.attendance === 'attended') bucket.attended += 1;
    else if (row.attendance === 'absent') bucket.absent += 1;
    else bucket.unmarked += 1;
  }

  const overall = { capacity: 0, booked: 0, attended: 0, absent: 0, unmarked: 0 };
  for (const session of sessions) {
    const bucket = bySession.get(session.id);
    overall.capacity += session.capacity;
    overall.booked += bucket?.booked ?? 0;
    overall.attended += bucket?.attended ?? 0;
    overall.absent += bucket?.absent ?? 0;
    overall.unmarked += bucket?.unmarked ?? 0;
  }

  const group = (keyOf: (session: AdminSession) => string): RateBreakdown[] => {
    const map = new Map<string, RateBreakdown>();
    for (const session of sessions) {
      const label = keyOf(session);
      const bucket = bySession.get(session.id);
      const existing =
        map.get(label) ??
        { label, sessions: 0, capacity: 0, booked: 0, attended: 0, fillRate: null };
      existing.sessions += 1;
      existing.capacity += session.capacity;
      existing.booked += bucket?.booked ?? 0;
      existing.attended += bucket?.attended ?? 0;
      map.set(label, existing);
    }
    return [...map.values()]
      .map((row) => ({
        ...row,
        fillRate: row.capacity > 0 ? row.attended / row.capacity : null,
      }))
      .sort((a, b) => (b.fillRate ?? -1) - (a.fillRate ?? -1));
  };

  const waitlistRows = waitlist.data ?? [];
  const promoted = waitlistRows.filter((row) => row.status === 'promoted').length;

  const inactiveCutoff = new Date(shiftDays(nowIso, -inactiveDays)).getTime();
  const inactiveStudents = students
    .filter((s) => s.role === 'student' && s.isActive)
    .filter(
      (s) =>
        s.lastAttendedAt === null ||
        new Date(s.lastAttendedAt).getTime() < inactiveCutoff,
    )
    .map((s) => ({
      userId: s.userId,
      name: s.name,
      lastAttendedAt: s.lastAttendedAt,
    }));

  const marked = overall.attended + overall.absent;

  return {
    windowDays,
    sessionsInWindow: sessions.length,
    overall: {
      ...overall,
      fillRate: overall.capacity > 0 ? overall.attended / overall.capacity : null,
      attendanceRate: marked > 0 ? overall.attended / marked : null,
      noShowRate: marked > 0 ? overall.absent / marked : null,
    },
    byClassType: group((s) => s.className),
    byInstructor: group((s) => s.instructorName),
    byTimeSlot: group((s) => `${hourInZone(s.startsAt, timeZone)}:00`),
    waitlist: {
      total: waitlistRows.length,
      promoted,
      conversionRate: waitlistRows.length > 0 ? promoted / waitlistRows.length : null,
    },
    inactiveStudents,
  };
}

/* ========================================================================== */
/* helpers                                                                     */
/* ========================================================================== */

function mapAdminSession(row: {
  id: string;
  class_type_id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled';
  cancellation_reason: string | null;
  class_type_name: string;
  class_type_color: string;
  room_name: string;
  instructor_name: string;
  instructor_id: string;
  capacity: number;
  booked_count: number;
  seats_available: number;
  waiting_count: number;
}): AdminSession {
  return {
    id: row.id,
    classTypeId: row.class_type_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    className: row.class_type_name,
    classColor: row.class_type_color,
    roomName: row.room_name,
    instructorName: row.instructor_name,
    instructorId: row.instructor_id,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    seatsAvailable: row.seats_available,
    waitingCount: row.waiting_count,
  };
}

/**
 * supabase-js types an !inner join as an object OR an array depending on how it
 * infers the relationship. Normalise rather than casting blindly — the same
 * approach lib/auth/require.ts takes for the studios join.
 */
function normaliseJoin(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return (value[0] as Record<string, unknown> | undefined) ?? null;
  }
  return (value as Record<string, unknown> | null) ?? null;
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** Local calendar day in the studio's zone, for "today" comparisons. */
function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Local hour in the studio's zone, for the by-time-slot breakdown. */
function hourInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .padStart(2, '0');
}
