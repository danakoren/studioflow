/**
 * app/admin/page.tsx — SERVER COMPONENT. The owner's dashboard.
 *
 * Spec §3.4: "today's sessions, fill rates, alerts".
 *
 * ==========================================================================
 * WHAT LEADS THE PAGE, AND WHY
 * ==========================================================================
 * Registers whose BR-11 window is still open with unmarked students come FIRST,
 * above today's timetable. That is the only thing on this page with a DEADLINE:
 * once the window closes, finalize_attendance() applies the studio's default
 * (normally 'attended'), and the no-show report quietly stops reflecting
 * reality. Everything else here can be read at leisure.
 *
 * The alert links to /teach/[sessionId], not to a separate admin register.
 * mark_attendance() already accepts an admin for any session in their studio,
 * so a second UI for the same job would be two places to keep correct.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CalendarDays,
  ClipboardList,
  Users,
  Ticket,
  TriangleAlert,
  ArrowRight,
  BarChart3,
  BookMarked,
  Settings,
} from 'lucide-react';
import { AddStudentForm } from '@/components/admin/AddStudentForm';
import { StatTile } from '@/components/admin/StatTile';
import { linkButtonClasses } from '@/components/ui/link-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getAdminDashboard } from '@/lib/data/admin.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { formatTime } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Admin — StudioFlow' };

export default async function AdminDashboardPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin');

  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const studio = await getStudioById(membership.studioId);
  const timeZone = studio?.timezone ?? membership.timezone;
  const nowIso = new Date().toISOString();

  const dashboard = await getAdminDashboard(
    membership.studioId,
    nowIso,
    timeZone,
    studio?.attendanceWindowHours ?? 24,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {studio?.name ?? 'Studio'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Today at a glance, and anything waiting on you.
          </p>
        </div>
        <Link
          href="/admin/schedule/new"
          className={linkButtonClasses()}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Add a class
        </Link>
      </header>

      {/* KPI row. Single figures, so tiles rather than charts. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Upcoming classes"
          value={dashboard.upcomingCount}
          hint="Next 30 days"
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <StatTile
          label="Active members"
          value={dashboard.activeMemberCount}
          icon={<Users className="h-5 w-5" />}
        />
        <StatTile
          label="Credits outstanding"
          value={dashboard.totalCreditsOutstanding}
          hint="Held by active students"
          icon={<Ticket className="h-5 w-5" />}
        />
        <StatTile
          label="Students with no credits"
          value={dashboard.studentsWithNoCredits}
          hint={
            dashboard.studentsWithNoCredits > 0
              ? 'They cannot book until topped up'
              : undefined
          }
          tone={dashboard.studentsWithNoCredits > 0 ? 'warning' : 'neutral'}
          icon={<Ticket className="h-5 w-5" />}
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* The only time-critical thing on the page                          */}
      {/* ---------------------------------------------------------------- */}
      {dashboard.registersAwaitingAttention.length > 0 ? (
        <Card className="border-amber-300">
          <CardHeader
            title="Registers still open"
            description="Attendance has not been marked. Once the window closes the studio default is applied automatically, so the no-show figures stop being accurate."
          />
          <ul className="divide-y divide-slate-200">
            {dashboard.registersAwaitingAttention.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/teach/${session.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/60 sm:px-5"
                >
                  <TriangleAlert
                    className="h-4 w-4 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-900">
                      {session.className}
                    </span>
                    <span className="text-slate-600">
                      {' '}
                      · {formatTime(session.startsAt, timeZone)} ·{' '}
                      {session.instructorName}
                    </span>
                  </span>
                  <Badge tone="warning">{session.bookedCount} booked</Badge>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Add a student — the ONLY way an account is created now            */}
      {/* ---------------------------------------------------------------- */}
      {/*
        Placed on the dashboard rather than buried under /admin/students
        because, with public sign-up removed, enrolling someone at the desk is
        now a front-of-house task that happens mid-conversation. The same form
        is also mounted on /admin/students, where the roster lives.
      */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Add a student"
            description="Creates their account straight away — no confirmation email, so they can sign in before they leave the desk."
          />
          <CardBody>
            <AddStudentForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Today"
            description={
              dashboard.todaysSessions.length > 0
                ? 'Seats taken against capacity.'
                : undefined
            }
            action={
              <Link
                href="/admin/schedule"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
              >
                Full schedule
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            }
          />

          {dashboard.todaysSessions.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={<ClipboardList className="h-8 w-8" aria-hidden="true" />}
                title="No classes today"
                description="Nothing is scheduled in the studio's timezone today."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {dashboard.todaysSessions.map((session) => (
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
                            +{session.waitingCount} waiting
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
          )}
        </Card>
      </div>


      {/*
        This grid is the SECOND LEVEL of navigation, and it carries the pages the
        header no longer does. RoleNav gives an admin one concise row — Dashboard,
        Schedule, Students, Reports, Settings — so the owner's own student and
        instructor pages live here instead of crowding the bar. An owner who also
        attends or teaches classes reaches them in one click from the page they
        land on.
      */}
      <nav
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Admin sections"
      >
        {[
          { href: '/admin/schedule', label: 'Schedule', icon: CalendarDays },
          { href: '/admin/students', label: 'Students', icon: Users },
          { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
          { href: '/admin/settings', label: 'Settings', icon: Settings },
          { href: '/teach', label: 'Teaching', icon: ClipboardList },
          { href: '/my/bookings', label: 'My classes', icon: BookMarked },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50/40"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
