import Link from 'next/link';
import { Ticket, LogIn, CalendarX2, Clock3 } from 'lucide-react';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getViewerSessionState } from '@/lib/data/sessions.queries';
import { hasStarted } from '@/lib/domain/policy';
import { formatDateTime } from '@/lib/time/tz';
import { BookButton } from './BookButton';
import { WaitlistButton } from './WaitlistButton';
import { CancelBookingDialog } from './CancelBookingDialog';
import { LeaveWaitlistButton } from './LeaveWaitlistButton';
import type { SessionWithAvailability } from '@/lib/types/database.types';

/**
 * components/booking/BookingPanel.tsx
 *
 * SERVER COMPONENT. The single most important composition decision in the UI.
 *
 * ==========================================================================
 * WHY THIS EXISTS
 * ==========================================================================
 * There are eight distinct things a viewer can be in relation to one session:
 * anonymous, not-a-member, already booked, already waitlisted, out of credits,
 * facing a full class, facing an open class, or looking at a class that has
 * already started or been cancelled.
 *
 * Resolving that on the CLIENT would mean shipping the balance, the booking
 * state, the waitlist position and the policy window to the browser, then
 * branching there — and every branch would need its own loading and error
 * handling. Worse, each client component would have to re-derive the same
 * viewer state independently, so a change to one rule would need finding in
 * four places.
 *
 * Instead this component resolves the state ONCE, on the server, and renders
 * EXACTLY ONE action component. The client components stay dumb and
 * single-purpose: BookButton books, WaitlistButton waits. Neither knows the
 * rules, and neither can disagree with the other about them.
 *
 * ==========================================================================
 * WHAT CROSSES THE BOUNDARY
 * ==========================================================================
 * Only plain serialisable values: strings, numbers, booleans. No Supabase
 * client, no Date object, no function. `refundEligible` in particular is
 * computed HERE and passed as a boolean, so CancelBookingDialog can state the
 * consequence without recomputing policy in the browser.
 *
 * Note this panel is rendered on the DETAIL page only, never inside the week
 * list. Resolving viewer state for forty cards would be forty extra round
 * trips — the HQ-1 N+1 in a new costume.
 */

export async function BookingPanel({
  session,
  timeZone,
  cancellationWindowHours,
}: {
  session: SessionWithAvailability;
  timeZone: string;
  cancellationWindowHours: number;
}) {
  const nowIso = new Date().toISOString();

  // ---- Terminal session states, identical for every viewer ---------------
  if (session.status === 'cancelled') {
    return (
      <PanelShell>
        <StateNotice
          icon={<CalendarX2 className="h-5 w-5" aria-hidden="true" />}
          title="This class has been cancelled"
          body={
            session.cancellation_reason
              ? `Reason: ${session.cancellation_reason}`
              : 'Anyone who had booked has had their credit returned.'
          }
        />
      </PanelShell>
    );
  }

  if (hasStarted(session.starts_at, nowIso)) {
    return (
      <PanelShell>
        <StateNotice
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          title="This class has already started"
          body="Have a look at the schedule for upcoming classes."
        />
      </PanelShell>
    );
  }

  // ---- Anonymous ---------------------------------------------------------
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <PanelShell>
        <p className="text-sm text-slate-600">
          Sign in to book a place in this class.
        </p>
        <Link
          href={`/login?next=/schedule/${session.id}`}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in to book
        </Link>
        <p className="mt-2 text-xs text-slate-500">
          New here? The studio sets accounts up — give them a call or ask at
          the front desk and you can book straight away.
        </p>
      </PanelShell>
    );
  }

  // ---- Authenticated but not a member ------------------------------------
  const membership = await getMembership();

  if (!membership) {
    return (
      <PanelShell>
        <StateNotice
          icon={<Ticket className="h-5 w-5" aria-hidden="true" />}
          title="You're not a member of this studio yet"
          body="Contact the studio and they'll add you, then you can book straight away."
        />
      </PanelShell>
    );
  }

  const viewer = await getViewerSessionState(session.id, user.id);

  // ---- Already booked ----------------------------------------------------
  if (viewer.bookingId) {
    return (
      <PanelShell>
        <p className="text-sm font-medium text-emerald-800">
          You&rsquo;re booked into this class.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {formatDateTime(session.starts_at, timeZone)} · {session.room_name}
        </p>
        <div className="mt-4">
          <CancelBookingDialog
            bookingId={viewer.bookingId}
            className={session.class_type_name}
            whenLabel={formatDateTime(session.starts_at, timeZone)}
            sessionStartsAtIso={session.starts_at}
            cancellationWindowHours={cancellationWindowHours}
          />
        </div>
      </PanelShell>
    );
  }

  // ---- Already waitlisted ------------------------------------------------
  if (viewer.waitlistEntryId) {
    return (
      <PanelShell>
        <p className="text-sm font-medium text-slate-900">
          You&rsquo;re on the waitlist
          {viewer.waitlistPosition ? (
            <>
              {' '}
              — position{' '}
              <span className="tabular-nums">{viewer.waitlistPosition}</span>
            </>
          ) : null}
          .
        </p>
        <p className="mt-1 text-sm text-slate-600">
          If someone cancels, we&rsquo;ll book you in automatically and let you
          know. No credit is taken while you wait.
        </p>
        <div className="mt-4">
          <LeaveWaitlistButton entryId={viewer.waitlistEntryId} />
        </div>
      </PanelShell>
    );
  }

  // ---- Full: offer the waitlist -----------------------------------------
  if (session.is_full) {
    return (
      <PanelShell>
        <p className="text-sm text-slate-700">
          This class is full
          {session.waiting_count > 0
            ? ` — ${session.waiting_count} ${
                session.waiting_count === 1 ? 'person is' : 'people are'
              } waiting.`
            : '.'}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Join the waitlist and you&rsquo;ll be booked in automatically if a
          place opens up. Nothing is charged unless that happens.
        </p>
        <div className="mt-4">
          <WaitlistButton sessionId={session.id} />
        </div>
      </PanelShell>
    );
  }

  // ---- Out of credits ----------------------------------------------------
  // Rendered as its own state rather than a disabled Book button, because the
  // repurchase prompt IS the sales mechanism behind business goal G4.
  if (viewer.balance < 1) {
    return (
      <PanelShell>
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-slate-900">
              You have no class credits left
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Contact the studio to buy a class package, and this class will be
              one tap away.
            </p>
            <Link
              href="/my/credits"
              className="mt-3 inline-flex text-sm font-medium text-brand-700 underline hover:text-brand-800"
            >
              View my credits
            </Link>
          </div>
        </div>
      </PanelShell>
    );
  }

  // ---- Bookable ----------------------------------------------------------
  return (
    <PanelShell>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-slate-700">
          {session.seats_available}{' '}
          {session.seats_available === 1 ? 'place' : 'places'} left
        </p>
        <p className="text-sm text-slate-500">
          Balance: <span className="tabular-nums">{viewer.balance}</span>
        </p>
      </div>
      <div className="mt-4">
        <BookButton
          sessionId={session.id}
          classLabel={session.class_type_name}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Booking uses 1 credit. Free cancellation up to{' '}
        {cancellationWindowHours} hours before the class.
      </p>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Booking"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      {children}
    </section>
  );
}

function StateNotice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{body}</p>
      </div>
    </div>
  );
}
