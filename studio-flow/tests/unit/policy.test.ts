import { describe, it, expect } from 'vitest';
import {
  isRefundEligible,
  describeCancellation,
  isInsidePromotionCutoff,
  hasStarted,
  isAttendanceWindowOpen,
  availabilityTone,
  shouldWarnAboutExpiry,
  describeLedgerEntry,
} from '@/lib/domain/policy';

/**
 * tests/unit/policy.test.ts
 *
 * These test the DISPLAY-ONLY implementations in lib/domain/policy.ts.
 *
 * `now` is an explicit parameter throughout, which is exactly why the boundary
 * cases below are expressible at all. If these functions read Date.now()
 * internally, "cancel at exactly 12h 00m 00s" would be untestable without
 * faking the global clock (Test Specification §0.4).
 *
 * THIS IS NOT THE CONTRACT TEST. Test Specification §5.1 requires a further
 * test that feeds this same fixture table to cancel_booking() in Postgres and
 * asserts identical results, so the display prediction can never drift from
 * the authoritative decision. That one needs a live database and belongs in
 * tests/integration.
 */

const HOUR = 3_600_000;
const NOW = '2026-09-01T10:00:00.000Z';
const at = (hoursFromNow: number) =>
  new Date(Date.parse(NOW) + hoursFromNow * HOUR).toISOString();

describe('BR-1 / BR-2 — cancellation window boundary (DB-25, DB-26, DB-27)', () => {
  it('DB-25: refunds at EXACTLY the 12h threshold — the rule is "at or before"', () => {
    expect(isRefundEligible(at(12), NOW, 12)).toBe(true);
  });

  it('DB-26: does not refund at 11h 59m', () => {
    expect(isRefundEligible(at(11 + 59 / 60), NOW, 12)).toBe(false);
  });

  it('DB-27: refunds at 12h 01m', () => {
    expect(isRefundEligible(at(12 + 1 / 60), NOW, 12)).toBe(true);
  });

  it('does not refund a cancellation after the class has started', () => {
    expect(isRefundEligible(at(-1), NOW, 12)).toBe(false);
  });

  it('honours a studio-specific window rather than a hard-coded 12', () => {
    expect(isRefundEligible(at(20), NOW, 24)).toBe(false);
    expect(isRefundEligible(at(25), NOW, 24)).toBe(true);
  });
});

describe('UI-05 — the dialog states the consequence BEFORE confirmation', () => {
  it('promises the credit back when outside the window', () => {
    const outcome = describeCancellation(at(48), NOW, 12);
    expect(outcome.refundEligible).toBe(true);
    expect(outcome.headline).toContain('returns 1 credit');
  });

  it('warns plainly that the credit is lost when inside the window', () => {
    const outcome = describeCancellation(at(6), NOW, 12);
    expect(outcome.refundEligible).toBe(false);
    expect(outcome.headline).toContain('will not be returned');
  });

  it('names the studio-configured window in the detail text', () => {
    expect(describeCancellation(at(6), NOW, 24).detail).toContain('24 hours');
  });
});

describe('BR-3 — promotion cutoff (DB-28, DB-29)', () => {
  it('DB-28: suppresses promotion at exactly the 2h cutoff', () => {
    expect(isInsidePromotionCutoff(at(2), NOW, 2)).toBe(false);
    expect(isInsidePromotionCutoff(at(1.99), NOW, 2)).toBe(true);
  });

  it('DB-29: allows promotion at 2h 01m', () => {
    expect(isInsidePromotionCutoff(at(2 + 1 / 60), NOW, 2)).toBe(false);
  });
});

describe('BR-8 — booking closes at the start instant (DB-30, DB-31)', () => {
  it('DB-30: one second before the start is still open', () => {
    expect(hasStarted(at(1 / 3600), NOW)).toBe(false);
  });

  it('DB-31: one second after the start is closed', () => {
    expect(hasStarted(at(-1 / 3600), NOW)).toBe(true);
  });

  it('treats the exact start instant as started', () => {
    expect(hasStarted(NOW, NOW)).toBe(true);
  });
});

