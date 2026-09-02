/**
 * app/admin/settings/page.tsx — SERVER COMPONENT.
 *
 * Studio policy. Every field here is read at DECISION TIME by the Postgres
 * functions, which is what makes "a studio changing its cancellation window is
 * a data change, not a deployment" true rather than aspirational.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StudioSettingsForm } from '@/components/admin/StudioSettingsForm';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getStudioById } from '@/lib/data/sessions.queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings — Admin — StudioFlow' };

export default async function AdminSettingsPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/settings');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const studio = await getStudioById(membership.studioId);
  if (!studio) redirect('/admin');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Your studio&rsquo;s rules. These take effect immediately, for every
          decision made from now on.
        </p>
      </header>

      <div className="mx-auto w-full max-w-xl">
        <Card>
          <CardHeader
            title="Booking and attendance policy"
            description="Read each consequence before you change it — these determine what happens to students' credits."
          />
          <CardBody>
            <StudioSettingsForm
              current={{
                name: studio.name,
                timezone: studio.timezone,
                cancellationWindowHours: studio.cancellationWindowHours,
                promotionCutoffHours: studio.promotionCutoffHours,
                attendanceWindowHours: studio.attendanceWindowHours,
                unmarkedAttendanceDefault: studio.unmarkedAttendanceDefault,
              }}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
