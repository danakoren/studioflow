'use client';

/**
 * components/booking/CancelBookingDialog.tsx
 *
 * CLIENT COMPONENT.
 *
 * ==========================================================================
 * THE MOST CAREFULLY DESIGNED SCREEN IN THE PRODUCT (Design §8.2)
 * ==========================================================================
 * A student must NEVER discover a forfeited credit after the fact. This dialog
 * states the exact consequence BEFORE the confirm button is reachable, in one
 * of two forms:
 *
 *   outside the window ->  "Cancelling now returns 1 credit to your account."
 *   inside the window  ->  "This is a late cancellation. Your credit will not
 *                           be returned."
 *
 * Destructive styling appears ONLY in the second case. A red button on a
 * harmless action trains people to ignore red buttons, which is exactly when
 * the genuinely costly one arrives.
 *
 * ==========================================================================
 * WHERE THE POLICY DECISION ACTUALLY HAPPENS
 * ==========================================================================
 * This component DECIDES NOTHING. It calls describeCancellation() from
 * lib/domain/policy.ts purely to choose the wording. The authoritative rule
 * lives in cancel_booking() in Postgres, evaluated transactionally under a row
 * lock at the moment of cancellation.
 *
 * The two can drift — the student may leave this dialog open across the
 * 12-hour boundary. So the ACTUAL outcome is read back from the action's
 * `refunded` field and shown afterwards. The dialog predicts; the database
 * decides; the result reports. A contract test asserts the two implementations
 * agree on identical fixtures.
 *
 * ==========================================================================
 * WHY <dialog> RATHER THAN A DIV
 * ==========================================================================
 * The native element gives focus trapping, Escape-to-close, inert background
 * and correct screen-reader semantics without a single line of code. A
 * hand-rolled modal that gets any of those wrong is an accessibility defect
 * that no test in our suite would catch.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, CalendarX } from 'lucide-react';
import { cancelBooking } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';
import { describeCancellation } from '@/lib/domain/policy';

interface Props {
  bookingId: string;
  /** Plain strings only — no Date objects cross the server/client boundary. */
  className: string;
  whenLabel: string;
  sessionStartsAtIso: string;
  cancellationWindowHours: number;
}

export function CancelBookingDialog({
  bookingId,
  className,
  whenLabel,
  sessionStartsAtIso,
  cancellationWindowHours,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ refunded: boolean } | null>(null);
  const router = useRouter();

  /**
   * Evaluated when the dialog OPENS, not at render time, so a page that has
   * been sitting open does not show a stale prediction.
   */
  const [prediction, setPrediction] = useState(() =>
    describeCancellation(
      sessionStartsAtIso,
      new Date().toISOString(),
      cancellationWindowHours,
    ),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      setPrediction(
        describeCancellation(
          sessionStartsAtIso,
          new Date().toISOString(),
          cancellationWindowHours,
        ),
      );
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, sessionStartsAtIso, cancellationWindowHours]);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelBooking(bookingId);

      if (result.ok) {
        // The DATABASE decided this, not the prediction above.
        setOutcome({ refunded: result.data.refunded });
        setIsOpen(false);
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  // Result is shown after the dialog closes, reporting what actually happened.
  if (outcome) {
    return (
      <ActionMessage
        tone={outcome.refunded ? 'success' : 'info'}
        message={
          outcome.refunded
            ? 'Booking cancelled. 1 credit has been returned to your account.'
            : 'Booking cancelled. As this was a late cancellation, the credit was not returned.'
        }
      />
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setIsOpen(true)}
      >
        <CalendarX className="h-4 w-4" aria-hidden="true" />
        Cancel my booking
      </Button>

      <dialog
        ref={dialogRef}
        // Escape and backdrop dismissal both route through the same state.
        onClose={() => setIsOpen(false)}
        onCancel={(event) => {
          if (isPending) event.preventDefault(); // don't close mid-request
        }}
        aria-labelledby="cancel-dialog-title"
        /*
         * m-auto is LOAD-BEARING, not decoration. A native <dialog> centres
         * itself in the viewport through the UA stylesheet's `margin: auto`,
         * and Tailwind's preflight resets margin to 0 on every element — which
         * silently pins the modal to the top-left corner. Restoring the auto
         * margin is what puts it back in the middle.
         */
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="p-5">
          <h2
            id="cancel-dialog-title"
            className="text-base font-semibold text-slate-900"
          >
            Cancel this booking?
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            {className} · {whenLabel}
          </p>

          {/* THE CONSEQUENCE, STATED BEFORE CONFIRMATION. */}
          <div
            className={[
              'mt-4 flex items-start gap-2.5 rounded-lg px-3 py-3 text-sm ring-1 ring-inset',
              prediction.refundEligible
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-amber-50 text-amber-900 ring-amber-200',
            ].join(' ')}
          >
            {!prediction.refundEligible ? (
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <span>
              <strong className="font-semibold">{prediction.headline}</strong>
              <br />
              <span className="text-[13px]">{prediction.detail}</span>
            </span>
          </div>

          {error ? <ActionMessage tone="error" message={error} /> : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Keep my booking
            </Button>
            <Button
              type="button"
              /* Destructive styling ONLY when a credit is actually lost. */
              variant={prediction.refundEligible ? 'primary' : 'destructive'}
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Cancelling…
                </>
              ) : prediction.refundEligible ? (
                'Cancel and get my credit back'
              ) : (
                'Cancel without a refund'
              )}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
