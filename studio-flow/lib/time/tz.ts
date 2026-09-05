/**
 * lib/time/tz.ts
 *
 * All timestamps are stored UTC (BR-14) and DISPLAYED in the studio's
 * timezone. This module is the only place that conversion happens.
 *
 * NO DATE LIBRARY IS USED HERE, and that is deliberate: the work splits
 * cleanly in two and neither half needs one.
 *
 *   - DISPLAY in a named zone -> Intl.DateTimeFormat does this natively and
 *     correctly, including DST, with zero dependencies.
 *   - DST-SENSITIVE ARITHMETIC (advancing a 07:00 class by a week across a
 *     clock change) -> already lives in Postgres, inside
 *     create_recurring_sessions, where it has to be anyway.
 *
 * What remains in TypeScript is subtraction between two absolute instants,
 * which is timezone-independent by definition. If richer parsing is ever
 * needed, a library drops in behind this module without touching a single
 * component.
 */

/** Format an ISO instant in a named timezone. */
export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(
    new Date(iso),
  );
}

/** "07:00" */
export function formatTime(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "Tue 3 Sep" */
export function formatShortDate(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Tuesday, 3 September 2026" */
export function formatDayHeading(iso: string, timeZone: string): string {
  return formatInZone(iso, timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "Tue 3 Sep, 07:00" */
export function formatDateTime(iso: string, timeZone: string): string {
  return `${formatShortDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/**
 * "2026-09-03" IN THE STUDIO'S TIMEZONE.
 *
 * Used to group the schedule by day. Grouping on the UTC date would place a
 * 01:00 local class on the previous day anywhere east of Greenwich — exactly
 * the bug test DB-42 exists to catch.
 */
export function localDateKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The zone's UTC offset, in ms, AT A GIVEN INSTANT.
 *
 * Formats the instant in the target zone, reads the wall-clock fields back, and
 * treats them as if they were UTC. The difference between that and the real
 * instant IS the offset. This is the standard dependency-free technique and it
 * is DST-correct by construction, because Intl applies whichever rules were in
 * force at that instant rather than a fixed offset.
 *
 * hourCycle 'h23' rather than hour12:false: the latter renders midnight as "24"
 * in some environments, which silently shifts the result by a day.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * "2026-08-25T07:00" typed by an admin  ->  the UTC instant it denotes IN THE
 * STUDIO'S TIMEZONE.
 *
 * ==========================================================================
 * WHY THE BROWSER'S TIMEZONE IS THE WRONG ANSWER
 * ==========================================================================
 * A <input type="datetime-local"> yields a wall-clock string with no zone. The
 * obvious `new Date(value)` interprets it in the BROWSER'S zone, so an owner
 * scheduling their Jerusalem studio's 07:00 class from a laptop still set to
 * London would create a 09:00 class. BR-14 says timestamps are stored UTC and
 * displayed in the studio's zone; input has to be read in the studio's zone for
 * that to round-trip.
 *
 * The offset is measured TWICE. The first guess uses the offset at the naive
 * instant, which is wrong by an hour when the guess lands on the far side of a
 * DST transition from the true answer; re-measuring at the corrected instant
 * and re-correcting resolves it. This is why the naive single-pass version of
 * this function is subtly broken twice a year.
 */
export function zonedWallTimeToUtcIso(
  wallTime: string,
  timeZone: string,
): string | null {
  // Accepts "YYYY-MM-DDTHH:mm" and "YYYY-MM-DDTHH:mm:ss".
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(wallTime)) return null;

  const naive = new Date(`${wallTime}${wallTime.length === 16 ? ':00' : ''}Z`);
  if (Number.isNaN(naive.getTime())) return null;

  const firstGuess = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const corrected = new Date(
    naive.getTime() - zoneOffsetMs(firstGuess, timeZone),
  );

  return corrected.toISOString();
}

/**
 * The inverse: a UTC instant -> "YYYY-MM-DDTHH:mm" in the studio's zone, for
 * pre-filling a datetime-local input on an edit form.
 */
export function utcIsoToZonedWallTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Whole hours from `nowIso` until `iso`. Negative once the instant has passed. */
export function hoursUntil(iso: string, nowIso: string): number {
  return (new Date(iso).getTime() - new Date(nowIso).getTime()) / 3_600_000;
}

/**
 * Sunday 00:00 of the week containing `base`, offset by N weeks, as UTC ISO.
 *
 * The week starts on SUNDAY because the studio is Israeli, where Sunday is the
 * first working day and the weekend falls on Friday–Saturday. A Monday-first
 * calendar would put the two weekend days at opposite ends of the row and split
 * the working week across two grids.
 *
 * getUTCDay() is already Sunday-indexed (Sunday = 0), so the offset is the day
 * number itself. The previous Monday-first version needed `(getUTCDay() + 6) % 7`
 * to rotate that indexing; changing the week start therefore means DELETING the
 * rotation, not adjusting it.
 */
export function weekStart(base: Date, weekOffset: number): string {
  const date = new Date(base);
  const daysSinceSunday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - daysSinceSunday + weekOffset * 7);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
