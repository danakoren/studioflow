/**
 * components/schedule/SessionCard.tsx
 *
 * SERVER COMPONENT. Zero JavaScript ships for this.
 *
 * The whole card is a link to the session detail page rather than an inline
 * booking button. That is deliberate: booking needs the viewer's credit
 * balance and existing-booking state, and resolving that for all forty
 * sessions on a week view would be forty extra round trips (the HQ-1 N+1
 * again). The card shows only what the aggregate view already returned.
 */

import Link from 'next/link';
import { Clock, MapPin, User } from 'lucide-react';
import { AvailabilityBadge } from './AvailabilityBadge';
import { formatTime } from '@/lib/time/tz';
import type { SessionWithAvailability } from '@/lib/types/database.types';

export function SessionCard({
  session,
  timeZone,
}: {
  session: SessionWithAvailability;
  timeZone: string;
}) {
  return (
    <Link
      href={`/schedule/${session.id}`}
      className={[
        'group flex items-stretch gap-3 rounded-xl bg-white p-3.5 sm:p-4',
        'shadow-sm ring-1 ring-slate-200/70',
        // The card IS the link, so it earns the lift — see Card's `interactive`
        // note on why this cue is opt-in rather than default.
        'transition-[transform,box-shadow,background-color] duration-200',
        'ease-[var(--ease-out-soft)]',
        'hover:-translate-y-0.5 hover:bg-brand-50/30 hover:shadow-md hover:ring-brand-200',
        'active:translate-y-0 active:shadow-sm',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
      ].join(' ')}
    >
      {/* Class-type colour stripe. Decorative only — every fact it hints at is
          also written in text. */}
      <span
        aria-hidden="true"
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: session.class_type_color }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={session.starts_at}
            className="text-lg font-semibold tabular-nums text-slate-900"
          >
            {formatTime(session.starts_at, timeZone)}
          </time>
          <h3 className="text-base font-medium text-slate-900">
            {session.class_type_name}
          </h3>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Instructor</dt>
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.instructor_name}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Room</dt>
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.room_name}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Duration</dt>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.duration_minutes} min</dd>
          </div>
        </dl>
      </div>

      <div className="flex shrink-0 items-center">
        <AvailabilityBadge
          seatsAvailable={session.seats_available}
          waitingCount={session.waiting_count}
        />
      </div>
    </Link>
  );
}
