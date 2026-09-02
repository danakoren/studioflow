/**
 * components/booking/WaitlistRow.tsx
 *
 * SERVER COMPONENT. One waitlist entry, with its derived position.
 *
 * Only the LeaveWaitlistButton passed in as `action` ships JavaScript.
 *
 * The position is stated as "2nd in the queue" rather than a bare number
 * because a queue position is the one piece of information a waiting student
 * actually wants, and "2" next to a class name is ambiguous — it reads as a
 * count of places, not a rank.
 */

import type { ReactNode } from 'react';
import { MapPin, User, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTime, formatShortDate } from '@/lib/time/tz';
import type { StudentWaitlistEntry } from '@/lib/data/bookings.queries';

export function WaitlistRow({
  entry,
  timeZone,
  action,
}: {
  entry: StudentWaitlistEntry;
  timeZone: string;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
      <span
        aria-hidden="true"
        className="hidden w-1 shrink-0 self-stretch rounded-full sm:block"
        style={{ backgroundColor: entry.classColor ?? '#cbd5e1' }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {entry.startsAt ? (
            <time
              dateTime={entry.startsAt}
              className="text-base font-semibold tabular-nums text-slate-900"
            >
              {formatShortDate(entry.startsAt, timeZone)},{' '}
              {formatTime(entry.startsAt, timeZone)}
            </time>
          ) : null}
          <h3 className="text-base font-medium text-slate-900">
            {entry.className ?? 'Class details unavailable'}
          </h3>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {entry.instructorName ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Instructor</dt>
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{entry.instructorName}</dd>
            </div>
          ) : null}
          {entry.roomName ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Room</dt>
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{entry.roomName}</dd>
            </div>
          ) : null}
        </dl>

        {/* Sets the expectation: a place in the queue is not a booking, and no
            credit has been taken for it. */}
        <p className="mt-2 text-xs text-slate-500">
          No credit has been used. If a place opens up we&rsquo;ll book you in
          automatically and let you know.
        </p>

        {action ? <div className="mt-3">{action}</div> : null}
      </div>

      <div className="flex shrink-0 items-center sm:pt-0.5">
        <Badge tone="info">
          <Users className="h-3 w-3" aria-hidden="true" />
          {ordinal(entry.position)} in the queue
        </Badge>
      </div>
    </li>
  );
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th". */
function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
