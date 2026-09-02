'use client';

/**
 * components/booking/BookButton.tsx
 *
 * CLIENT COMPONENT. A leaf: it renders one button and calls one action.
 *
 * ==========================================================================
 * WHY THIS IS NOT OPTIMISTIC
 * ==========================================================================
 * Design §6.3 states the rule: optimistic display is appropriate when failure
 * is EXCEPTIONAL, and inappropriate when failure is an EXPECTED OUTCOME of the
 * domain.
 *
 * Booking can legitimately fail. The seat may have been taken microseconds
 * earlier by another student — that is precisely the race that book_session's
 * row lock exists to resolve, and SESSION_FULL is its correct, expected
 * answer. Optimistically rendering "Booked!" and then retracting it is a worse
 * experience than a brief spinner, and it erodes trust in every other
 * confirmation the product shows.
 *
 * So: a pending state, then the truth.
 *
 * (AttendanceToggle DOES use useOptimistic, because marking attendance has no
 * contended failure mode. Same codebase, opposite decision, for a reason.)
 * ==========================================================================
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check } from 'lucide-react';
import { bookSession } from '@/actions/booking.actions';
import { joinWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';
import { announceCreditSpent } from '@/components/feedback/CreditSpentToast';

export function BookButton({
  sessionId,
  classLabel,
}: {
  sessionId: string;
  /** Class name, so the toast can say WHAT was booked. Named classLabel, not
   *  className, so it cannot be mistaken for a styling prop. */
  classLabel?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  // Holds the BALANCE from the action, not just a boolean: the confirmation
  // shows the credit that was spent, and that number has to come from the
  // database rather than from a local decrement.
  const [booked, setBooked] = useState<{ newBalance: number | null } | null>(
    null,
  );
  const router = useRouter();

  function handleBook() {
    setError(null);
    startTransition(async () => {
      const result = await bookSession(sessionId);

      if (result.ok) {
        /*
         * Hand the receipt to the layout-level toast BEFORE anything else.
         *
         * This component is about to be unmounted: bookSession() called
         * revalidatePath(), so Next re-renders the route the moment the action
         * returns, BookingPanel takes its "already booked" branch, and
         * BookButton disappears. Any confirmation rendered here would be
         * destroyed before it painted — which is exactly what happened when it
         * was tried. CreditSpentToast lives in the root layout and survives.
         *
         * `newBalance` is nullable; with no number there is no arithmetic worth
         * showing, so the toast is simply skipped.
         */
        if (result.data.newBalance !== null) {
          announceCreditSpent({
            from: result.data.newBalance + 1,
            to: result.data.newBalance,
            label: classLabel,
          });
        }

        setBooked({ newBalance: result.data.newBalance });
        // Pulls the new seat count and nav state. Harmless that it unmounts
        // this component — the receipt is no longer held here.
        router.refresh();
        return;
      }
      setError({ code: result.code, message: result.message });
    });
  }

  function handleJoinWaitlist() {
    setError(null);
    startTransition(async () => {
      const result = await joinWaitlist(sessionId);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError({ code: result.code, message: result.message });
    });
  }

  if (booked) {
    // Brief inline acknowledgement; the richer receipt is the layout toast.
    return (
      <ActionMessage tone="success" message="You're booked in. See you there." />
    );
  }

  return (
    <div>
      <Button
        type="button"
        size="lg"
        onClick={handleBook}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Booking…
          </>
        ) : (
          <>
            <Check className="h-4 w-4" aria-hidden="true" />
            Book this class
          </>
        )}
      </Button>

      {error ? (
        <ActionMessage tone="error" message={error.message}>
          {/* SESSION_FULL is not a dead end. Business goal G1 depends on
              converting it into a waitlist entry, so the recovery action is
              offered right where the failure appeared. */}
          {error.code === 'SESSION_FULL' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleJoinWaitlist}
              disabled={isPending}
            >
              Join the waitlist
            </Button>
          ) : null}
        </ActionMessage>
      ) : null}
    </div>
  );
}
