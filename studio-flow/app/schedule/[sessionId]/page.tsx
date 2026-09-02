import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, MapPin, User } from 'lucide-react';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { Card, CardBody } from '@/components/ui/card';
import { AvailabilityBadge } from '@/components/schedule/AvailabilityBadge';
import {
  getPrimaryStudio,
  getSessionDetail,
} from '@/lib/data/sessions.queries';
import { formatDayHeading, formatTime } from '@/lib/time/tz';

/**
 * app/schedule/[sessionId]/page.tsx — SERVER COMPONENT.
 *
 * This is the ONLY page that renders BookingPanel, and that is deliberate.
 * The panel resolves the viewer's booking, waitlist entry and credit balance,
 * which is three queries per session. Doing that for the forty cards on the
 * week view would reintroduce the HQ-1 N+1 the schedule page exists to avoid.
 *
 * The week view therefore shows only what the aggregate view already returned;
 * the personal state is resolved here, for one session, on demand.
 */

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({
  params,
}: {
  // Next.js 15: params is a Promise and must be awaited.
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const [studio, session] = await Promise.all([
    getPrimaryStudio(),
    getSessionDetail(sessionId),
  ]);

  // RLS returns zero rows for a session in another studio, so a cross-tenant
  // id is indistinguishable from a non-existent one. That is the correct
  // behaviour: confirming "this exists but you may not see it" is itself a
  // disclosure.
  if (!studio || !session) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/schedule"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {session.class_type_name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {formatDayHeading(session.starts_at, studio.timezone)}
              </p>
            </div>
            <AvailabilityBadge
              seatsAvailable={session.seats_available}
              waitingCount={session.waiting_count}
            />
          </div>

          {session.class_type_description ? (
            <p className="mt-4 text-sm text-slate-700">
              {session.class_type_description}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Time</dt>
              <dd>
                <time dateTime={session.starts_at}>
                  {formatTime(session.starts_at, studio.timezone)}
                </time>
                {' – '}
                <time dateTime={session.ends_at}>
                  {formatTime(session.ends_at, studio.timezone)}
                </time>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Instructor</dt>
              <dd>{session.instructor_name}</dd>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Room</dt>
              <dd>{session.room_name}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <BookingPanel
        session={session}
        timeZone={studio.timezone}
        cancellationWindowHours={studio.cancellationWindowHours}
      />
    </div>
  );
}
