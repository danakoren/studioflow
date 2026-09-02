import { describe, it, expect } from 'vitest';
import { bookSessionSchema, markAttendanceSchema } from '@/lib/validation/booking.schema';
import { grantCreditsSchema, adjustCreditsSchema } from '@/lib/validation/credit.schema';
import { createRecurringSessionsSchema } from '@/lib/validation/session.schema';
import { createStudentSchema, createInstructorSchema } from '@/lib/validation/member.schema';
import { updateStudioSettingsSchema } from '@/lib/validation/studio.schema';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('IV-01..IV-03 identifier validation', () => {
  it('rejects a non-uuid sessionId', () => {
    expect(bookSessionSchema.safeParse({ sessionId: 'not-a-uuid' }).success).toBe(false);
  });
  it('rejects a missing sessionId', () => {
    expect(bookSessionSchema.safeParse({}).success).toBe(false);
  });
  it('accepts a valid uuid', () => {
    expect(bookSessionSchema.safeParse({ sessionId: UUID }).success).toBe(true);
  });
});

describe('MASS ASSIGNMENT — .strict() rejects unknown keys', () => {
  it('rejects an injected studentId on bookSession', () => {
    const r = bookSessionSchema.safeParse({ sessionId: UUID, studentId: UUID });
    expect(r.success).toBe(false);
  });
  it('rejects an injected role on createInstructor', () => {
    const r = createInstructorSchema.safeParse({
      fullName: 'Yael Bar', email: 'y@test.com', role: 'admin',
    });
    expect(r.success).toBe(false);
  });
  it('rejects an injected credits_remaining on grantCredits', () => {
    const r = grantCreditsSchema.safeParse({
      studentId: UUID, credits: 10, credits_remaining: 999,
    });
    expect(r.success).toBe(false);
  });
});

describe('IV-11..IV-20 range validation', () => {
  it('rejects zero credits', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 0 }).success).toBe(false);
  });
  it('rejects negative credits on a GRANT (must use adjustCredits with a reason)', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: -10 }).success).toBe(false);
  });
  it('rejects fractional credits', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 2.5 }).success).toBe(false);
  });
  it('rejects credits above 500', () => {
    expect(grantCreditsSchema.safeParse({ studentId: UUID, credits: 999999 }).success).toBe(false);
  });
});

describe('IV-17/IV-18 recurrence bounds mirror the DB guard', () => {
  const base = {
    classTypeId: UUID, roomId: UUID, instructorId: UUID,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  it('rejects 0 weeks', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 0 }).success).toBe(false);
  });
  it('rejects 52 weeks (cap is 12)', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 52 }).success).toBe(false);
  });
  it('accepts 12 weeks', () => {
    expect(createRecurringSessionsSchema.safeParse({ ...base, weeks: 12 }).success).toBe(true);
  });
});

describe('IV-21 temporal validation', () => {
  it('rejects a session starting in the past', () => {
    const r = createRecurringSessionsSchema.safeParse({
      classTypeId: UUID, roomId: UUID, instructorId: UUID,
      startsAt: new Date(Date.now() - 86_400_000).toISOString(), weeks: 4,
    });
    expect(r.success).toBe(false);
  });
});

describe('adjustCredits REQUIRES a reason', () => {
  it('rejects an empty reason', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: -5, reason: '' }).success).toBe(false);
  });
  it('rejects a zero delta', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: 0, reason: 'typo fix' }).success).toBe(false);
  });
  it('accepts a negative delta WITH a reason', () => {
    expect(adjustCreditsSchema.safeParse({ studentId: UUID, delta: -5, reason: 'Refund agreed by phone' }).success).toBe(true);
  });
});

describe('IV-09 password policy', () => {
  it('rejects a short password', () => {
    const r = createStudentSchema.safeParse({ fullName: 'Noa', email: 'n@test.com', password: '12345' });
    expect(r.success).toBe(false);
  });
  it('accepts a 10+ character password', () => {
    const r = createStudentSchema.safeParse({ fullName: 'Noa', email: 'n@test.com', password: 'correct-horse-battery' });
    expect(r.success).toBe(true);
  });
});

describe('IV-10 unicode / RTL names are accepted', () => {
  it('accepts a Hebrew name', () => {
    const r = createStudentSchema.safeParse({ fullName: 'נועה שפירא', email: 'n@test.com', password: 'correct-horse-battery' });
    expect(r.success).toBe(true);
  });
});

describe('IV-06/IV-07 hostile input is ACCEPTED as inert text, not rejected', () => {
  it('stores a script tag as a literal name', () => {
    const r = createStudentSchema.safeParse({
      fullName: '<script>alert(1)</script>', email: 'x@test.com', password: 'correct-horse-battery',
    });
    // React escapes on render and queries are parameterised, so this is safe
    // to store. Rejecting it would break legitimate names containing < or >.
    expect(r.success).toBe(true);
  });
});

describe('studio settings cross-field rule', () => {
  const base = {
    name: 'Flow Studio', timezone: 'Asia/Jerusalem',
    attendanceWindowHours: 24, unmarkedAttendanceDefault: 'attended' as const,
  };
  it('rejects a promotion cutoff larger than the cancellation window', () => {
    const r = updateStudioSettingsSchema.safeParse({
      ...base, cancellationWindowHours: 2, promotionCutoffHours: 12,
    });
    expect(r.success).toBe(false);
  });
  it('accepts a sensible configuration', () => {
    const r = updateStudioSettingsSchema.safeParse({
      ...base, cancellationWindowHours: 12, promotionCutoffHours: 2,
    });
    expect(r.success).toBe(true);
  });
});

describe('markAttendance enum', () => {
  it('rejects an arbitrary status', () => {
    expect(markAttendanceSchema.safeParse({ bookingId: UUID, status: 'maybe' }).success).toBe(false);
  });
  it('accepts absent', () => {
    expect(markAttendanceSchema.safeParse({ bookingId: UUID, status: 'absent' }).success).toBe(true);
  });
});
