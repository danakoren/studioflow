/**
 * app/admin/schedule/new/page.tsx — SERVER COMPONENT.
 *
 * Resolves the catalogue and the studio's timezone on the SERVER, then hands
 * both to the client form. The timezone in particular must not be inferred in
 * the browser — see the note in SessionForm.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { SessionForm } from '@/components/admin/SessionForm';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getCatalogue } from '@/lib/data/admin.queries';
import { getStudioById } from '@/lib/data/sessions.queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Add a class — Admin — StudioFlow' };

export default async function NewSessionPage() {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin/schedule/new');
  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  const [studio, catalogue] = await Promise.all([
    getStudioById(membership.studioId),
    getCatalogue(membership.studioId),
  ]);

  const timeZone = studio?.timezone ?? membership.timezone;

  // Tomorrow, on the hour — a plausible slot that is always in the future, so
  // the futureDatetimeSchema refinement does not reject the untouched default.
  const seed = new Date();
  seed.setUTCDate(seed.getUTCDate() + 1);
  seed.setUTCMinutes(0, 0, 0);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/schedule"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>

      <div className="mx-auto w-full max-w-xl">
        <Card>
          <CardHeader
            title="Add a class"
            description="One class, or a weekly repeat. Each generated week is an ordinary, independently editable class."
          />
          <CardBody>
            <SessionForm
              catalogue={catalogue}
              studioTimeZone={timeZone}
              defaultStartsAtIso={seed.toISOString()}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
