import { describe, it, expect } from 'vitest';
import {
  zonedWallTimeToUtcIso,
  utcIsoToZonedWallTime,
  localDateKey,
  weekStart,
} from '@/lib/time/tz';

/**
 * tests/unit/tz.test.ts
 *
 * BR-14: timestamps are stored UTC and displayed in the studio's timezone. The
 * admin session form is the one place where the conversion runs the OTHER way —
 * wall-clock input to a UTC instant — and it is the easiest place in the product
 * to be silently an hour wrong.
 *
 * Asia/Jerusalem is used throughout because it observes DST (IDT, UTC+3, in
 * summer; IST, UTC+2, in winter), so the same wall time maps to different
 * instants depending on the date. A function that hard-codes one offset passes a
 * summer test and fails in November.
 */

const JERUSALEM = 'Asia/Jerusalem';

describe('zonedWallTimeToUtcIso — reads input in the STUDIO\'S zone', () => {
  it('interprets a summer time as UTC+3 (IDT), not as UTC', () => {
    // 07:00 IDT === 04:00Z
    expect(zonedWallTimeToUtcIso('2026-08-25T07:00', JERUSALEM)).toBe(
      '2026-08-25T04:00:00.000Z',
    );
  });

  it('interprets a winter time as UTC+2 (IST) — the same wall time, a different instant', () => {
    // 07:00 IST === 05:00Z. A hard-coded offset cannot satisfy this and the
    // test above at once.
    expect(zonedWallTimeToUtcIso('2026-12-25T07:00', JERUSALEM)).toBe(
      '2026-12-25T05:00:00.000Z',
    );
  });

  it('handles a UTC studio as a no-op', () => {
    expect(zonedWallTimeToUtcIso('2026-08-25T07:00', 'UTC')).toBe(
      '2026-08-25T04:00:00.000Z'.replace('04', '07'),
    );
  });

  it('handles a negative offset zone', () => {
    // 07:00 EDT === 11:00Z
    expect(zonedWallTimeToUtcIso('2026-08-25T07:00', 'America/New_York')).toBe(
      '2026-08-25T11:00:00.000Z',
    );
  });

  it('accepts seconds as well as minutes', () => {
    expect(zonedWallTimeToUtcIso('2026-08-25T07:00:00', JERUSALEM)).toBe(
      '2026-08-25T04:00:00.000Z',
    );
  });

  it('rejects malformed input rather than guessing', () => {
    expect(zonedWallTimeToUtcIso('', JERUSALEM)).toBeNull();
    expect(zonedWallTimeToUtcIso('2026-08-25', JERUSALEM)).toBeNull();
    expect(zonedWallTimeToUtcIso('25/08/2026 07:00', JERUSALEM)).toBeNull();
    expect(zonedWallTimeToUtcIso('not a date', JERUSALEM)).toBeNull();
  });

  it('produces a string the offset-aware Zod schema accepts', () => {
    const iso = zonedWallTimeToUtcIso('2026-08-25T07:00', JERUSALEM);
    // .datetime({ offset: true }) requires a Z or ±HH:MM suffix.
    expect(iso).toMatch(/Z$/);
  });
});

describe('utcIsoToZonedWallTime — round-trips for the edit form', () => {
  it('is the inverse of zonedWallTimeToUtcIso in summer', () => {
    const wall = '2026-08-25T07:00';
    const iso = zonedWallTimeToUtcIso(wall, JERUSALEM)!;
    expect(utcIsoToZonedWallTime(iso, JERUSALEM)).toBe(wall);
  });

  it('is the inverse in winter too', () => {
    const wall = '2026-12-25T07:00';
    const iso = zonedWallTimeToUtcIso(wall, JERUSALEM)!;
    expect(utcIsoToZonedWallTime(iso, JERUSALEM)).toBe(wall);
  });

  it('renders midnight as 00, never 24', () => {
    const iso = zonedWallTimeToUtcIso('2026-08-25T00:00', JERUSALEM)!;
    expect(utcIsoToZonedWallTime(iso, JERUSALEM)).toBe('2026-08-25T00:00');
  });
});

describe('localDateKey — grouping must use the studio day, not the UTC day', () => {
  it('DB-42: a 01:00 local class does not fall on the previous day', () => {
    // 2026-08-25T01:00 IDT is 2026-08-24T22:00Z. Grouping on UTC would file it
    // under the 24th.
    const iso = '2026-08-24T22:00:00.000Z';
    expect(localDateKey(iso, JERUSALEM)).toBe('2026-08-25');
  });
});

/**
 * weekStart — the schedule grid's left-hand edge.
 *
 * The week begins on SUNDAY: the studio is Israeli, where the working week runs
 * Sunday to Thursday and the weekend is Friday–Saturday.
 *
 * Worth pinning down, because the failure is quiet. An off-by-one here does not
 * throw; it renders a calendar that is plausibly wrong, shifted a day, and the
 * mistake is only visible to someone who checks a date against a real calendar.
 * The dates below are stated with their real weekday so the expectations can be
 * verified by reading rather than by re-running the arithmetic.
 */
describe('weekStart — weeks begin on Sunday', () => {
  it('returns the same day when base is already a Sunday', () => {
    // 2026-09-06 is a Sunday.
    expect(weekStart(new Date('2026-09-06T15:30:00.000Z'), 0)).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });

  it('walks BACK to Sunday from midweek', () => {
    // 2026-09-09 is a Wednesday; its week began Sunday the 6th.
    expect(weekStart(new Date('2026-09-09T08:00:00.000Z'), 0)).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });

  it('keeps Saturday in the week that began the PREVIOUS Sunday', () => {
    // 2026-09-12 is a Saturday — the last day of the week starting the 6th,
    // not the first day of the next one. This is the assertion that fails if
    // the Monday-first rotation is ever reintroduced.
    expect(weekStart(new Date('2026-09-12T23:59:00.000Z'), 0)).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });

  it('treats Monday as mid-week, not as a boundary', () => {
    // 2026-09-07 is a Monday. Under a Monday-first week this would return the
    // 7th; under a Sunday-first week it belongs to the week starting the 6th.
    expect(weekStart(new Date('2026-09-07T00:00:00.000Z'), 0)).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });

  it('offsets whole weeks in both directions', () => {
    const base = new Date('2026-09-09T08:00:00.000Z'); // Wednesday
    expect(weekStart(base, 1)).toBe('2026-09-13T00:00:00.000Z');
    expect(weekStart(base, -1)).toBe('2026-08-30T00:00:00.000Z');
  });

  it('normalises the time of day to midnight', () => {
    expect(weekStart(new Date('2026-09-09T23:59:59.999Z'), 0)).toBe(
      '2026-09-06T00:00:00.000Z',
    );
  });
});
