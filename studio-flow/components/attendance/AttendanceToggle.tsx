'use client';

/**
 * components/attendance/AttendanceToggle.tsx
 *
 * CLIENT COMPONENT — and the one place in this codebase that uses
 * useOptimistic.
 *
 * ==========================================================================
 * WHY OPTIMISTIC HERE, BUT NOT ON BookButton
 * ==========================================================================
 * Design §6.3: optimistic display is appropriate when failure is EXCEPTIONAL,
 * and inappropriate when failure is an EXPECTED OUTCOME of the domain.
 *
 *   BookButton      -> contended. Two students can want the same last seat, and
 *                      SESSION_FULL is the correct answer for one of them.
 *                      Showing "Booked!" and retracting it is worse than a
 *                      spinner. NOT optimistic.
 *
 *   AttendanceToggle -> uncontended. Nobody competes to mark a student
 *                      present, and the instructor already has permission on
 *                      this roster. Failure means the network dropped.
 *                      OPTIMISTIC.
 *
 * The practical difference matters in the room: an instructor stands in front
 * of fourteen people tapping names. A 300ms round trip per tap makes the
 * roster feel broken.
 *
 * ==========================================================================
 * WHY EACH ROW SAVES INDEPENDENTLY
 * ==========================================================================
 * Design §4.4: batch-saving the whole roster means a dropped connection in a
 * studio basement discards the instructor's entire pass through the room. One
 * mark, one request, one failure at most.
 */

import { useOptimistic, useTransition } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { markAttendance } from '@/actions/attendance.actions';

type Attendance = 'attended' | 'absent' | null;

export function AttendanceToggle({
  bookingId,
  studentName,
  attendance,
  disabled = false,
}: {
  bookingId: string;
  studentName: string;
  attendance: Attendance;
  /**
   * True once BR-11's window has closed (or before it opens). The control still
   * RENDERS, so a closed roster keeps showing what was recorded — it simply
   * cannot be changed. Hiding it instead would make a marked roster look
   * unmarked, and offering it live would produce a button whose only possible
   * outcome is ATTENDANCE_WINDOW_CLOSED.
   */
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  // Optimistic value falls back to the server value automatically when the
  // transition settles, so a failed request self-corrects without any manual
  // rollback code.
  const [optimistic, setOptimistic] = useOptimistic<Attendance, Attendance>(
    attendance,
    (_current, next) => next,
  );

  function mark(next: Exclude<Attendance, null>) {
    if (disabled) return;
    startTransition(async () => {
      setOptimistic(next);
      await markAttendance(bookingId, next);
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
        {studentName}
      </span>

      {isPending ? (
        <Loader2
          className="h-4 w-4 animate-spin text-slate-400"
          aria-hidden="true"
        />
      ) : null}

      <div
        role="group"
        aria-label={`Attendance for ${studentName}`}
        className="flex shrink-0 gap-1"
      >
        <button
          type="button"
          onClick={() => mark('attended')}
          aria-pressed={optimistic === 'attended'}
          disabled={disabled}
          // 44px minimum touch target: this is used standing up, one-handed.
          className={[
            'inline-flex h-11 w-11 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
            optimistic === 'attended'
              // emerald-700, not -600: white on emerald-600 is 3.77:1 and
              // fails AA. -700 is 5.48:1 and looks near-identical at this size.
              ? 'bg-emerald-700 text-white ring-emerald-700'
              : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50',
            disabled ? 'cursor-not-allowed opacity-60 hover:bg-white' : '',
          ].join(' ')}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Present</span>
        </button>

        <button
          type="button"
          onClick={() => mark('absent')}
          aria-pressed={optimistic === 'absent'}
          disabled={disabled}
          className={[
            'inline-flex h-11 w-11 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
            optimistic === 'absent'
              ? 'bg-slate-700 text-white ring-slate-700'
              : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50',
            disabled ? 'cursor-not-allowed opacity-60 hover:bg-white' : '',
          ].join(' ')}
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Absent</span>
        </button>
      </div>
    </div>
  );
}
