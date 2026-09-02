'use client';

/**
 * components/attendance/MarkAllPresentButton.tsx
 *
 * CLIENT COMPONENT. Wires up markAllPresent(), which existed in
 * actions/attendance.actions.ts with no caller until this page.
 *
 * ==========================================================================
 * WHY THIS IS SAFE DESPITE MARKING MANY ROWS AT ONCE
 * ==========================================================================
 * It is a CONVENIENCE, not a privileged bypass. The action loops over the
 * unmarked bookings and calls mark_attendance() per row, so the per-session
 * authorisation (teaches_session) and the BR-11 window check are evaluated
 * exactly as they would be for individual taps. It cannot mark anything a
 * sequence of manual taps could not.
 *
 * ==========================================================================
 * WHY IT IS NOT OPTIMISTIC
 * ==========================================================================
 * AttendanceToggle is optimistic because one tap changes one row the instructor
 * is looking at. This changes an unknown number of rows at once, and the useful
 * feedback is the COUNT that actually landed — "12 marked present" — which is
 * only knowable from the response. Guessing it and correcting would be worse
 * than a brief spinner. router.refresh() then repaints the roster from the
 * server so every toggle reflects the real stored state.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCheck } from 'lucide-react';
import { markAllPresent } from '@/actions/attendance.actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function MarkAllPresentButton({
  sessionId,
  unmarkedCount,
}: {
  sessionId: string;
  /** Drives the label, so the instructor knows the size of what they are about
   *  to do before they do it. */
  unmarkedCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState<number | null>(null);
  const router = useRouter();

  if (marked !== null) {
    return (
      <ActionMessage
        tone="success"
        message={
          marked === 1
            ? '1 student marked present.'
            : `${marked} students marked present.`
        }
      />
    );
  }

  /*
   * NOTHING LEFT TO MARK — SAY SO, DO NOT DISAPPEAR.
   *
   * This branch used to `return null`, which was a mistake. An instructor who
   * finishes a register with the individual toggles watched the bulk control
   * silently vanish, and a control that is present one moment and gone the next
   * reads as a bug rather than as "you're done" — it was reported as exactly
   * that. A "mark remaining 0 present" button is nonsense, so the answer is not
   * to render it regardless; it is to replace the silence with a completion
   * state, so the header always accounts for itself.
   */
  if (unmarkedCount === 0) {
    return (
      <Badge tone="success">
        <CheckCheck className="h-3 w-3" aria-hidden="true" />
        Everyone marked
      </Badge>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markAllPresent(sessionId);
            if (result.ok) {
              setMarked(result.data.marked);
              router.refresh();
              return;
            }
            setError(result.message);
          });
        }}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Marking…
          </>
        ) : (
          <>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Mark remaining {unmarkedCount} present
          </>
        )}
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
