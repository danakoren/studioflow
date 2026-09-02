/**
 * components/teach/TeachSessionCard.tsx
 *
 * SERVER COMPONENT. Zero JavaScript.
 *
 * A sibling of SessionCard rather than a reuse of it, because the two answer
 * different questions and SessionCard hardcodes a /schedule/ link:
 *
 *   SessionCard      -> "can I get in?"  -> seats REMAINING, availability tone
 *   TeachSessionCard -> "who is coming,
 *                        and have I marked
 *                        them?"           -> seats TAKEN, attendance state
 *
 * "3 spots left" is the wrong number to put in front of an instructor about to
 * call a register; "12 of 15 booked" is the one they need. Wiring an `href` and
 * a mode flag through SessionCard to serve both would make one component carry
 * two audiences' logic.
 */

import Link from 'next/link';
import { Clock, MapPin, Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTime } from '@/lib/time/tz';
import type { TeachingSession } from '@/lib/data/teach.queries';

export function TeachSessionCard({
  session,
  timeZone,
  attendanceState,
}: {
  session: TeachingSession;
  timeZone: string;
  /**
   * Resolved by the page, which already knows the studio's BR-11 window and
   * the clock. Kept out of this component so it stays a pure render.
   */
  attendanceState?: 'open' | 'closed' | 'not-yet';
}) {
  const cancelled = session.status === 'cancelled';

  return (
    <Link
      href={`/teach/${session.id}`}
      className="group flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:p-4"
    >
      {/* Decorative — every fact it hints at is also written in text. */}
      <span
        aria-hidden="true"
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: session.classColor }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={session.startsAt}
            className="text-lg font-semibold tabular-nums text-slate-900"
          >
            {formatTime(session.startsAt, timeZone)}
          </time>
          <h3 className="text-base font-medium text-slate-900">
            {session.className}
          </h3>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Room</dt>
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.roomName}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Duration</dt>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.durationMinutes} min</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Booked</dt>
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <dd className="tabular-nums">
              {session.bookedCount} of {session.capacity} booked
            </dd>
          </div>
        </dl>

        {session.waitingCount > 0 && !cancelled ? (
          <p className="mt-1.5 text-xs text-slate-500">
            {session.waitingCount} waiting — a no-show can be filled from the
            queue.
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {cancelled ? (
          <Badge tone="danger">Cancelled</Badge>
        ) : attendanceState === 'open' ? (
          <Badge tone="warning">Mark attendance</Badge>
        ) : attendanceState === 'closed' ? (
          <Badge tone="neutral">Closed</Badge>
        ) : null}

        <ChevronRight
          className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