describe('UI-02 / UI-19 — availability tone', () => {
  it('is full at zero seats', () => {
    expect(availabilityTone(0)).toBe('full');
  });
  it('is low below three seats', () => {
    expect(availabilityTone(1)).toBe('low');
    expect(availabilityTone(2)).toBe('low');
  });
  it('is open at three or more', () => {
    expect(availabilityTone(3)).toBe('open');
    expect(availabilityTone(14)).toBe('open');
  });
  it('never reports a negative seat count as open', () => {
    expect(availabilityTone(-2)).toBe('full');
  });
});

describe('UI-22 — expiry warning appears only within 30 days', () => {
  const days = (n: number) =>
    new Date(Date.parse(NOW) + n * 24 * HOUR).toISOString();

  it('warns at 29 days', () => {
    expect(shouldWarnAboutExpiry(days(29), NOW)).toBe(true);
  });
  it('stays quiet at 31 days', () => {
    expect(shouldWarnAboutExpiry(days(31), NOW)).toBe(false);
  });
  it('stays quiet for a non-expiring package', () => {
    expect(shouldWarnAboutExpiry(null, NOW)).toBe(false);
  });
  it('stays quiet once the date has passed — expiry is not a warning', () => {
    expect(shouldWarnAboutExpiry(days(-1), NOW)).toBe(false);
  });
});

describe('UI-09 — the ledger reads as sentences, not database rows', () => {
  it('describes a booking with the class and time', () => {
    expect(
      describeLedgerEntry('booking', -1, {
        className: 'Vinyasa Flow',
        when: 'Tue 3 Sep, 07:00',
      }),
    ).toBe('Booked Vinyasa Flow, Tue 3 Sep, 07:00');
  });

  it('makes an expiry explicit about what was lost', () => {
    expect(describeLedgerEntry('expiry', -3, {})).toContain('3 credits lost');
  });

  it('surfaces the required reason on an adjustment', () => {
    expect(
      describeLedgerEntry('adjustment', -2, { note: 'Refund agreed by phone' }),
    ).toContain('Refund agreed by phone');
  });

  it('handles the singular correctly', () => {
    expect(describeLedgerEntry('grant', 1, {})).toContain('1 credit');
    expect(describeLedgerEntry('grant', 10, {})).toContain('10 credits');
  });
});

describe('BR-11 — the attendance window opens at START, not at end', () => {
  // A 60-minute class starting 3h ago, in a studio allowing 24h to mark.
  const startsAt = at(-3);
  const endsAt = at(-2);
  const WINDOW = 24;

  it('is CLOSED before the class begins — the case most easily got wrong', () => {
    // Marking a register for a class that has not happened is rejected by
    // mark_attendance(), so the UI must not offer it.
    expect(isAttendanceWindowOpen(at(1), at(2), NOW, WINDOW)).toBe(false);
  });

  it('opens at EXACTLY the start instant', () => {
    expect(isAttendanceWindowOpen(NOW, at(1), NOW, WINDOW)).toBe(true);
  });

  it('is open while the class is still running', () => {
    expect(isAttendanceWindowOpen(at(-0.5), at(0.5), NOW, WINDOW)).toBe(true);
  });

  it('is open after the class ends, inside the window', () => {
    expect(isAttendanceWindowOpen(startsAt, endsAt, NOW, WINDOW)).toBe(true);
  });

  it('is open at EXACTLY end + window', () => {
    // endsAt is 2h before NOW, so a 2h window closes precisely now.
    expect(isAttendanceWindowOpen(startsAt, endsAt, NOW, 2)).toBe(true);
  });

  it('is closed one minute past end + window', () => {
    expect(
      isAttendanceWindowOpen(startsAt, endsAt, NOW, 2 - 1 / 60),
    ).toBe(false);
  });

  it('respects a studio that allows a longer window', () => {
    const finishedThreeDaysAgo = at(-72);
    expect(
      isAttendanceWindowOpen(finishedThreeDaysAgo, at(-71), NOW, 24),
    ).toBe(false);
    expect(
      isAttendanceWindowOpen(finishedThreeDaysAgo, at(-71), NOW, 96),
    ).toBe(true);
  });
});
