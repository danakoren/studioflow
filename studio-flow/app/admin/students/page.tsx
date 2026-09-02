/**
 * app/admin/students/page.tsx — SERVER COMPONENT.
 *
 * The member list with balances and last attendance (spec §3.4, C31).
 *
 * ONE set of queries for the whole table, not one per student — see the note on
 * getStudentList(). The balance column is the reason v_student_balances exists
 * (Scaling HQ-4): 200 members cost the same three round trips as 5.
 *
 * Sorted with zero-balance students first. That is the actionable end of the
 * list: a student with no credits cannot book, which is a sale waiting to
 * happen (G4) and the single most useful thing this page can surface.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { AddStudentForm } from '@/components/admin/AddStudentForm';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyPeopleArt } from '@/components/ui/illustrations';
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
import { getStudentList } from '@/lib/data/admin.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { formatShortDate } from '@/lib/time/tz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Students — Admin — StudioFlow' };

export default async function AdminStudentsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/students');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const [studio, members] = await Promise.all([
    getStudioById(membership.studioId),
    getStudentList(membership.studioId),
  ]);
  const timeZone = studio?.timezone ?? membership.timezone;

  const students = members
    .filter((member) => member.role === 'student')
    .sort((a, b) => {
      // Inactive members sink to the bottom; among the active, no-credit first.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.balance !== b.balance) return a.balance - b.balance;
      return a.name.localeCompare(b.name);
    });

  const staff = members.filter((member) => member.role !== 'student');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Students
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Balances and last attendance. Students with no credits are listed
          first — they cannot book until topped up.
        </p>
      </header>

      {/* One component, two mounts — the dashboard carries it for the
          mid-conversation case, and it lives here too because this is where an
          admin comes when they are thinking about the roster. */}
      <Card>
        <CardHeader
          title="Add a student"
          description="With public sign-up removed, this is the only way an account is created. They can sign in immediately."
        />
        <CardBody>
          <div className="max-w-md">
            <AddStudentForm />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Students (${students.length})`}
          description="Tap a row to see their ledger and add a package."
        />

        {students.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyPeopleArt className="h-full w-full" />}
              title="No students yet"
              description="Use the form above to create the first account."
            />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH align="right">Credits</TH>
                  <TH>Expires</TH>
                  <TH>Last attended</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {students.map((student) => (
                  <TR key={student.memberId}>
                    <TD>
                      <Link
                        href={`/admin/students/${student.userId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {student.name}
                      </Link>
                      {!student.isActive ? (
                        <span className="ml-2">
                          <Badge tone="neutral">Deactivated</Badge>
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-slate-600">{student.email}</TD>
                    <TD align="right">
                      {/* The number carries the meaning; the badge only draws
                          the eye. Never colour alone. */}
                      {student.balance === 0 ? (
                        <Badge tone="warning">0</Badge>
                      ) : (
                        <span className="font-medium">{student.balance}</span>
                      )}
                    </TD>
                    <TD className="text-slate-600">
                      {student.nextExpiryAt
                        ? formatShortDate(student.nextExpiryAt, timeZone)
                        : '—'}
                    </TD>
                    <TD className="text-slate-600">
                      {student.lastAttendedAt
                        ? formatShortDate(student.lastAttendedAt, timeZone)
                        : 'Never'}
                    </TD>
                    <TD align="right">
                      <Link
                        href={`/admin/students/${student.userId}`}
                        className="inline-flex items-center text-slate-400 hover:text-slate-700"
                        aria-label={`Open ${student.name}`}
                      >
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* Staff are members too, and an owner checking "who has access" should
          not have to query the database to find out. */}
      {staff.length > 0 ? (
        <Card>
          <CardHeader
            title={`Instructors and admins (${staff.length})`}
            description="Accounts with access beyond a student's own bookings."
          />
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {staff.map((member) => (
                  <TR key={member.memberId}>
                    <TD className="font-medium">{member.name}</TD>
                    <TD className="text-slate-600">{member.email}</TD>
                    <TD>
                      <Badge tone={member.role === 'admin' ? 'info' : 'neutral'}>
                        {member.role}
                      </Badge>
                    </TD>
                    <TD>
                      {member.isActive ? (
                        <span className="text-slate-600">Active</span>
                      ) : (
                        <Badge tone="neutral">Deactivated</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}
    </div>
  );
}
