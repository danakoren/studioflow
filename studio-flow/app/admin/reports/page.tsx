/**
 * app/admin/reports/page.tsx — SERVER COMPONENT.
 *
 * C28–C31: fill rate by class type / instructor / time slot, attendance and
 * no-show rates, waitlist conversion, and the inactive-student list.
 *
 * ==========================================================================
 * ONLY FINISHED CLASSES COUNT
 * ==========================================================================
 * getAdminReports() filters to sessions that have already ended. Including
 * tomorrow's class would drag every fill rate toward zero — a seat that has not
 * yet had the chance to be filled is not an unfilled seat, and a report that
 * says otherwise is worse than no report, because it will be believed.
 *
 * ==========================================================================
 * FILL RATE IS ATTENDED SEATS, NOT BOOKED SEATS
 * ==========================================================================
 * Product Spec glossary: "attended seats divided by capacity". Booked-over-
 * capacity would be a utilisation figure that flatters the studio — a class
 * that sold out and had four no-shows is not a full class. Both numbers are
 * shown so the gap between them is visible, because that gap IS the no-show
 * problem the product exists to reduce (G3).
 *
 * ==========================================================================
 * WHY TABLES WITH BARS RATHER THAN CHARTS
 * ==========================================================================
 * Each breakdown compares one measure across a handful of named categories, and
 * a sorted table with a proportion bar per row does that better than a chart
 * would: the exact value is readable, the ordering is explicit, and it degrades
 * to a plain table on a phone. The bar is a single hue because it encodes ONE
 * measure; the percentage is always written beside it, so nothing depends on
 * colour or length alone.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserX, Users } from 'lucide-react';
import { StatTile, RateBar } from '@/components/admin/StatTile';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyChartArt } from '@/components/ui/illustrations';
import {
  TableWrap,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@/components/ui/table';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import {
  getAdminReports,
  type RateBreakdown,
} from '@/lib/data/admin.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { formatShortDate } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reports — Admin — StudioFlow' };

const pct = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;

export default async function AdminReportsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/reports');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const studio = await getStudioById(membership.studioId);
  const timeZone = studio?.timezone ?? membership.timezone;
  const nowIso = new Date().toISOString();

  const reports = await getAdminReports(membership.studioId, nowIso, timeZone);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Reports
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          The last {reports.windowDays} days — {reports.sessionsInWindow}{' '}
          finished {reports.sessionsInWindow === 1 ? 'class' : 'classes'}.
          Classes that have not happened yet are excluded.
        </p>
      </header>

      {reports.sessionsInWindow === 0 ? (
        <EmptyState
          art={<EmptyChartArt className="h-full w-full" />}
          title="Nothing to report yet"
          description={`No classes have finished in the last ${reports.windowDays} days, so there is nothing to measure. Come back once a few have run.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Fill rate"
              value={pct(reports.overall.fillRate)}
              hint={`${reports.overall.attended} attended of ${reports.overall.capacity} seats`}
            />
            <StatTile
              label="Attendance rate"
              value={pct(reports.overall.attendanceRate)}
              hint={`Of ${reports.overall.attended + reports.overall.absent} marked bookings`}
            />
            <StatTile
              label="No-show rate"
              value={pct(reports.overall.noShowRate)}
              hint={`${reports.overall.absent} marked absent`}
              tone={
                (reports.overall.noShowRate ?? 0) > 0.15 ? 'warning' : 'neutral'
              }
            />
            <StatTile
              label="Waitlist conversion"
              value={pct(reports.waitlist.conversionRate)}
              hint={`${reports.waitlist.promoted} of ${reports.waitlist.total} entries booked in`}
            />
          </div>

          {/* The booked/attended gap made explicit — this IS the no-show
              problem, and it is invisible if you only look at fill rate. */}
          {reports.overall.unmarked > 0 ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              {reports.overall.unmarked}{' '}
              {reports.overall.unmarked === 1 ? 'booking' : 'bookings'} in this
              window {reports.overall.unmarked === 1 ? 'was' : 'were'} never
              marked, so the attendance and no-show figures above are based only
              on the {reports.overall.attended + reports.overall.absent} that
              were.
            </div>
          ) : null}

          <Breakdown
            title="Fill rate by class type"
            description="Which classes are worth keeping (G5)."
            rows={reports.byClassType}
            unitLabel="Class type"
          />

          <Breakdown
            title="Fill rate by instructor"
            description="Read alongside the class type — a quiet slot is not the same as a quiet teacher."
            rows={reports.byInstructor}
            unitLabel="Instructor"
          />

          <Breakdown
            title="Fill rate by time of day"
            description="Start hour in the studio's timezone."
            rows={reports.byTimeSlot}
            unitLabel="Starts at"
          />

          <Card>
            <CardHeader
              title={`Inactive students (${reports.inactiveStudents.length})`}
              description="Active members with no attendance in the last 30 days. The list to work through before they lapse for good (C31)."
            />
            {reports.inactiveStudents.length === 0 ? (
              <div className="p-4 sm:p-5">
                <EmptyState
                  icon={<Users className="h-8 w-8" aria-hidden="true" />}
                  title="Everyone has been in recently"
                  description="No active student has gone 30 days without attending a class."
                />
              </div>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Student</TH>
                      <TH>Last attended</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reports.inactiveStudents.map((student) => (
                      <TR key={student.userId}>
                        <TD>
                          <Link
                            href={`/admin/students/${student.userId}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {student.name}
                          </Link>
                        </TD>
                        <TD className="text-slate-600">
                          {student.lastAttendedAt ? (
                            formatShortDate(student.lastAttendedAt, timeZone)
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                              Never attended
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * One breakdown table. Sorted by fill rate descending, so the answer to "what
 * should I drop?" is at the bottom without the owner having to scan.
 */
function Breakdown({
  title,
  description,
  rows,
  unitLabel,
}: {
  title: string;
  description: string;
  rows: RateBreakdown[];
  unitLabel: string;
}) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>{unitLabel}</TH>
              <TH align="right">Classes</TH>
              <TH align="right">Seats</TH>
              <TH align="right">Booked</TH>
              <TH align="right">Attended</TH>
              <TH align="right">Fill rate</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.label}>
                <TD className="font-medium">{row.label}</TD>
                <TD align="right">{row.sessions}</TD>
                <TD align="right">{row.capacity}</TD>
                <TD align="right">{row.booked}</TD>
                <TD align="right">{row.attended}</TD>
                <TD align="right">
                  <RateBar
                    value={row.fillRate}
                    label={`Fill rate for ${row.label}`}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}
