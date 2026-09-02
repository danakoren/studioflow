import { describe, it, expect } from 'vitest';
import {
  zonedWallTimeToUtcIso,
  utcIsoToZonedWallTime,
  localDateKey,
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
