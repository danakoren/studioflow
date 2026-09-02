/**
 * app/admin/schedule/page.tsx — SERVER COMPONENT.
 *
 * The admin week view. Reuses WeekNavigator from the public schedule, so the
 * ?week= paging behaves identically in both places.
 *
 * Unlike /schedule this shows CANCELLED sessions too. A cancelled class is
 * still a fact about the owner's week — it is the row they click to see who was
 * refunded — and hiding it would make the admin view disagree with the database.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarPlus, ArrowRight } from 'lucide-react';
import { WeekNavigator } from '@/components/schedule/WeekNavigator';
import { WeekGrid } from '@/components/schedule/WeekGrid';
import { linkButtonClasses } from '@/components/ui/link-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyCalendarArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getAdminSessions } from '@/lib/data/admin.queries';
import { getStudioById, getClassTypes } from '@/lib/data/sessions.queries';
import { assignClassTones } from '@/lib/design/class-tone';
import {
  weekStart,
  addDays,
  localDateKey,
  formatDayHeading,
  formatShortDate,
  formatTime,
} from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Schedule — Admin — StudioFlow' };

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const weekOffset = clampWeek(params.week);

  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/schedule');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const studio = await getStudioById(membership.studioId);
  const timeZone = studio?.timezone ?? membership.timezone;

  const fromIso = weekStart(new Date(), weekOffset);
  const toIso = addDays(fromIso, 7);

  const [sessions, classTypes] = await Promise.all([
    getAdminSessions(membership.studioId, fromIso, toIso),
    getClassTypes(membership.studioId),
  ]);

  // The SAME assignment the public schedule uses, from the same studio-wide
  // list — so a class is the same colour for the owner and for the student.
  const tones = assignClassTones(classTypes);
  const nowIso = new Date().toISOString();

  const rangeLabel =
    weekOffset === 0
      ? 'This week'
      : `${formatShortDate(fromIso, timeZone)} – ${formatShortDate(
          addDays(toIso, -1),
          timeZone,
        )}`;

  const days = groupByDay(sessions, timeZone);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Schedule
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Every class this week, including cancelled ones.
          </p>
        </div>
        <Link
          href="/admin/schedule/new"
          className={linkButtonClasses()}
        >
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          Add a class
        </Link>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5">
        <WeekNavigator weekOffset={weekOffset} rangeLabel={rangeLabel} />
      </div>

      {/* Desktop: the same week grid the students see, in its admin variant —
          capacity instead of seats-left, and cancelled classes still shown. */}
      {sessions.length > 0 ? (
        <WeekGrid
          sessions={sessions.map((session) => ({
            id: session.id,
            classTypeId: session.classTypeId,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            className: session.className,
            instructorName: session.instructorName,
            roomName: session.roomName,
            status: session.status,
            seatsAvailable: session.seatsAvailable,
            bookedCount: session.bookedCount,
            capacity: session.capacity,
            waitingCount: session.waitingCount,
          }))}
          tones={tones}
          timeZone={timeZone}
          weekStartIso={fromIso}
          nowIso={nowIso}
          hrefFor={(id) => `/admin/sessions/${id}`}
          variant="admin"
        />
      ) : null}

      {days.length === 0 ? (
        <EmptyState
          art={<EmptyCalendarArt className="h-full w-full" />}
          title="Nothing scheduled this week"
          description="Add a class, or use weekly repeat to lay out a whole term at once."
        />
      ) : (
        <div className="space-y-6 lg:hidden">
        {days.map((day) => (
          <Card key={day.key}>
            <CardHeader title={formatDayHeading(day.firstStartsAt, timeZone)} />
            <ul className="divide-y divide-slate-200">
              {day.sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/admin/sessions/${session.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5"
                  >
                    <span
                      aria-hidden="true"
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: session.classColor }}
                    />
                    <time
                      dateTime={session.startsAt}
                      className="w-14 shrink-0 text-sm font-semibold tabular-nums text-slate-900"
                    >
                      {formatTime(session.startsAt, timeZone)}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">
                        {session.className}
                      </span>
                      <span className="block text-xs text-slate-600">
                        {session.instructorName} · {session.roomName}
                      </span>
                    </span>

                    {session.status === 'cancelled' ? (
                      <Badge tone="danger">Cancelled</Badge>
                    ) : (
                      <span className="shrink-0 text-sm tabular-nums text-slate-700">
                        {session.bookedCount}/{session.capacity}
                        {session.waitingCount > 0 ? (
                          <span className="text-slate-500">
                            {' '}
                            +{session.waitingCount}
                          </span>
                        ) : null}
                      </span>
                    )}
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        </div>
      )}
    </div>
  );
}

function clampWeek(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(-8, Math.min(26, parsed));
}

type SessionList = Awaited<ReturnType<typeof getAdminSessions>>;

interface DayGroup {
  key: string;
  firstStartsAt: string;
  sessions: SessionList;
}

/** Grouped on the STUDIO'S local date — see the note in app/schedule/page.tsx. */
function groupByDay(sessions: SessionList, timeZone: string): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const session of sessions) {
    const key = localDateKey(session.startsAt, timeZone);
    const existing = groups.get(key);
    if (existing) existing.sessions.push(session);
    else groups.set(key, { key, firstStartsAt: session.startsAt, sessions: [session] });
  }
  return [...groups.values()];
}
