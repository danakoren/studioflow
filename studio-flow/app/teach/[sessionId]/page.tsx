/**
 * app/teach/[sessionId]/page.tsx — SERVER COMPONENT.
 *
 * The class roster, and the register.
 *
 * ==========================================================================
 * THE PER-SESSION CHECK IS THE POINT
 * ==========================================================================
 * Passing app/teach/layout.tsx proves the viewer is staff. It proves NOTHING
 * about this particular session. An instructor may only reach the roster of a
 * class they personally teach, so this page verifies instructor_id against the
 * viewer and 404s otherwise (Basic Security §2.5; tests PR-24, PR-26, PR-33).
 *
 * That check is a UX affordance layered on the real one: bookings_select_own_roster
 * and profiles_select_own_roster both route through teaches_session(), which
 * compares sessions.instructor_id to auth.uid(). A hand-crafted PostgREST
 * request for a colleague's roster returns zero rows whether or not this page
 * exists. What the check buys is a clear 404 instead of a page that renders as
 * an inexplicably empty class.
 *
 * notFound() rather than a 403, deliberately: "this exists but is not yours"
 * is itself a disclosure. The same reasoning maps PGRST116 to NOT_FOUND in
 * lib/errors/map.ts.
 *
 * ==========================================================================
 * WHY THE REGISTER MAY BE READ-ONLY
 * ==========================================================================
 * BR-11 opens marking at the start instant and closes it
 * attendance_window_hours after the end. Outside that range the toggles render
 * DISABLED rather than hidden, so a marked register still shows what was
 * recorded — see the note in AttendanceToggle.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  CalendarX2,
  Clock,
  MapPin,
  Hourglass,
} from 'lucide-react';
import { AttendanceToggle } from '@/components/attendance/AttendanceToggle';
import { MarkAllPresentButton } from '@/components/attendance/MarkAllPresentButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyPeopleArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import {
  getTeachingSession,
  getSessionRoster,
  getSessionWaitlist,
} from '@/lib/data/teach.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { isAttendanceWindowOpen } from '@/lib/domain/policy';
import { formatDayHeading, formatTime } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Class roster — StudioFlow',
};

export default async function TeachSessionPage({
  params,
}: {
  // In Next.js 15+ params is a Promise and MUST be awaited.
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/teach');

  const membership = await getMembership();

  const session = await getTeachingSession(sessionId);
  if (!session) notFound();

  // The per-session gate. An admin may view any roster in their own studio —
  // which is what mark_attendance() already permits, so refusing here would
  // deny in the UI what the database allows.
  const isOwnClass = session.instructorId === user.id;
  const isStudioAdmin =
    membership?.role === 'admin' && membership.studioId === session.studioId;
  if (!isOwnClass && !isStudioAdmin) notFound();

  const [studio, roster, waitlist] = await Promise.all([
    getStudioById(session.studioId),
    getSessionRoster(sessionId),
    getSessionWaitlist(sessionId),
  ]);

  const timeZone = studio?.timezone ?? membership?.timezone ?? 'Asia/Jerusalem';
  const attendanceWindowHours = studio?.attendanceWindowHours ?? 24;
  const nowIso = new Date().toISOString();

  const cancelled = session.status === 'cancelled';
  const windowOpen =
    !cancelled &&
    isAttendanceWindowOpen(
      session.startsAt,
      session.endsAt,
      nowIso,
      attendanceWindowHours,
    );

  const notYetStarted = new Date(nowIso) < new Date(session.startsAt);
  const unmarkedCount = roster.filter((row) => row.attendance === null).length;
  const presentCount = roster.filter(
    (row) => row.attendance === 'attended',
  ).length;

  return (
    <div className="space-y-6">
      <Link
        href="/teach"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to teaching
      </Link>

      {/* ---------------------------------------------------------------- */}
      {/* Session header                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                {session.className}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {formatDayHeading(session.startsAt, timeZone)}
              </p>
            </div>
            {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
          </div>

          <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Time</dt>
              <Clock className="h-4 w-4" aria-hidden="true" />
              <dd className="tabular-nums">
                {formatTime(session.startsAt, timeZone)} –{' '}
                {formatTime(session.endsAt, timeZone)}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Room</dt>
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <dd>{session.roomName}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Booked</dt>
              <Users className="h-4 w-4" aria-hidden="true" />
              <dd className="tabular-nums">
                {session.bookedCount} of {session.capacity} booked
              </dd>
            </div>
          </dl>

          {cancelled ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
              <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                This class was cancelled and its students have been refunded.
                {session.cancellationReason
                  ? ` Reason: ${session.cancellationReason}`
                  : ''}
              </span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Register                                                         */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Register"
          description={
            roster.length > 0
              ? `${presentCount} of ${roster.length} marked present.`
              : undefined
          }
          action={
            windowOpen ? (
              <MarkAllPresentButton
                sessionId={session.id}
                unmarkedCount={unmarkedCount}
              />
            ) : null
          }
        />

        {/*
          The register's state is stated BEFORE the controls, so an instructor
          facing greyed-out buttons knows why rather than assuming a fault.
        */}
        {!cancelled && !windowOpen ? (
          <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
            <p className="flex items-start gap-2 text-sm text-slate-600">
              <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {notYetStarted
                  ? 'The register opens when the class starts.'
                  : `The register closed ${attendanceWindowHours} hours after this class ended. Ask your studio admin if something needs changing.`}
              </span>
            </p>
          </div>
        ) : null}

        {roster.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyPeopleArt className="h-full w-full" />}
              title="Nobody booked in yet"
              description="Students who book this class will appear here, ready to mark off."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 px-4 sm:px-5">
            {roster.map((entry) => (
              <li key={entry.bookingId}>
                <AttendanceToggle
                  bookingId={entry.bookingId}
                  // A withheld profile still gets a row — see resolveNames().
                  studentName={entry.studentName ?? 'Student'}
                  attendance={entry.attendance}
                  disabled={!windowOpen}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Waitlist                                                         */}
      {/* ---------------------------------------------------------------- */}
      {waitlist.length > 0 ? (
        <Card>
          <CardHeader
            title={`Waiting list (${waitlist.length})`}
            description="In joining order. If someone cancels, the first in line is booked in automatically."
          />
          <ol className="divide-y divide-slate-200">
            {waitlist.map((entry) => (
              <li
                key={entry.entryId}
                className="flex items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-700">
                  {entry.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                  {/*
                    Usually withheld. profiles_select_own_roster exposes a name
                    only for a CONFIRMED booking, and a waitlisted student holds
                    none — so RLS returns nothing and this reads "Waiting
                    student". That is the privacy rule working as specified, not
                    a gap to patch here.
                  */}
                  {entry.studentName ?? 'Waiting student'}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
