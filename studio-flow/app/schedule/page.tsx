import { SessionCard } from '@/components/schedule/SessionCard';
import { WeekGrid } from '@/components/schedule/WeekGrid';
import { WeekNavigator } from '@/components/schedule/WeekNavigator';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyCalendarArt } from '@/components/ui/illustrations';
import {
  getPrimaryStudio,
  getScheduleRange,
  getClassTypes,
} from '@/lib/data/sessions.queries';
import { assignClassTones } from '@/lib/design/class-tone';
import {
  weekStart,
  addDays,
  localDateKey,
  formatDayHeading,
  formatShortDate,
} from '@/lib/time/tz';
import type { SessionWithAvailability } from '@/lib/types/database.types';

/**
 * app/schedule/page.tsx — SERVER COMPONENT.
 *
 * ==========================================================================
 * THE MOST-VISITED PAGE IN THE PRODUCT, AND THE ONE MOST AT RISK OF N+1
 * ==========================================================================
 * The naive implementation fetches the week's sessions, then loops asking
 * "how many people are booked into this one?" — 1 + 40 round trips on the page
 * every visitor lands on (HQ-1 in the Scaling document).
 *
 * getScheduleRange() reads v_sessions_with_availability instead, which
 * aggregates booked_count, seats_available and waiting_count in ONE pass.
 * Rendering forty sessions costs exactly the same as rendering one.
 * Measurement M2 asserts this: the schedule page must issue exactly 1 query.
 *
 * ==========================================================================
 * NO LOGIN WALL
 * ==========================================================================
 * The schedule is readable without an account, enforced by the RLS policy
 * sessions_select_public_schedule. Making a visitor register before they can
 * see whether the studio runs a 07:00 class suppresses conversion for no
 * benefit (Product Spec Flow 1).
 *
 * ==========================================================================
 * DYNAMIC, NOT CACHED
 * ==========================================================================
 * Availability counts are deliberately not cached (Scaling §4.6). A stale
 * "3 seats left" that is actually 0 sends a student into a booking that fails,
 * which is a worse experience than the ~30ms a cache would have saved.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Class schedule — StudioFlow',
};

export default async function SchedulePage({
  searchParams,
}: {
  // In Next.js 15 searchParams is a Promise and MUST be awaited.
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const weekOffset = clampWeek(params.week);

  const studio = await getPrimaryStudio();

  if (!studio) {
    return (
      <EmptyState
        art={<EmptyCalendarArt className="h-full w-full" />}
        title="No studio is set up yet"
        description="Once a studio has been created its schedule will appear here."
      />
    );
  }

  const fromIso = weekStart(new Date(), weekOffset);
  const toIso = addDays(fromIso, 7);
  const nowIso = new Date().toISOString();

  /*
   * THE FULL WEEK IS FETCHED, INCLUDING DAYS ALREADY PAST.
   *
   * This used to start from `now` on the current week, because a LIST should
   * not open with Tuesday's finished 07:00 when it is Thursday. A GRID has the
   * opposite requirement: Monday to Wednesday still have to be drawn, or the
   * calendar renders three blank columns and looks broken rather than historic.
   *
   * So one query covers Monday–Sunday and each view narrows it: the grid shows
   * everything (dimming what has passed), the small-screen list still drops the
   * past. One round trip, two correct presentations.
   */
  const sessions = await getScheduleRange(studio.id, fromIso, toIso);

  // Colour is assigned from the studio's FULL class-type list, never from the
  // types that happen to appear this week — see getClassTypes().
  const tones = assignClassTones(await getClassTypes(studio.id));

  const upcoming =
    weekOffset === 0
      ? sessions.filter((session) => session.starts_at >= nowIso)
      : sessions;
  const days = groupByLocalDay(upcoming, studio.timezone);

  const rangeLabel =
    weekOffset === 0
      ? 'This week'
      : `${formatShortDate(fromIso, studio.timezone)} – ${formatShortDate(
          addDays(toIso, -1),
          studio.timezone,
        )}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {studio.name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Book a class, or join the waitlist if it&rsquo;s full and we&rsquo;ll
          get you in automatically when a place opens.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5">
        <WeekNavigator weekOffset={weekOffset} rangeLabel={rangeLabel} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* DESKTOP: the week grid                                             */}
      {/* ------------------------------------------------------------------ */}
      {sessions.length > 0 ? (
        <WeekGrid
          sessions={sessions.map((session) => ({
            id: session.id,
            classTypeId: session.class_type_id,
            startsAt: session.starts_at,
            endsAt: session.ends_at,
            className: session.class_type_name,
            instructorName: session.instructor_name,
            roomName: session.room_name,
            status: session.status,
            seatsAvailable: session.seats_available,
            bookedCount: session.booked_count,
            capacity: session.capacity,
            waitingCount: session.waiting_count,
          }))}
          tones={tones}
          timeZone={studio.timezone}
          weekStartIso={fromIso}
          nowIso={nowIso}
          hrefFor={(id) => `/schedule/${id}`}
        />
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* BELOW lg: the day-grouped list. Seven columns on a phone gives ~50px */}
      {/* per day, narrower than the word "Reformer".                         */}
      {/* ------------------------------------------------------------------ */}
      {/*
        The empty state is scoped to the small-screen view whenever the grid has
        something to show. Without the lg:hidden, a week whose classes have all
        already started would render "Nothing left this week" on a desktop that
        is simultaneously displaying a full grid of them.
      */}
      {days.length === 0 ? (
        <div className={sessions.length > 0 ? 'lg:hidden' : ''}>
          <EmptyState
            art={<EmptyCalendarArt className="h-full w-full" />}
            title={
              sessions.length > 0
                ? 'Nothing left this week'
                : 'No classes scheduled this week'
            }
            description={
              sessions.length > 0
                ? 'Every class this week has already started — they are still shown on a larger screen. Try the next week.'
                : 'Try the next week, or check back shortly — the studio may still be publishing its timetable.'
            }
          />
        </div>
      ) : (
        <div className="space-y-6 lg:hidden">
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`day-${day.key}`}>
              <h2
                id={`day-${day.key}`}
                className="sticky top-0 z-10 -mx-4 bg-slate-50/90 px-4 py-2 text-sm font-semibold text-slate-700 backdrop-blur"
              >
                {formatDayHeading(day.firstStartsAt, studio.timezone)}
              </h2>
              <ul className="mt-2 space-y-2">
                {day.sessions.map((session) => (
                  <li key={session.id}>
                    <SessionCard session={session} timeZone={studio.timezone} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bounded so a hand-edited ?week=99999 cannot ask for an absurd range. */
function clampWeek(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(-8, Math.min(26, parsed));
}

interface DayGroup {
  key: string;
  firstStartsAt: string;
  sessions: SessionWithAvailability[];
}

/**
 * Grouped by the STUDIO'S local date, not the UTC date.
 *
 * Grouping on UTC puts a 01:00 local class on the previous day anywhere east
 * of Greenwich — the bug test DB-42 exists to catch. Sessions arrive already
 * ordered by starts_at, so a single pass preserves the order within each day.
 */
function groupByLocalDay(
  sessions: SessionWithAvailability[],
  timeZone: string,
): DayGroup[] {
  const groups = new Map<string, DayGroup>();

  for (const session of sessions) {
    const key = localDateKey(session.starts_at, timeZone);
    const existing = groups.get(key);

    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(key, {
        key,
        firstStartsAt: session.starts_at,
        sessions: [session],
      });
    }
  }

  return [...groups.values()];
}
