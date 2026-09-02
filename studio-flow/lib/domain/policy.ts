/**
 * lib/domain/policy.ts
 *
 * ==========================================================================
 * THESE FUNCTIONS ARE FOR DISPLAY ONLY. THEY DECIDE NOTHING.
 * ==========================================================================
 *
 * The authoritative implementations of BR-1/BR-2 (cancellation window) and
 * BR-3 (promotion cutoff) live in cancel_booking() in Postgres, where they run
 * transactionally under a row lock.
 *
 * These duplicates exist for ONE reason: CancelBookingDialog must tell the
 * student "you will lose this credit" BEFORE they confirm. A user must never
 * discover a forfeited credit after the fact.
 *
 * That duplication is a real drift risk, so it is guarded by a contract test
 * (tests/unit/policy-contract.test.ts) which feeds an identical fixture table
 * to both implementations and asserts identical results. CI catches drift —
 * not a student losing a credit they were told they would keep.
 *
 * `now` is an EXPLICIT PARAMETER, never read from the ambient clock. That is a
 * testability decision (Test Specification §0.4): it makes the boundary case at
 * exactly 12h 00m 00s trivially testable and removes hidden global state.
 */

export interface CancellationOutcome {
  refundEligible: boolean;
  hoursUntilStart: number;
  headline: string;
  detail: string;
}

/**
 * BR-1: cancelling AT OR BEFORE the window returns the credit.
 * The boundary is inclusive — tested at exactly the threshold by DB-25.
 */
export function isRefundEligible(
  sessionStartsAtIso: string,
  nowIso: string,
  cancellationWindowHours: number,
): boolean {
  const hours =
    (new Date(sessionStartsAtIso).getTime() - new Date(nowIso).getTime()) /
    3_600_000;
  return hours >= cancellationWindowHours;
}

/** The exact wording shown in the confirmation dialog. */
export function describeCancellation(
  sessionStartsAtIso: string,
  nowIso: string,
  cancellationWindowHours: number,
): CancellationOutcome {
  const hoursUntilStart =
    (new Date(sessionStartsAtIso).getTime() - new Date(nowIso).getTime()) /
    3_600_000;
  const refundEligible = hoursUntilStart >= cancellationWindowHours;

  return refundEligible
    ? {
        refundEligible: true,
        hoursUntilStart,
        headline: 'Cancelling now returns 1 credit to your account.',
        detail: `You are cancelling more than ${cancellationWindowHours} hours before the class starts, so your credit comes back.`,
      }
    : {
        refundEligible: false,
        hoursUntilStart,
        headline:
          'This is a late cancellation. Your credit will not be returned.',
        detail: `The studio asks for ${cancellationWindowHours} hours' notice. Your place will still be offered to anyone on the waitlist.`,
      };
}

/** BR-3: inside the cutoff no automatic promotion occurs. */
export function isInsidePromotionCutoff(
  sessionStartsAtIso: string,
  nowIso: string,
  promotionCutoffHours: number,
): boolean {
  const hours =
    (new Date(sessionStartsAtIso).getTime() - new Date(nowIso).getTime()) /
    3_600_000;
  return hours < promotionCutoffHours;
}

/** BR-8: booking closes at the start instant. */
export function hasStarted(
  sessionStartsAtIso: string,
  nowIso: string,
): boolean {
  return new Date(sessionStartsAtIso).getTime() <= new Date(nowIso).getTime();
}

/**
 * BR-11: when may attendance be marked?
 *
 * The window OPENS AT THE START INSTANT — not when the class ends — and closes
 * `attendanceWindowHours` after it ends. That asymmetry is easy to get wrong in
 * the UI and expensive when you do: an instructor shown enabled controls before
 * the class begins taps them and receives ATTENDANCE_WINDOW_CLOSED, which reads
 * as a broken product rather than a rule.
 *
 * Mirrors the check inside mark_attendance(), which remains authoritative — it
 * re-evaluates under the same transaction that performs the write.
 */
export function isAttendanceWindowOpen(
  sessionStartsAtIso: string,
  sessionEndsAtIso: string,
  nowIso: string,
  attendanceWindowHours: number,
): boolean {
  const now = new Date(nowIso).getTime();
  const opens = new Date(sessionStartsAtIso).getTime();
  const closes =
    new Date(sessionEndsAtIso).getTime() + attendanceWindowHours * 3_600_000;
  return now >= opens && now <= closes;
}

/** Availability presentation: green / amber / grey (Design §8.2). */
export type AvailabilityTone = 'open' | 'low' | 'full';

export function availabilityTone(
  seatsAvailable: number,
  lowThreshold = 3,
): AvailabilityTone {
  if (seatsAvailable <= 0) return 'full';
  if (seatsAvailable < lowThreshold) return 'low';
  return 'open';
}

/** Expiry warning appears only within 30 days (Design §8.2). */
export function shouldWarnAboutExpiry(
  expiresAtIso: string | null,
  nowIso: string,
  withinDays = 30,
): boolean {
  if (!expiresAtIso) return false;
  const days =
    (new Date(expiresAtIso).getTime() - new Date(nowIso).getTime()) / 86_400_000;
  return days >= 0 && days <= withinDays;
}

/**
 * Plain-language description of a ledger row (Design §8.2).
 *
 * "Booked Vinyasa Flow, Tue 07:00 — 1 credit" rather than "booking -1".
 * The ledger is the artefact a student reads when they think they have been
 * charged wrongly, so it has to read like a sentence, not a database row.
 */
export function describeLedgerEntry(
  entryType: string,
  delta: number,
  context: { className?: string | null; when?: string | null; note?: string | null },
): string {
  const where = context.className
    ? `${context.className}${context.when ? `, ${context.when}` : ''}`
    : null;

  switch (entryType) {
    case 'grant':
      return `Package added — ${delta} credit${delta === 1 ? '' : 's'}`;
    case 'booking':
      return where ? `Booked ${where}` : 'Class booked';
    case 'refund':
      return where ? `Cancelled ${where} — credit returned` : 'Credit returned';
    case 'expiry':
      return `Package expired — ${Math.abs(delta)} credit${
        Math.abs(delta) === 1 ? '' : 's'
      } lost`;
    case 'adjustment':
      return context.note
        ? `Adjustment — ${context.note}`
        : 'Adjustment by the studio';
    default:
      return 'Credit movement';
  }
}
