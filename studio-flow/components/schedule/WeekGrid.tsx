/**
 * components/schedule/WeekGrid.tsx
 *
 * SERVER COMPONENT. The desktop week view: seven day columns, classes stacked
 * chronologically inside each.
 *
 * ==========================================================================
 * WHY THIS IS NOT A TIME-AXIS GRID
 * ==========================================================================
 * The obvious "calendar app" layout puts hours down the left and positions each
 * class absolutely by start time and duration. It was rejected on the data:
 * this studio runs ONE TO THREE classes a day across 07:00–19:00. A 13-hour
 * axis at a readable 60px/hour is ~780px of column for one or two blocks —
 * roughly 90% empty space, with each class reduced to a thin sliver too small
 * to carry its instructor or seat count.
 *
 * Stacking instead means every block is large enough to be useful, an empty day
 * reads as a calm gap rather than a broken render, and the grid fills a wide
 * screen with content instead of ruled lines. It is what studio products
 * actually ship for this density.
 *
 * The trade-off, stated plainly: relative time is no longer spatial. A 07:00
 * and an 18:00 class look equally tall. The time is therefore the FIRST and
 * boldest thing in every block, and blocks are strictly time-ordered within a
 * day.
 *
 * ==========================================================================
 * DESKTOP ONLY, BY CONSTRUCTION
 * ==========================================================================
 * This renders inside `hidden lg:block`. Seven columns on a phone gives ~50px
 * per day, which is narrower than the word "Reformer". The caller keeps the
 * existing day-grouped list for small screens — two layouts, each correct for
 * its width, rather than one compromised for both.
 */

import { ClassBlock, type ClassBlockData } from './ClassBlock';
import { localDateKey, formatInZone } from '@/lib/time/tz';
import { toneFor, type ClassTone } from '@/lib/design/class-tone';

export interface WeekGridSession extends ClassBlockData {
  classTypeId: string;
}

export function WeekGrid({
  sessions,
  tones,
  timeZone,
  weekStartIso,
  nowIso,
  hrefFor,
  variant = 'public',
}: {
  sessions: WeekGridSession[];
  tones: Map<string, ClassTone>;
  timeZone: string;
  /** Sunday 00:00 UTC of the week being shown (Israeli week, Sunday-first). */
  weekStartIso: string;
  nowIso: string;
  hrefFor: (sessionId: string) => string;
  variant?: 'public' | 'admin';
}) {
  const todayKey = localDateKey(nowIso, timeZone);
  const now = new Date(nowIso).getTime();

  /*
   * Build all seven days up front rather than grouping only the days that have
   * classes. A calendar with Tuesday missing because nothing was scheduled is
   * not a calendar — the empty column IS information.
   *
   * Days are stepped in 24h increments from the week's start. That is safe here
   * because weekStart is a UTC instant and the KEY is derived by formatting each
   * instant in the studio's zone, so a DST shift moves the boundary without
   * duplicating or skipping a column.
   */
  const days = Array.from({ length: 7 }, (_, index) => {
    const instant = new Date(
      new Date(weekStartIso).getTime() + index * 86_400_000,
    );
    const iso = instant.toISOString();
    const key = localDateKey(iso, timeZone);

    return {
      key,
      iso,
      weekday: formatInZone(iso, timeZone, { weekday: 'short' }),
      dayNumber: formatInZone(iso, timeZone, { day: 'numeric' }),
      month: formatInZone(iso, timeZone, { month: 'short' }),
      isToday: key === todayKey,
      sessions: sessions
        .filter((session) => localDateKey(session.startsAt, timeZone) === key)
        .sort(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        ),
    };
  });

  return (
    <div className="hidden lg:block">
      {/*
        overflow-CLIP, not overflow-hidden.

        Both clip the column corners to the rounded shape, but `hidden` makes
        this element a SCROLL CONTAINER — and a scroll container becomes the
        containing block for any `position: sticky` inside it. The day headers
        below use a sticky offset to clear the app's sticky bar as the PAGE scrolls;
        with `hidden` that offset was measured from this box instead, shunting
        every header down over its own first class block.

        `clip` does not create a scroll container, so sticky keeps resolving
        against the viewport, which is what the offset was written for.
      */}
      <div className="overflow-clip rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="grid grid-cols-7">
          {days.map((day, index) => (
            <div
              key={day.key}
              className={[
                'flex min-h-[26rem] flex-col',
                // Dividers between columns only, so the grid reads as one
                // surface rather than seven boxed cards.
                index > 0 ? 'border-l border-slate-200/80' : '',
                // Today's column is tinted for its whole height, which is far
                // easier to find than a marker on the header alone.
                day.isToday ? 'bg-brand-50/40' : '',
              ].join(' ')}
            >
              <div
                className={[
                  'sticky top-[var(--app-header-height)] z-10 border-b px-2.5 py-2 backdrop-blur',
                  // Matches the app header's translucency so the two stacked
                  // sticky bars read as one piece of chrome.
                  day.isToday
                    ? 'border-brand-200 bg-brand-50/80'
                    : 'border-slate-200/80 bg-white/85',
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={[
                      'text-[11px] font-medium uppercase tracking-wide',
                      day.isToday ? 'text-brand-700' : 'text-slate-500',
                    ].join(' ')}
                  >
                    {day.weekday}
                  </span>
                  <span
                    className={[
                      'text-sm font-semibold tabular-nums',
                      day.isToday ? 'text-brand-700' : 'text-slate-900',
                    ].join(' ')}
                  >
                    {day.dayNumber}
                    <span className="ml-1 text-[11px] font-normal text-slate-400">
                      {day.month}
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {day.sessions.length === 0 ? (
                  // An em dash rather than "No classes": seven columns each
                  // saying "No classes" is noise, and the emptiness is already
                  // legible. It stays in the DOM so the column keeps its
                  // structure and screen readers hear something meaningful.
                  <p className="mt-6 text-center text-xs text-slate-300">
                    <span className="sr-only">No classes on {day.weekday}</span>
                    <span aria-hidden="true">—</span>
                  </p>
                ) : (
                  day.sessions.map((session) => (
                    <ClassBlock
                      key={session.id}
                      session={session}
                      tone={toneFor(tones, session.classTypeId)}
                      timeZone={timeZone}
                      href={hrefFor(session.id)}
                      variant={variant}
                      isPast={new Date(session.startsAt).getTime() < now}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        The legend is what turns decoration into a code. Without it the colours
        are just pretty; with it a returning student learns "green is Vinyasa"
        in one glance and reads the grid faster every week after.

        Only class types PRESENT this week are listed — a legend naming classes
        that are not on screen is a puzzle, not a key.
      */}
      <ClassTypeLegend sessions={sessions} tones={tones} />
    </div>
  );
}

function ClassTypeLegend({
  sessions,
  tones,
}: {
  sessions: WeekGridSession[];
  tones: Map<string, ClassTone>;
}) {
  const seen = new Map<string, string>();
  for (const session of sessions) {
    if (session.status === 'cancelled') continue;
    if (!seen.has(session.classTypeId)) {
      seen.set(session.classTypeId, session.className);
    }
  }
  if (seen.size === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
      {[...seen.entries()].map(([classTypeId, name]) => {
        const tone = toneFor(tones, classTypeId);
        return (
          <li
            key={classTypeId}
            className="flex items-center gap-1.5 text-xs text-slate-600"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${tone.accent}`}
            />
            {name}
          </li>
        );
      })}
    </ul>
  );
}
