/**
 * app/teach/page.tsx — SERVER COMPONENT.
 *
 * The instructor's dashboard.
 *
 * ==========================================================================
 * WHY THIS IS NOT JUST "UPCOMING CLASSES"
 * ==========================================================================
 * BR-11 opens the attendance window AT THE START INSTANT and closes it
 * `attendance_window_hours` after the class ends. So the class an instructor
 * most urgently needs from this page is the one that has ALREADY HAPPENED — the
 * 07:00 they just finished teaching, whose register is still open.
 *
 * A list of strictly-future sessions would show only classes whose attendance
 * cannot yet be marked, and would omit every class that can be. It would make
 * the feature unreachable from its own dashboard. So the page leads with
 * "Needs attendance" and follows with what is coming up.
 *
 * ==========================================================================
 * BOUNDED WINDOW
 * ==========================================================================
 * The read spans a few days either side of now rather than "all my sessions".
 * The backward reach is derived from the studio's own attendance window, so a
 * studio that allows three days to mark a register still sees every markable
 * class here — the bound follows the business rule instead of guessing.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TeachSessionCard } from '@/components/teach/TeachSessionCard';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyCalendarArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getTeachingSessions } from '@/lib/data/teach.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { isAttendanceWindowOpen, hasStarted } from '@/lib/domain/policy';
import { formatDayHeading, addDays, localDateKey } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Teaching — StudioFlow',
};

/** How far ahead the dashboard looks. */
const LOOKAHEAD_DAYS = 14;

export default async function TeachPage() {
  const user = await getVerifiedUser();
  // The layout already guarded this; the check narrows the type.
  if (!user) redirect('/login?next=/teach');

  const membership = await getMembership();
  const studio = membership ? await getStudioById(membership.studioId) : null;

  const timeZone = studio?.timezone ?? membership?.timezone ?? 'Asia/Jerusalem';
  const attendanceWindowHours = studio?.attendanceWindowHours ?? 24;
  const nowIso = new Date().toISOString();

  // Reach back far enough to cover every session whose register could still be
  // open, plus a day of slack for long classes. Derived, not guessed.
  const lookbackDays = Math.ceil(attendanceWindowHours / 24) + 1;

  const sessions = await getTeachingSessions(
    user.id,
    addDays(nowIso, -lookbackDays),
    addDays(nowIso, LOOKAHEAD_DAYS),
  );

  const active = sessions.filter((session) => session.status !== 'cancelled');

  const needsAttendance = active.filter(
    (session) =>
      isAttendanceWindowOpen(
        session.startsAt,
        session.endsAt,
        nowIso,
        attendanceWindowHours,
      ) && session.bookedCount > 0,
  );

  // Anything not yet started. Cancelled sessions are kept here so an instructor
  // is not surprised by turning up to a class the studio called off.
  const upcoming = sessions.filter((session) => !hasStarted(session.startsAt, nowIso));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Teaching
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Your classes, and the registers that are still open.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Needs attendance — the actionable work, so it leads             */}
      {/* ---------------------------------------------------------------- */}
      {needsAttendance.length > 0 ? (
        <Card>
          <CardHeader
            title="Needs attendance"
            description={`You can mark a register until ${attendanceWindowHours} hours after the class ends.`}
          />
          <div className="space-y-2 p-4 sm:p-5">
            {needsAttendance.map((session) => (
              <TeachSessionCard
                key={session.id}
                session={session}
                timeZone={timeZone}
                attendanceState="open"
              />
            ))}
          </div>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Upcoming, grouped by the STUDIO'S local day                      */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Upcoming classes"
          description={
            upcoming.length > 0
              ? 'Tap a class to see who is booked in.'
              : undefined
          }
        />

        {upcoming.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyCalendarArt className="h-full w-full" />}
              title="No classes coming up"
              description={`Nothing is scheduled for you in the next ${LOOKAHEAD_DAYS} days. Your studio admin sets the timetable.`}
            />
          </div>
        ) : (
          <div className="space-y-6 p-4 sm:p-5">
            {groupByDay(upcoming, timeZone).map((day) => (
              <section key={day.key} aria-labelledby={`teach-day-${day.key}`}>
                <h3
                  id={`teach-day-${day.key}`}
                  className="text-sm font-semibold text-slate-700"
                >
                  {formatDayHeading(day.firstStartsAt, timeZone)}
                </h3>
                <div className="mt-2 space-y-2">
                  {day.sessions.map((session) => (
                    <TeachSessionCard
                      key={session.id}
                      session={session}
                      timeZone={timeZone}
                      attendanceState="not-yet"
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      {/* A total absence of both lists is worth explaining rather than
          leaving as two empty panels. */}
      {needsAttendance.length === 0 && upcoming.length === 0 ? (
        <EmptyState
          art={<EmptyCalendarArt className="h-full w-full" />}
          title="Nothing to do right now"
          description="When you are assigned a class it will appear here, and its register opens the moment the class starts."
        />
      ) : null}
    </div>
  );
}

interface DayGroup {
  key: string;
  firstStartsAt: string;
  sessions: TeachingSessionList;
}

type TeachingSessionList = Awaited<
  ReturnType<typeof getTeachingSessions>
>;

/**
 * Grouped by the STUDIO'S local date, not the UTC date.
 *
 * Grouping on UTC puts a 01:00 local class on the previous day anywhere east of
 * Greenwich — the bug test DB-42 exists to catch. Sessions arrive already
 * ordered by starts_at, so one pass preserves order within each day.
 */
function groupByDay(
  sessions: TeachingSessionList,
  timeZone: string,
): DayGroup[] {
  const groups = new Map<string, DayGroup>();

  for (const session of sessions) {
    const key = localDateKey(session.startsAt, timeZone);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        key,
        firstStartsAt: session.startsAt,
        sessions: [session],
      });
    }
  }

  return [...groups.values()];
}
