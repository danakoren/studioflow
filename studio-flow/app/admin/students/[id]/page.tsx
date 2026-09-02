/**
 * app/admin/students/[id]/page.tsx — SERVER COMPONENT.
 *
 * Student detail: balance, ledger, and the two credit controls.
 *
 * ==========================================================================
 * WHY THE LEDGER IS SHOWN NEXT TO THE FORMS
 * ==========================================================================
 * The ledger is append-only and cannot be edited by anyone, including this
 * admin (INV-4). That makes it the record an owner reads when a student
 * disputes a charge — so it belongs on the same screen as the controls that
 * write to it, where a mistake is visible immediately rather than discovered
 * during an argument weeks later.
 *
 * getLedgerPage() is reused verbatim from the student's own /my/credits page.
 * One implementation of "read this person's credit history" means the owner and
 * the student are looking at the same numbers, which is the entire point of
 * having an audit trail.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Ticket, CalendarCheck } from 'lucide-react';
import {
  GrantCreditsForm,
  AdjustCreditsForm,
} from '@/components/admin/CreditForms';
import { StatTile } from '@/components/admin/StatTile';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
import { getStudentDetail } from '@/lib/data/admin.queries';
import { getLedgerPage } from '@/lib/data/credits.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { describeLedgerEntry } from '@/lib/domain/policy';
import { formatDateTime, formatShortDate } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Student — Admin — StudioFlow' };

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/students');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const [studio, student] = await Promise.all([
    getStudioById(membership.studioId),
    // Scoped to the ACTOR'S studio, so an id from another tenant simply is not
    // found rather than being fetched and then filtered.
    getStudentDetail(membership.studioId, id),
  ]);

  if (!student) notFound();

  const timeZone = studio?.timezone ?? membership.timezone;
  const ledger = await getLedgerPage(student.userId, null, 25);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/students"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to students
      </Link>

      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {student.name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {student.email}
          {!student.isActive ? (
            <span className="ml-2">
              <Badge tone="neutral">Deactivated</Badge>
            </span>
          ) : null}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Credits"
          value={student.balance}
          tone={student.balance === 0 ? 'warning' : 'neutral'}
          hint={student.balance === 0 ? 'Cannot book until topped up' : undefined}
          icon={<Ticket className="h-5 w-5" />}
        />
        <StatTile
          label="Next expiry"
          value={
            student.nextExpiryAt
              ? formatShortDate(student.nextExpiryAt, timeZone)
              : '—'
          }
        />
        <StatTile
          label="Last attended"
          value={
            student.lastAttendedAt
              ? formatShortDate(student.lastAttendedAt, timeZone)
              : 'Never'
          }
          icon={<CalendarCheck className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Add a package"
            description="For a class card bought in person or by message. v1 does not sell online."
          />
          <CardBody>
            <GrantCreditsForm
              studentId={student.userId}
              studentName={student.name}
              studioTimeZone={timeZone}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Correction"
            description="Put right a mistake, or take back a credit. Always recorded with your reason."
          />
          <CardBody>
            <AdjustCreditsForm
              studentId={student.userId}
              studentName={student.name}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Credit history"
          description="Append-only. Neither you nor anyone else can edit or delete a line — a correction is a new entry."
        />

        {ledger.entries.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={<Ticket className="h-8 w-8" aria-hidden="true" />}
              title="No credit movement yet"
              description="Add a package above and it will appear here."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>What happened</TH>
                  <TH>When</TH>
                  <TH align="right">Change</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.entries.map((entry) => (
                  <TR key={entry.id}>
                    <TD>
                      {describeLedgerEntry(entry.entryType, entry.delta, {
                        className: entry.className,
                        when: entry.sessionStartsAt
                          ? formatDateTime(entry.sessionStartsAt, timeZone)
                          : null,
                        note: entry.note,
                      })}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDateTime(entry.createdAt, timeZone)}
                    </TD>
                    <TD align="right">
                      {/* Sign is written out, so the direction survives
                          greyscale and screen readers. */}
                      <span
                        className={
                          entry.delta > 0
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-slate-700'
                        }
                      >
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}

        {ledger.nextCursor ? (
          <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Showing the 25 most recent entries. The student sees their full
            history, paged, on their own credits page.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
