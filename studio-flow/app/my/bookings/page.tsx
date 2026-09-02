/**
 * app/my/bookings/page.tsx — SERVER COMPONENT.
 *
 * The student dashboard. Middleware, RoleNav and app/my/layout.tsx have all
 * pointed here since Part 3 began; this is the page they were pointing at.
 *
 * ==========================================================================
 * FOUR READS, ISSUED IN PARALLEL
 * ==========================================================================
 * The studio settings, the balance, the bookings and the waitlist entries are
 * mutually independent, so they go out together. Awaiting them in sequence
 * would stack four round trips of latency for no benefit — and each of the
 * booking reads is itself already aggregate rather than per-row (see
 * lib/data/bookings.queries.ts).
 *
 * ==========================================================================
 * AUTHORISATION
 * ==========================================================================
 * app/my/layout.tsx already redirects a signed-out visitor and forces password
 * rotation, so this page does not repeat either check — one guard, in one
 * place. It still resolves the user, because the queries need the id.
 *
 * As everywhere else, none of that is the security boundary. Every query here
 * reads as the calling user and bookings_select_own / waitlist_select_own
 * restrict rows to auth.uid(). The page contains no `where student_id = ...`
 * filter that a developer could forget.
 *
 * ==========================================================================
 * DYNAMIC, NOT CACHED
 * ==========================================================================
 * A cached copy of this page is one student's bookings served to the next
 * visitor. force-dynamic is not a performance oversight here, it is the
 * correctness requirement.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarCheck } from 'lucide-react';
import { CancelBookingDialog } from '@/components/booking/CancelBookingDialog';
import { linkButtonClasses } from '@/components/ui/link-button';
import { LeaveWaitlistButton } from '@/components/booking/LeaveWaitlistButton';
import { BookingRow } from '@/components/booking/BookingRow';
import { WaitlistRow } from '@/components/booking/WaitlistRow';
import { CreditBalanceCard } from '@/components/credits/CreditBalanceCard';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyCalendarArt, EmptyHistoryArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getBalance } from '@/lib/data/credits.queries';
import {
  getMyBookings,
  getMyWaitlistEntries,
  type StudentBooking,
} from '@/lib/data/bookings.queries';
import { getStudioById } from '@/lib/data/sessions.queries';
import { formatDateTime } from '@/lib/time/tz';
import { hasStarted } from '@/lib/domain/policy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My classes — StudioFlow',
};

export default async function MyBookingsPage() {
  const user = await getVerifiedUser();
  // Defence in depth behind the layout guard; also narrows the type.
  if (!user) redirect('/login?next=/my/bookings');

  const membership = await getMembership();
  const nowIso = new Date().toISOString();

  const [studio, balance, bookings, waitlist] = await Promise.all([
    membership ? getStudioById(membership.studioId) : Promise.resolve(null),
    getBalance(user.id),
    getMyBookings(user.id, nowIso),
    getMyWaitlistEntries(user.id, nowIso),
  ]);

  // Falling back rather than failing: a student with no resolvable membership
  // still sees their own bookings, just rendered in the default timezone with
  // the schema's default cancellation window.
  const timeZone = studio?.timezone ?? membership?.timezone ?? 'Asia/Jerusalem';
  const cancellationWindowHours = studio?.cancellationWindowHours ?? 12;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          My classes
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Everything you have booked, your place in any queue, and what
          you&rsquo;ve already been to.
        </p>
      </header>

      {/* Design principle 3: the balance is always visible — it is the
          mechanism behind G4, not a courtesy. */}
      <CreditBalanceCard
        balance={balance.balance}
        nextExpiryAt={balance.nextExpiryAt}
        timeZone={timeZone}
        nowIso={nowIso}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Upcoming                                                          */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Upcoming classes"
          description={
            bookings.upcoming.length > 0
              ? `Free cancellation up to ${cancellationWindowHours} hours before a class starts.`
              : undefined
          }
        />

        {bookings.upcoming.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyCalendarArt className="h-full w-full" />}
              title="Nothing booked yet"
              description="Browse the schedule and book a class — it takes one tap."
              action={
                <Link
                  href="/schedule"
                  className={linkButtonClasses()}
                >
                  <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                  See the schedule
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {bookings.upcoming.map((booking) => (
              <BookingRow
                key={booking.bookingId}
                booking={booking}
                timeZone={timeZone}
                action={renderCancelAction(booking, {
                  timeZone,
                  cancellationWindowHours,
                  nowIso,
                })}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Waitlist — only when there is something to show                   */}
      {/* ---------------------------------------------------------------- */}
      {waitlist.length > 0 ? (
        <Card>
          <CardHeader
            title="On the waitlist"
            description="Positions update automatically as people leave — you never have to refresh to keep your place."
          />
          <ul className="divide-y divide-slate-200">
            {waitlist.map((entry) => (
              <WaitlistRow
                key={entry.entryId}
                entry={entry}
                timeZone={timeZone}
                action={<LeaveWaitlistButton entryId={entry.entryId} />}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Past                                                              */}
      {/* ---------------------------------------------------------------- */}
      {bookings.past.length > 0 ? (
        <Card>
          <CardHeader
            title="Past classes"
            description="Your most recent classes, with whether you were marked as attending."
          />
          <ul className="divide-y divide-slate-200">
            {bookings.past.map((booking) => (
              <BookingRow
                key={booking.bookingId}
                booking={booking}
                timeZone={timeZone}
                isPast
              />
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Past classes" />
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyHistoryArt className="h-full w-full" />}
              title="No history yet"
              description="Once you've been to a class it will appear here, along with whether you were marked as attending."
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * The cancel control for one upcoming booking, or nothing.
 *
 * Two cases get NO button, for different reasons:
 *
 *   session already cancelled  There is nothing left to cancel — the studio
 *                              did it, and the credit is already back. The row
 *                              explains that in full instead.
 *
 *   class already started      BR-8. cancel_booking() would reject it anyway,
 *                              so offering the control would produce a button
 *                              whose only outcome is an error. This can happen
 *                              on a page left open across the start time, since
 *                              the upcoming/past split was decided at render.
 *
 * Everything the dialog needs is passed as PLAIN STRINGS. No Date object
 * crosses the server/client boundary, and the dialog is handed the window in
 * hours so it can word the consequence itself — it predicts, the database
 * decides, the result reports.
 */
function renderCancelAction(
  booking: StudentBooking,
  {
    timeZone,
    cancellationWindowHours,
    nowIso,
  }: { timeZone: string; cancellationWindowHours: number; nowIso: string },
) {
  if (booking.sessionStatus === 'cancelled') return null;
  if (booking.startsAt === null) return null;
  if (hasStarted(booking.startsAt, nowIso)) return null;

  return (
    <CancelBookingDialog
      bookingId={booking.bookingId}
      className={booking.className ?? 'this class'}
      whenLabel={formatDateTime(booking.startsAt, timeZone)}
      sessionStartsAtIso={booking.startsAt}
      cancellationWindowHours={cancellationWindowHours}
    />
  );
}
