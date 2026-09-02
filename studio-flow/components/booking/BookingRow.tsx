/**
 * components/booking/BookingRow.tsx
 *
 * SERVER COMPONENT. One row of "My classes".
 *
 * The client island pattern again: this row renders as pure markup, and only
 * CancelBookingDialog — passed in as `action` by the page — carries JavaScript.
 * Marking the row itself "use client" to get one button would drag every row,
 * its icons and its date formatting into the browser bundle.
 *
 * The layout deliberately mirrors SessionCard (colour stripe, time, title,
 * metadata row) so a class looks like the same object on the schedule and here.
 * It is NOT a link, because the primary action on this page is cancelling
 * rather than navigating, and a button inside a card-sized link is a nested
 * interactive target that keyboard and screen-reader users navigate badly.
 */

import type { ReactNode } from 'react';
import { Clock, MapPin, User, CalendarX2, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatTime, formatShortDate } from '@/lib/time/tz';
import type { StudentBooking } from '@/lib/data/bookings.queries';

export function BookingRow({
  booking,
  timeZone,
  action,
  isPast = false,
}: {
  booking: StudentBooking;
  timeZone: string;
  /** CancelBookingDialog for an upcoming class; omitted for history. */
  action?: ReactNode;
  /**
   * Gates the attendance badge. Attendance is null on every upcoming booking,
   * so without this flag "not marked yet" would render against classes that
   * have not happened — which reads as a problem rather than a fact.
   */
  isPast?: boolean;
}) {
  const sessionCancelled = booking.sessionStatus === 'cancelled';

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
      {/* Decorative only — everything it hints at is also written in text. */}
      <span
        aria-hidden="true"
        className="hidden w-1 shrink-0 self-stretch rounded-full sm:block"
        style={{ backgroundColor: booking.classColor ?? '#cbd5e1' }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {booking.startsAt ? (
            <time
              dateTime={booking.startsAt}
              className="text-base font-semibold tabular-nums text-slate-900"
            >
              {formatShortDate(booking.startsAt, timeZone)},{' '}
              {formatTime(booking.startsAt, timeZone)}
            </time>
          ) : null}

          <h3 className="text-base font-medium text-slate-900">
            {/* Falls back rather than vanishing — see StudentBooking's note. */}
            {booking.className ?? 'Class details unavailable'}
          </h3>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {booking.instructorName ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Instructor</dt>
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{booking.instructorName}</dd>
            </div>
          ) : null}
          {booking.roomName ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Room</dt>
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{booking.roomName}</dd>
            </div>
          ) : null}
          {booking.durationMinutes !== null ? (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Duration</dt>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <dd>{booking.durationMinutes} min</dd>
            </div>
          ) : null}
        </dl>

        {/*
          A studio-cancelled class is the one case where the student did nothing
          wrong and still lost their place, so it is stated in full — including
          the reason and the fact that the credit came back — rather than
          reduced to a badge.
        */}
        {sessionCancelled ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
            <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">
                The studio cancelled this class.
              </strong>{' '}
              Your credit has been returned.
              {booking.cancellationReason
                ? ` Reason: ${booking.cancellationReason}`
                : ''}
            </span>
          </p>
        ) : null}

        {action ? <div className="mt-3">{action}</div> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:pt-0.5">
        {isPast ? <AttendanceBadge booking={booking} /> : null}
      </div>
    </li>
  );
}

/**
 * Attendance, for past classes only.
 *
 * BR-12 resolves an unmarked booking to the studio's default — normally
 * 'attended' — so that an instructor's administrative oversight never costs a
 * student a credit. attendance_auto_resolved records that it happened that way,
 * and the distinction is shown rather than hidden: telling a student they
 * "attended" a class nobody actually registered them at is a claim the product
 * should not make silently.
 */
function AttendanceBadge({ booking }: { booking: StudentBooking }) {
  if (booking.sessionStatus === 'cancelled') return null;

  // Marking is still open (BR-11), or the finalize_attendance job has not run
  // yet. Said plainly, because a blank space next to a finished class invites
  // the student to wonder whether their attendance was recorded at all.
  if (booking.attendance === null) {
    return <Badge tone="neutral">Attendance not marked yet</Badge>;
  }

  if (booking.attendance === 'attended') {
    return (
      <Badge tone={booking.attendanceAutoResolved ? 'neutral' : 'success'}>
        {booking.attendanceAutoResolved ? (
          <>
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
            Not marked — counted as attended
          </>
        ) : (
          'Attended'
        )}
      </Badge>
    );
  }

  return <Badge tone="danger">Missed</Badge>;
}
