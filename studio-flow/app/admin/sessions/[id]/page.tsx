/**
 * app/admin/sessions/[id]/page.tsx — SERVER COMPONENT.
 *
 * Full management of one class: edit, cancel, and the roster with manual
 * booking and removal (spec §3.4).
 *
 * The session is fetched first and its studio compared against the ACTOR'S
 * membership. A class belonging to another tenant is notFound() rather than
 * forbidden — "this exists but is not yours" is itself a disclosure, and the
 * same reasoning maps PGRST116 to NOT_FOUND in lib/errors/map.ts. RLS would
 * return zero rows anyway; this turns that into a clear 404 instead of a page
 * rendering an inexplicably empty class.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Users, Clock, MapPin, CalendarX2 } from 'lucide-react';
import {
  EditSessionForm,
  CancelSessionDialog,
  RemoveBookingButton,
  AddStudentForm,
} from '@/components/admin/SessionAdminControls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import {
  getAdminSession,
  getCatalogue,
  getStudentList,
} from '@/lib/data/admin.queries';
import { getSessionRoster, getSessionWaitlist } from '@/lib/data/teach.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { formatDayHeading, formatTime, formatDateTime } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Class — Admin — StudioFlow' };

export default async function AdminSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/schedule');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const session = await getAdminSession(id);
  if (!session) notFound();
  if (session.studioId !== membership.studioId) notFound();

  const [studio, catalogue, roster, waitlist, members] = await Promise.all([
    getStudioById(session.studioId),
    getCatalogue(session.studioId),
    getSessionRoster(id),
    getSessionWaitlist(id),
    getStudentList(session.studioId),
  ]);

  const timeZone = studio?.timezone ?? membership.timezone;
  const cancelled = session.status === 'cancelled';

  // Only active students who are not already on this roster can be added.
  const bookedIds = new Set(roster.map((entry) => entry.studentId));
  const addable = members
    .filter(
      (member) =>
        member.role === 'student' &&
        member.isActive &&
        !bookedIds.has(member.userId),
    )
    .map((member) => ({
      id: member.userId,
      name: `${member.name} (${member.balance} credit${member.balance === 1 ? '' : 's'})`,
    }));

  return (
    <div className="space-y-6">
      <Link
        href="/admin/schedule"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>

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
                {session.waitingCount > 0
                  ? ` · ${session.waitingCount} waiting`
                  : ''}
              </dd>
            </div>
          </dl>

          {cancelled ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
              <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Cancelled — everyone booked in was refunded and notified.
                {session.cancellationReason
                  ? ` Reason: ${session.cancellationReason}`
                  : ''}
              </span>
            </p>
          ) : (
            <div className="mt-4">
              <CancelSessionDialog
                sessionId={session.id}
                className={session.className}
                whenLabel={formatDateTime(session.startsAt, timeZone)}
                bookedCount={session.bookedCount}
              />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Editing a cancelled class is meaningless — it has no future. */}
      {!cancelled ? (
        <Card>
          <CardHeader
            title="Edit this class"
            description="Room and instructor clashes are refused by the database, so a conflicting change fails rather than double-booking."
          />
          <CardBody>
            <EditSessionForm
              sessionId={session.id}
              catalogue={catalogue}
              studioTimeZone={timeZone}
              current={{
                classTypeId: session.classTypeId,
                roomId: session.roomId,
                instructorId: session.instructorId,
                startsAt: session.startsAt,
                capacity: session.capacity,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={`Roster (${roster.length})`}
          description={
            cancelled
              ? undefined
              : 'Walk-ins and phone bookings go here. Removing someone asks whether to return their credit.'
          }
        />

        {!cancelled ? (
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <AddStudentForm
              sessionId={session.id}
              students={addable}
              isFull={session.seatsAvailable <= 0}
            />
          </div>
        ) : null}

        {roster.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={<Users className="h-8 w-8" aria-hidden="true" />}
              title="Nobody booked in"
              description="Students who book will appear here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {roster.map((entry) => (
              <li
                key={entry.bookingId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
              >
                <span className="min-w-0">
                  <span className="font-medium text-slate-900">
                    {entry.studentName ?? 'Student'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {entry.source === 'admin' ? 'Added by the studio' : 'Booked themselves'}
                    {entry.attendance
                      ? ` · marked ${entry.attendance === 'attended' ? 'present' : 'absent'}`
                      : ''}
                  </span>
                </span>

                {!cancelled ? (
                  <RemoveBookingButton
                    bookingId={entry.bookingId}
                    studentName={entry.studentName ?? 'this student'}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {waitlist.length > 0 ? (
        <Card>
          <CardHeader
            title={`Waiting list (${waitlist.length})`}
            description="In joining order. A freed seat goes to the first in line automatically, unless the class is inside the promotion cutoff."
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
