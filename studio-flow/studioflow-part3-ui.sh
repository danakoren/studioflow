#!/usr/bin/env bash
# =============================================================================
#  StudioFlow — Part 3 installer: React Components and Application Pages
#
#  USAGE
#    1. cd into your project root (Parts 1 and 2 should already be in place)
#    2. bash studioflow-part3-ui.sh
#
#  SAFETY
#    - Refuses to overwrite an existing file unless you pass --force.
#    - NEVER touches package.json, .env.local, or any Part 2 backend file.
#      It only writes under app/, components/, lib/data, lib/time, lib/domain,
#      plus postcss.config.mjs and next.config.mjs.
#    - Prints the dependencies you need at the end rather than installing them.
# =============================================================================
set -euo pipefail

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ ! -f package.json ]; then
  echo "ERROR: no package.json here. Run this from your project root."
  exit 1
fi

if [ ! -d lib/supabase ] || [ ! -d actions ]; then
  echo "WARNING: lib/supabase/ or actions/ not found."
  echo "         Part 3 imports from Part 2. Install Part 2 first if you"
  echo "         have not already."
  echo
fi

# TypeScript 7 is not yet supported by Next.js 15. If it is installed, module
# resolution for .tsx files fails with a misleading "Module not found:
# Can't resolve '@/components/...'" that looks like a path-alias problem and is
# not. Caught here rather than after twenty minutes of debugging tsconfig.
if [ -f node_modules/typescript/package.json ]; then
  TS_MAJOR=$(node -p "require('./node_modules/typescript/package.json').version.split('.')[0]" 2>/dev/null || echo "")
  if [ "$TS_MAJOR" = "7" ]; then
    echo "WARNING: TypeScript 7 detected."
    echo "         Next.js 15 does not support it yet — .tsx imports will fail"
    echo "         to resolve with a misleading 'Module not found' error."
    echo "         Fix:  npm i -D typescript@^5.9.3"
    echo
  fi
fi

WROTE=0
SKIPPED=0

write() {  # write <path>; body arrives on stdin
  local path="$1"
  if [ -e "$path" ] && [ "$FORCE" -eq 0 ]; then
    cat > /dev/null            # drain the heredoc so the script stays in sync
    echo "  skip   $path (exists — re-run with --force to overwrite)"
    SKIPPED=$((SKIPPED + 1))
    return
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  echo "  write  $path"
  WROTE=$((WROTE + 1))
}

echo "StudioFlow Part 3 — creating UI files"
echo

mkdir -p "app"
mkdir -p "app/my"
mkdir -p "app/my/credits"
mkdir -p "app/schedule"
mkdir -p "app/schedule/[sessionId]"
mkdir -p "components/attendance"
mkdir -p "components/booking"
mkdir -p "components/credits"
mkdir -p "components/schedule"
mkdir -p "components/shared"
mkdir -p "components/ui"
mkdir -p "lib/data"
mkdir -p "lib/domain"
mkdir -p "lib/time"
mkdir -p "tests/unit"

write 'app/error.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * app/error.tsx — route-segment error boundary. MUST be a Client Component.
 *
 * Design §7.3: a friendly message and a retry, with navigation preserved. What
 * is deliberately ABSENT is the error's message, its stack, and any database
 * detail: constraint names and SQL fragments describe the schema to an
 * attacker (Security §4.4). The full detail is already logged server-side by
 * logServerError.
 */

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this screen with the server log entry without
    // exposing anything about the failure to the user.
    console.error('Route error', error.digest);
  }, [error]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        Something went wrong
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        The page couldn&rsquo;t be loaded. Trying again usually fixes it — if it
        keeps happening, let the studio know.
      </p>
      <div className="mt-4">
        <Button type="button" onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
      {error.digest ? (
        <p className="mt-3 text-xs text-slate-400">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
STUDIOFLOW_EOF

write 'app/globals.css' << 'STUDIOFLOW_EOF'
@import "tailwindcss";

/*
 * Tailwind v4: configuration lives in CSS, so there is no tailwind.config.js.
 *
 * A system font stack is used deliberately instead of next/font/google.
 * next/font downloads the font AT BUILD TIME, which makes `next build` fail on
 * a restricted network or an offline machine — a bad failure mode the week
 * before a deadline. System fonts render instantly, add zero bytes, and cause
 * no layout shift.
 */
@theme {
  --font-sans:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  background-color: var(--color-slate-50);
  color: var(--color-slate-900);
}

/* The native <dialog> backdrop is not styleable by Tailwind utilities alone. */
dialog::backdrop {
  background-color: rgb(15 23 42 / 0.45);
}
STUDIOFLOW_EOF

write 'app/layout.tsx' << 'STUDIOFLOW_EOF'
/**
 * app/layout.tsx — the root layout. SERVER COMPONENT.
 *
 * Note what is NOT here: no provider tree, no store, no query client, no theme
 * context. That absence is the architecture working as intended.
 *
 * In a client-state application this file typically wraps everything in four
 * or five providers, each of which forces the entire tree to become client
 * code. Here, server data arrives through Server Components and mutations go
 * through Server Actions, so there is nothing global to provide. The only
 * JavaScript that reaches the browser is the handful of interactive leaves.
 *
 * RoleNav is awaited here rather than inside each page so that navigation is
 * resolved once per request.
 */

import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { RoleNav } from '@/components/shared/RoleNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'StudioFlow — book your classes',
  description:
    'Class schedule, booking and waitlist for small yoga and Pilates studios.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* Keyboard users reach the content without tabbing the whole nav. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:ring-2 focus:ring-indigo-600"
        >
          Skip to content
        </a>

        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link
              href="/schedule"
              className="text-base font-semibold tracking-tight text-slate-900"
            >
              Studio<span className="text-indigo-600">Flow</span>
            </Link>
            <RoleNav />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-slate-500">
          <p>All times are shown in the studio&rsquo;s local timezone.</p>
        </footer>
      </body>
    </html>
  );
}
STUDIOFLOW_EOF

write 'app/my/credits/page.tsx' << 'STUDIOFLOW_EOF'
import { redirect } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { CreditBalanceCard } from '@/components/credits/CreditBalanceCard';
import { CreditLedgerTable } from '@/components/credits/CreditLedgerTable';
import { LedgerPager } from '@/components/credits/LedgerPager';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getBalance, getLedgerPage } from '@/lib/data/credits.queries';

/**
 * app/my/credits/page.tsx — SERVER COMPONENT.
 *
 * ==========================================================================
 * PAGINATION IS KEYSET, NOT OFFSET
 * ==========================================================================
 * The cursor is (created_at, id), carried in the URL. Two reasons, from
 * Basic Scaling §4.3:
 *
 *   1. Constant cost at any depth. OFFSET 500 makes Postgres scan and discard
 *      500 rows to return 25.
 *   2. Stability under concurrent inserts. Offset pagination can show a row
 *      twice, or skip one, when a new entry arrives while the student is
 *      browsing. On a FINANCIAL record that is not a cosmetic glitch — "the
 *      same charge appears twice" is a support ticket and a trust problem.
 *
 * The id is the tiebreaker because a booking deduction and its refund can
 * share a created_at to the microsecond, which would leave a timestamp-only
 * cursor ambiguous.
 *
 * ==========================================================================
 * AUTHORISATION
 * ==========================================================================
 * The redirect below is a UX affordance, not the security boundary. Every
 * query on this page reads as the calling user, and the RLS policies
 * credit_ledger_select_own / credit_grants_select_own restrict rows to
 * student_id = auth.uid(). A student cannot see another student's ledger even
 * by crafting a direct PostgREST request with their own JWT (tests PR-12,
 * PR-13).
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My credits — StudioFlow',
};

const PAGE_SIZE = 25;

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursorAt?: string; cursorId?: string }>;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/my/credits');

  const membership = await getMembership();
  const timeZone = membership?.timezone ?? 'Asia/Jerusalem';
  const nowIso = new Date().toISOString();

  const params = await searchParams;
  const cursor = parseCursor(params.cursorAt, params.cursorId);

  // Independent reads, issued in parallel: the balance does not depend on the
  // ledger page, so awaiting them in sequence would double the latency.
  const [balance, ledger] = await Promise.all([
    getBalance(user.id),
    getLedgerPage(user.id, cursor, PAGE_SIZE),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          My credits
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Every credit added, used, returned or expired — in order.
        </p>
      </header>

      <CreditBalanceCard
        balance={balance.balance}
        nextExpiryAt={balance.nextExpiryAt}
        timeZone={timeZone}
        nowIso={nowIso}
      />

      <Card>
        <CardHeader
          title="History"
          description="This record cannot be edited or deleted — by anyone, including the studio."
        />

        {ledger.entries.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={<Receipt className="h-8 w-8" aria-hidden="true" />}
              title="Nothing here yet"
              description="Once the studio adds a class package, every credit movement will be listed here."
            />
          </div>
        ) : (
          <>
            <CreditLedgerTable entries={ledger.entries} timeZone={timeZone} />
            <LedgerPager
              nextCursor={ledger.nextCursor}
              hasCursor={cursor !== null}
            />
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * A malformed or hand-edited cursor degrades to "start from the beginning"
 * rather than erroring. The values also reach a query, so they are validated
 * for shape before use rather than trusted from the address bar.
 */
function parseCursor(
  cursorAt: string | undefined,
  cursorId: string | undefined,
): { createdAt: string; id: string } | null {
  if (!cursorAt || !cursorId) return null;

  const timestamp = Date.parse(cursorAt);
  if (Number.isNaN(timestamp)) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cursorId,
    );
  if (!isUuid) return null;

  return { createdAt: new Date(timestamp).toISOString(), id: cursorId };
}
STUDIOFLOW_EOF

write 'app/my/layout.tsx' << 'STUDIOFLOW_EOF'
import { redirect } from 'next/navigation';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';

/**
 * app/my/layout.tsx — SERVER COMPONENT guarding the student area.
 *
 * This is a USER-EXPERIENCE guard, not a security boundary. It exists so a
 * signed-out visitor gets a login page instead of an empty dashboard. The
 * actual protection is RLS: every query beneath this layout returns only rows
 * belonging to auth.uid(), whether or not this check runs.
 *
 * It also enforces the temporary-password rotation from Security §1.6 — an
 * instructor still holding the password their admin handed them is sent to
 * change it before anything else becomes reachable.
 */

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/my/bookings');

  const membership = await getMembership();
  if (membership?.mustChangePassword) redirect('/change-password');

  return <>{children}</>;
}
STUDIOFLOW_EOF

write 'app/not-found.tsx' << 'STUDIOFLOW_EOF'
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

/** app/not-found.tsx — Server Component. Always offers a way back. */
export default function NotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        We couldn&rsquo;t find that
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        The class may have been cancelled, or the link may be out of date.
      </p>
      <Link
        href="/schedule"
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>
    </div>
  );
}
STUDIOFLOW_EOF

write 'app/page.tsx' << 'STUDIOFLOW_EOF'
import { redirect } from 'next/navigation';

/** The schedule is the front door of the product. */
export default function HomePage() {
  redirect('/schedule');
}
STUDIOFLOW_EOF

write 'app/schedule/[sessionId]/page.tsx' << 'STUDIOFLOW_EOF'
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, MapPin, User } from 'lucide-react';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { Card, CardBody } from '@/components/ui/card';
import { AvailabilityBadge } from '@/components/schedule/AvailabilityBadge';
import {
  getPrimaryStudio,
  getSessionDetail,
} from '@/lib/data/sessions.queries';
import { formatDayHeading, formatTime } from '@/lib/time/tz';

/**
 * app/schedule/[sessionId]/page.tsx — SERVER COMPONENT.
 *
 * This is the ONLY page that renders BookingPanel, and that is deliberate.
 * The panel resolves the viewer's booking, waitlist entry and credit balance,
 * which is three queries per session. Doing that for the forty cards on the
 * week view would reintroduce the HQ-1 N+1 the schedule page exists to avoid.
 *
 * The week view therefore shows only what the aggregate view already returned;
 * the personal state is resolved here, for one session, on demand.
 */

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({
  params,
}: {
  // Next.js 15: params is a Promise and must be awaited.
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const [studio, session] = await Promise.all([
    getPrimaryStudio(),
    getSessionDetail(sessionId),
  ]);

  // RLS returns zero rows for a session in another studio, so a cross-tenant
  // id is indistinguishable from a non-existent one. That is the correct
  // behaviour: confirming "this exists but you may not see it" is itself a
  // disclosure.
  if (!studio || !session) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/schedule"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {session.class_type_name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {formatDayHeading(session.starts_at, studio.timezone)}
              </p>
            </div>
            <AvailabilityBadge
              seatsAvailable={session.seats_available}
              waitingCount={session.waiting_count}
            />
          </div>

          {session.class_type_description ? (
            <p className="mt-4 text-sm text-slate-700">
              {session.class_type_description}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Time</dt>
              <dd>
                <time dateTime={session.starts_at}>
                  {formatTime(session.starts_at, studio.timezone)}
                </time>
                {' – '}
                <time dateTime={session.ends_at}>
                  {formatTime(session.ends_at, studio.timezone)}
                </time>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Instructor</dt>
              <dd>{session.instructor_name}</dd>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Room</dt>
              <dd>{session.room_name}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <BookingPanel
        session={session}
        timeZone={studio.timezone}
        cancellationWindowHours={studio.cancellationWindowHours}
      />
    </div>
  );
}
STUDIOFLOW_EOF

write 'app/schedule/page.tsx' << 'STUDIOFLOW_EOF'
import { CalendarX2 } from 'lucide-react';
import { SessionCard } from '@/components/schedule/SessionCard';
import { WeekNavigator } from '@/components/schedule/WeekNavigator';
import { EmptyState } from '@/components/ui/empty-state';
import {
  getPrimaryStudio,
  getScheduleRange,
} from '@/lib/data/sessions.queries';
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
        icon={<CalendarX2 className="h-8 w-8" aria-hidden="true" />}
        title="No studio is set up yet"
        description="Once a studio has been created its schedule will appear here."
      />
    );
  }

  const fromIso = weekStart(new Date(), weekOffset);
  const toIso = addDays(fromIso, 7);

  // Past classes are not bookable (BR-8), so on the current week we start from
  // now rather than from Monday — nobody wants to scroll past Tuesday's
  // finished 07:00 to reach Thursday.
  const effectiveFrom =
    weekOffset === 0 && new Date(fromIso) < new Date()
      ? new Date().toISOString()
      : fromIso;

  const sessions = await getScheduleRange(studio.id, effectiveFrom, toIso);
  const days = groupByLocalDay(sessions, studio.timezone);

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

      {days.length === 0 ? (
        <EmptyState
          icon={<CalendarX2 className="h-8 w-8" aria-hidden="true" />}
          title="No classes scheduled this week"
          description="Try the next week, or check back shortly — the studio may still be publishing its timetable."
        />
      ) : (
        <div className="space-y-6">
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
STUDIOFLOW_EOF

write 'components/attendance/AttendanceToggle.tsx' << 'STUDIOFLOW_EOF'
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
}: {
  bookingId: string;
  studentName: string;
  attendance: Attendance;
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
          // 44px minimum touch target: this is used standing up, one-handed.
          className={[
            'inline-flex h-11 w-11 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
            optimistic === 'attended'
              ? 'bg-emerald-600 text-white ring-emerald-600'
              : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Present</span>
        </button>

        <button
          type="button"
          onClick={() => mark('absent')}
          aria-pressed={optimistic === 'absent'}
          className={[
            'inline-flex h-11 w-11 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
            optimistic === 'absent'
              ? 'bg-slate-700 text-white ring-slate-700'
              : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Absent</span>
        </button>
      </div>
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/booking/BookButton.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/booking/BookButton.tsx
 *
 * CLIENT COMPONENT. A leaf: it renders one button and calls one action.
 *
 * ==========================================================================
 * WHY THIS IS NOT OPTIMISTIC
 * ==========================================================================
 * Design §6.3 states the rule: optimistic display is appropriate when failure
 * is EXCEPTIONAL, and inappropriate when failure is an EXPECTED OUTCOME of the
 * domain.
 *
 * Booking can legitimately fail. The seat may have been taken microseconds
 * earlier by another student — that is precisely the race that book_session's
 * row lock exists to resolve, and SESSION_FULL is its correct, expected
 * answer. Optimistically rendering "Booked!" and then retracting it is a worse
 * experience than a brief spinner, and it erodes trust in every other
 * confirmation the product shows.
 *
 * So: a pending state, then the truth.
 *
 * (AttendanceToggle DOES use useOptimistic, because marking attendance has no
 * contended failure mode. Same codebase, opposite decision, for a reason.)
 * ==========================================================================
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check } from 'lucide-react';
import { bookSession } from '@/actions/booking.actions';
import { joinWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function BookButton({ sessionId }: { sessionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [booked, setBooked] = useState(false);
  const router = useRouter();

  function handleBook() {
    setError(null);
    startTransition(async () => {
      const result = await bookSession(sessionId);

      if (result.ok) {
        setBooked(true);
        // revalidatePath already invalidated the server cache inside the
        // action; refresh() pulls the new server render so the seat count and
        // the balance in the nav both update.
        router.refresh();
        return;
      }
      setError({ code: result.code, message: result.message });
    });
  }

  function handleJoinWaitlist() {
    setError(null);
    startTransition(async () => {
      const result = await joinWaitlist(sessionId);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError({ code: result.code, message: result.message });
    });
  }

  if (booked) {
    return (
      <ActionMessage tone="success" message="You're booked in. See you there." />
    );
  }

  return (
    <div>
      <Button
        type="button"
        size="lg"
        onClick={handleBook}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Booking…
          </>
        ) : (
          <>
            <Check className="h-4 w-4" aria-hidden="true" />
            Book this class
          </>
        )}
      </Button>

      {error ? (
        <ActionMessage tone="error" message={error.message}>
          {/* SESSION_FULL is not a dead end. Business goal G1 depends on
              converting it into a waitlist entry, so the recovery action is
              offered right where the failure appeared. */}
          {error.code === 'SESSION_FULL' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleJoinWaitlist}
              disabled={isPending}
            >
              Join the waitlist
            </Button>
          ) : null}
        </ActionMessage>
      ) : null}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/booking/BookingPanel.tsx' << 'STUDIOFLOW_EOF'
import Link from 'next/link';
import { Ticket, LogIn, CalendarX2, Clock3 } from 'lucide-react';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getViewerSessionState } from '@/lib/data/sessions.queries';
import { hasStarted } from '@/lib/domain/policy';
import { formatDateTime } from '@/lib/time/tz';
import { BookButton } from './BookButton';
import { WaitlistButton } from './WaitlistButton';
import { CancelBookingDialog } from './CancelBookingDialog';
import { LeaveWaitlistButton } from './LeaveWaitlistButton';
import type { SessionWithAvailability } from '@/lib/types/database.types';

/**
 * components/booking/BookingPanel.tsx
 *
 * SERVER COMPONENT. The single most important composition decision in the UI.
 *
 * ==========================================================================
 * WHY THIS EXISTS
 * ==========================================================================
 * There are eight distinct things a viewer can be in relation to one session:
 * anonymous, not-a-member, already booked, already waitlisted, out of credits,
 * facing a full class, facing an open class, or looking at a class that has
 * already started or been cancelled.
 *
 * Resolving that on the CLIENT would mean shipping the balance, the booking
 * state, the waitlist position and the policy window to the browser, then
 * branching there — and every branch would need its own loading and error
 * handling. Worse, each client component would have to re-derive the same
 * viewer state independently, so a change to one rule would need finding in
 * four places.
 *
 * Instead this component resolves the state ONCE, on the server, and renders
 * EXACTLY ONE action component. The client components stay dumb and
 * single-purpose: BookButton books, WaitlistButton waits. Neither knows the
 * rules, and neither can disagree with the other about them.
 *
 * ==========================================================================
 * WHAT CROSSES THE BOUNDARY
 * ==========================================================================
 * Only plain serialisable values: strings, numbers, booleans. No Supabase
 * client, no Date object, no function. `refundEligible` in particular is
 * computed HERE and passed as a boolean, so CancelBookingDialog can state the
 * consequence without recomputing policy in the browser.
 *
 * Note this panel is rendered on the DETAIL page only, never inside the week
 * list. Resolving viewer state for forty cards would be forty extra round
 * trips — the HQ-1 N+1 in a new costume.
 */

export async function BookingPanel({
  session,
  timeZone,
  cancellationWindowHours,
}: {
  session: SessionWithAvailability;
  timeZone: string;
  cancellationWindowHours: number;
}) {
  const nowIso = new Date().toISOString();

  // ---- Terminal session states, identical for every viewer ---------------
  if (session.status === 'cancelled') {
    return (
      <PanelShell>
        <StateNotice
          icon={<CalendarX2 className="h-5 w-5" aria-hidden="true" />}
          title="This class has been cancelled"
          body={
            session.cancellation_reason
              ? `Reason: ${session.cancellation_reason}`
              : 'Anyone who had booked has had their credit returned.'
          }
        />
      </PanelShell>
    );
  }

  if (hasStarted(session.starts_at, nowIso)) {
    return (
      <PanelShell>
        <StateNotice
          icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
          title="This class has already started"
          body="Have a look at the schedule for upcoming classes."
        />
      </PanelShell>
    );
  }

  // ---- Anonymous ---------------------------------------------------------
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <PanelShell>
        <p className="text-sm text-slate-600">
          Sign in to book a place in this class.
        </p>
        <Link
          href={`/login?next=/schedule/${session.id}`}
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in to book
        </Link>
        <p className="mt-2 text-xs text-slate-500">
          New here? You can{' '}
          <Link href="/register" className="underline hover:text-slate-700">
            create an account
          </Link>{' '}
          in under a minute.
        </p>
      </PanelShell>
    );
  }

  // ---- Authenticated but not a member ------------------------------------
  const membership = await getMembership();

  if (!membership) {
    return (
      <PanelShell>
        <StateNotice
          icon={<Ticket className="h-5 w-5" aria-hidden="true" />}
          title="You're not a member of this studio yet"
          body="Contact the studio and they'll add you, then you can book straight away."
        />
      </PanelShell>
    );
  }

  const viewer = await getViewerSessionState(session.id, user.id);

  // ---- Already booked ----------------------------------------------------
  if (viewer.bookingId) {
    return (
      <PanelShell>
        <p className="text-sm font-medium text-emerald-800">
          You&rsquo;re booked into this class.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {formatDateTime(session.starts_at, timeZone)} · {session.room_name}
        </p>
        <div className="mt-4">
          <CancelBookingDialog
            bookingId={viewer.bookingId}
            className={session.class_type_name}
            whenLabel={formatDateTime(session.starts_at, timeZone)}
            sessionStartsAtIso={session.starts_at}
            cancellationWindowHours={cancellationWindowHours}
          />
        </div>
      </PanelShell>
    );
  }

  // ---- Already waitlisted ------------------------------------------------
  if (viewer.waitlistEntryId) {
    return (
      <PanelShell>
        <p className="text-sm font-medium text-slate-900">
          You&rsquo;re on the waitlist
          {viewer.waitlistPosition ? (
            <>
              {' '}
              — position{' '}
              <span className="tabular-nums">{viewer.waitlistPosition}</span>
            </>
          ) : null}
          .
        </p>
        <p className="mt-1 text-sm text-slate-600">
          If someone cancels, we&rsquo;ll book you in automatically and let you
          know. No credit is taken while you wait.
        </p>
        <div className="mt-4">
          <LeaveWaitlistButton entryId={viewer.waitlistEntryId} />
        </div>
      </PanelShell>
    );
  }

  // ---- Full: offer the waitlist -----------------------------------------
  if (session.is_full) {
    return (
      <PanelShell>
        <p className="text-sm text-slate-700">
          This class is full
          {session.waiting_count > 0
            ? ` — ${session.waiting_count} ${
                session.waiting_count === 1 ? 'person is' : 'people are'
              } waiting.`
            : '.'}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Join the waitlist and you&rsquo;ll be booked in automatically if a
          place opens up. Nothing is charged unless that happens.
        </p>
        <div className="mt-4">
          <WaitlistButton sessionId={session.id} />
        </div>
      </PanelShell>
    );
  }

  // ---- Out of credits ----------------------------------------------------
  // Rendered as its own state rather than a disabled Book button, because the
  // repurchase prompt IS the sales mechanism behind business goal G4.
  if (viewer.balance < 1) {
    return (
      <PanelShell>
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-slate-900">
              You have no class credits left
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Contact the studio to buy a class package, and this class will be
              one tap away.
            </p>
            <Link
              href="/my/credits"
              className="mt-3 inline-flex text-sm font-medium text-indigo-700 underline hover:text-indigo-800"
            >
              View my credits
            </Link>
          </div>
        </div>
      </PanelShell>
    );
  }

  // ---- Bookable ----------------------------------------------------------
  return (
    <PanelShell>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-slate-700">
          {session.seats_available}{' '}
          {session.seats_available === 1 ? 'place' : 'places'} left
        </p>
        <p className="text-sm text-slate-500">
          Balance: <span className="tabular-nums">{viewer.balance}</span>
        </p>
      </div>
      <div className="mt-4">
        <BookButton sessionId={session.id} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Booking uses 1 credit. Free cancellation up to{' '}
        {cancellationWindowHours} hours before the class.
      </p>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Booking"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      {children}
    </section>
  );
}

function StateNotice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{body}</p>
      </div>
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/booking/CancelBookingDialog.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/booking/CancelBookingDialog.tsx
 *
 * CLIENT COMPONENT.
 *
 * ==========================================================================
 * THE MOST CAREFULLY DESIGNED SCREEN IN THE PRODUCT (Design §8.2)
 * ==========================================================================
 * A student must NEVER discover a forfeited credit after the fact. This dialog
 * states the exact consequence BEFORE the confirm button is reachable, in one
 * of two forms:
 *
 *   outside the window ->  "Cancelling now returns 1 credit to your account."
 *   inside the window  ->  "This is a late cancellation. Your credit will not
 *                           be returned."
 *
 * Destructive styling appears ONLY in the second case. A red button on a
 * harmless action trains people to ignore red buttons, which is exactly when
 * the genuinely costly one arrives.
 *
 * ==========================================================================
 * WHERE THE POLICY DECISION ACTUALLY HAPPENS
 * ==========================================================================
 * This component DECIDES NOTHING. It calls describeCancellation() from
 * lib/domain/policy.ts purely to choose the wording. The authoritative rule
 * lives in cancel_booking() in Postgres, evaluated transactionally under a row
 * lock at the moment of cancellation.
 *
 * The two can drift — the student may leave this dialog open across the
 * 12-hour boundary. So the ACTUAL outcome is read back from the action's
 * `refunded` field and shown afterwards. The dialog predicts; the database
 * decides; the result reports. A contract test asserts the two implementations
 * agree on identical fixtures.
 *
 * ==========================================================================
 * WHY <dialog> RATHER THAN A DIV
 * ==========================================================================
 * The native element gives focus trapping, Escape-to-close, inert background
 * and correct screen-reader semantics without a single line of code. A
 * hand-rolled modal that gets any of those wrong is an accessibility defect
 * that no test in our suite would catch.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, CalendarX } from 'lucide-react';
import { cancelBooking } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';
import { describeCancellation } from '@/lib/domain/policy';

interface Props {
  bookingId: string;
  /** Plain strings only — no Date objects cross the server/client boundary. */
  className: string;
  whenLabel: string;
  sessionStartsAtIso: string;
  cancellationWindowHours: number;
}

export function CancelBookingDialog({
  bookingId,
  className,
  whenLabel,
  sessionStartsAtIso,
  cancellationWindowHours,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ refunded: boolean } | null>(null);
  const router = useRouter();

  /**
   * Evaluated when the dialog OPENS, not at render time, so a page that has
   * been sitting open does not show a stale prediction.
   */
  const [prediction, setPrediction] = useState(() =>
    describeCancellation(
      sessionStartsAtIso,
      new Date().toISOString(),
      cancellationWindowHours,
    ),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      setPrediction(
        describeCancellation(
          sessionStartsAtIso,
          new Date().toISOString(),
          cancellationWindowHours,
        ),
      );
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen, sessionStartsAtIso, cancellationWindowHours]);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelBooking(bookingId);

      if (result.ok) {
        // The DATABASE decided this, not the prediction above.
        setOutcome({ refunded: result.data.refunded });
        setIsOpen(false);
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  // Result is shown after the dialog closes, reporting what actually happened.
  if (outcome) {
    return (
      <ActionMessage
        tone={outcome.refunded ? 'success' : 'info'}
        message={
          outcome.refunded
            ? 'Booking cancelled. 1 credit has been returned to your account.'
            : 'Booking cancelled. As this was a late cancellation, the credit was not returned.'
        }
      />
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setIsOpen(true)}
      >
        <CalendarX className="h-4 w-4" aria-hidden="true" />
        Cancel my booking
      </Button>

      <dialog
        ref={dialogRef}
        // Escape and backdrop dismissal both route through the same state.
        onClose={() => setIsOpen(false)}
        onCancel={(event) => {
          if (isPending) event.preventDefault(); // don't close mid-request
        }}
        aria-labelledby="cancel-dialog-title"
        className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="p-5">
          <h2
            id="cancel-dialog-title"
            className="text-base font-semibold text-slate-900"
          >
            Cancel this booking?
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            {className} · {whenLabel}
          </p>

          {/* THE CONSEQUENCE, STATED BEFORE CONFIRMATION. */}
          <div
            className={[
              'mt-4 flex items-start gap-2.5 rounded-lg px-3 py-3 text-sm ring-1 ring-inset',
              prediction.refundEligible
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-amber-50 text-amber-900 ring-amber-200',
            ].join(' ')}
          >
            {!prediction.refundEligible ? (
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <span>
              <strong className="font-semibold">{prediction.headline}</strong>
              <br />
              <span className="text-[13px]">{prediction.detail}</span>
            </span>
          </div>

          {error ? <ActionMessage tone="error" message={error} /> : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Keep my booking
            </Button>
            <Button
              type="button"
              /* Destructive styling ONLY when a credit is actually lost. */
              variant={prediction.refundEligible ? 'primary' : 'destructive'}
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Cancelling…
                </>
              ) : prediction.refundEligible ? (
                'Cancel and get my credit back'
              ) : (
                'Cancel without a refund'
              )}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
STUDIOFLOW_EOF

write 'components/booking/LeaveWaitlistButton.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/booking/LeaveWaitlistButton.tsx
 *
 * CLIENT COMPONENT. No confirmation dialog: leaving a waitlist costs nothing
 * and is trivially reversible by re-joining. Confirmation prompts are reserved
 * for actions with a real consequence — see CancelBookingDialog, where a
 * credit can be lost.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { leaveWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function LeaveWaitlistButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await leaveWaitlist(entryId);
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.message);
          });
        }}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <X className="h-4 w-4" aria-hidden="true" />
        )}
        Leave the waitlist
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/booking/WaitlistButton.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/booking/WaitlistButton.tsx
 *
 * CLIENT COMPONENT. Joining a waitlist consumes NO credit — an entry is a
 * claim, not a booking — so the copy says so plainly. A student who thinks
 * waiting costs a class will not wait.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ListPlus } from 'lucide-react';
import { joinWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function WaitlistButton({ sessionId }: { sessionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={isPending}
        className="w-full"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await joinWaitlist(sessionId);
            if (result.ok) {
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
            Joining…
          </>
        ) : (
          <>
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Join the waitlist
          </>
        )}
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/credits/CreditBalanceCard.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/credits/CreditBalanceCard.tsx
 *
 * SERVER COMPONENT.
 *
 * Design principle 3: THE BALANCE IS ALWAYS VISIBLE. Visibility is not a
 * courtesy, it is the sales mechanism behind business goal G4 — students who
 * can see "1 class remaining" repurchase sooner than students who have to ask.
 *
 * The expiry warning appears only within 30 days (Design §8.2). A package
 * expiring in eight months is noise; one expiring on Friday is the reason the
 * student opened this page.
 */

import { Ticket, AlertTriangle } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { formatShortDate } from '@/lib/time/tz';
import { shouldWarnAboutExpiry } from '@/lib/domain/policy';

export function CreditBalanceCard({
  balance,
  nextExpiryAt,
  timeZone,
  nowIso,
}: {
  balance: number;
  nextExpiryAt: string | null;
  timeZone: string;
  nowIso: string;
}) {
  const warn = shouldWarnAboutExpiry(nextExpiryAt, nowIso);

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Ticket className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm text-slate-600">Class credits</p>
            <p className="text-3xl font-semibold tabular-nums text-slate-900">
              {balance}
            </p>
          </div>
        </div>

        {balance === 0 ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            You have no classes left. Contact the studio to buy a package and
            you can book again straight away.
          </p>
        ) : null}

        {warn && nextExpiryAt ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Some of your credits expire on{' '}
              <strong className="font-semibold">
                {formatShortDate(nextExpiryAt, timeZone)}
              </strong>
              . Book before then to use them.
            </span>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
STUDIOFLOW_EOF

write 'components/credits/CreditLedgerTable.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/credits/CreditLedgerTable.tsx
 *
 * SERVER COMPONENT.
 *
 * Each row reads as a SENTENCE, not a database record: "Booked Vinyasa Flow,
 * Tue 3 Sep, 07:00" rather than "booking  -1". The ledger is what a student
 * reads when they believe they have been charged wrongly, so it has to answer
 * the question in their own words (Design §8.2).
 *
 * The ledger is append-only, so this table is genuinely immutable history —
 * there is no edit control here because there is no UPDATE policy in the
 * database for ANY role, including the studio owner.
 */

import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatDateTime } from '@/lib/time/tz';
import { describeLedgerEntry } from '@/lib/domain/policy';
import type { LedgerEntry } from '@/lib/data/credits.queries';

export function CreditLedgerTable({
  entries,
  timeZone,
}: {
  entries: LedgerEntry[];
  timeZone: string;
}) {
  return (
    <ul className="divide-y divide-slate-200" aria-label="Credit history">
      {entries.map((entry) => {
        const positive = entry.delta > 0;
        const description = describeLedgerEntry(entry.entryType, entry.delta, {
          className: entry.className,
          when: entry.sessionStartsAt
            ? formatDateTime(entry.sessionStartsAt, timeZone)
            : null,
          note: entry.note,
        });

        return (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <span
              aria-hidden="true"
              className={[
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                positive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600',
              ].join(' ')}
            >
              {positive ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-900">{description}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDateTime(entry.createdAt, timeZone)}
              </p>
            </div>

            <span
              className={[
                'shrink-0 text-sm font-semibold tabular-nums',
                positive ? 'text-emerald-700' : 'text-slate-700',
              ].join(' ')}
            >
              {positive ? '+' : ''}
              {entry.delta}
              <span className="sr-only">
                {' '}
                {Math.abs(entry.delta) === 1 ? 'credit' : 'credits'}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
STUDIOFLOW_EOF

write 'components/credits/LedgerPager.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/credits/LedgerPager.tsx
 *
 * CLIENT COMPONENT holding NO state.
 *
 * The keyset cursor lives in the URL, exactly like the week in WeekNavigator.
 * That keeps the page shareable and refresh-safe, and it means the SERVER
 * fetches the next page — no client-side data layer, no cache to invalidate.
 *
 * Keyset rather than offset (Scaling §4.3): page 400 costs the same as page 1,
 * and a new ledger entry arriving mid-browse cannot cause a row to appear
 * twice or be skipped. On a financial record, a duplicated charge on screen is
 * a support ticket, not a cosmetic glitch.
 */

import Link from 'next/link';
import { ChevronRight, ChevronLeft } from 'lucide-react';

export function LedgerPager({
  nextCursor,
  hasCursor,
}: {
  nextCursor: { createdAt: string; id: string } | null;
  hasCursor: boolean;
}) {
  if (!nextCursor && !hasCursor) return null;

  const nextHref = nextCursor
    ? `/my/credits?cursorAt=${encodeURIComponent(nextCursor.createdAt)}&cursorId=${nextCursor.id}`
    : null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-5">
      {hasCursor ? (
        <Link
          href="/my/credits"
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back to the start
        </Link>
      ) : (
        <span />
      )}

      {nextHref ? (
        <Link
          href={nextHref}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
        >
          Older entries
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className="px-3 text-sm text-slate-500">
          That&rsquo;s the whole history.
        </span>
      )}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/schedule/AvailabilityBadge.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/schedule/AvailabilityBadge.tsx
 *
 * SERVER COMPONENT.
 *
 * Design §8.3: COLOUR IS NEVER THE SOLE CARRIER OF MEANING. Every state below
 * includes text, so the badge works for a colour-blind user and in a
 * screenshot printed in greyscale. "Full · 3 waiting" is legible without any
 * colour at all.
 *
 * Three states, from Design §8.2:
 *   open  -> green, "6 spots left"
 *   low   -> amber, under 3 remaining
 *   full  -> grey,  "Full · N waiting"
 */

import { Badge } from '@/components/ui/badge';
import { availabilityTone } from '@/lib/domain/policy';

export function AvailabilityBadge({
  seatsAvailable,
  waitingCount,
}: {
  seatsAvailable: number;
  waitingCount: number;
}) {
  const tone = availabilityTone(seatsAvailable);

  if (tone === 'full') {
    return (
      <Badge tone="neutral">
        Full
        {waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
      </Badge>
    );
  }

  return (
    <Badge tone={tone === 'low' ? 'warning' : 'success'}>
      {seatsAvailable} {seatsAvailable === 1 ? 'spot' : 'spots'} left
    </Badge>
  );
}
STUDIOFLOW_EOF

write 'components/schedule/SessionCard.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/schedule/SessionCard.tsx
 *
 * SERVER COMPONENT. Zero JavaScript ships for this.
 *
 * The whole card is a link to the session detail page rather than an inline
 * booking button. That is deliberate: booking needs the viewer's credit
 * balance and existing-booking state, and resolving that for all forty
 * sessions on a week view would be forty extra round trips (the HQ-1 N+1
 * again). The card shows only what the aggregate view already returned.
 */

import Link from 'next/link';
import { Clock, MapPin, User } from 'lucide-react';
import { AvailabilityBadge } from './AvailabilityBadge';
import { formatTime } from '@/lib/time/tz';
import type { SessionWithAvailability } from '@/lib/types/database.types';

export function SessionCard({
  session,
  timeZone,
}: {
  session: SessionWithAvailability;
  timeZone: string;
}) {
  return (
    <Link
      href={`/schedule/${session.id}`}
      className="group flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:p-4"
    >
      {/* Class-type colour stripe. Decorative only — every fact it hints at is
          also written in text. */}
      <span
        aria-hidden="true"
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: session.class_type_color }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={session.starts_at}
            className="text-lg font-semibold tabular-nums text-slate-900"
          >
            {formatTime(session.starts_at, timeZone)}
          </time>
          <h3 className="text-base font-medium text-slate-900">
            {session.class_type_name}
          </h3>
        </div>

        <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Instructor</dt>
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.instructor_name}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Room</dt>
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.room_name}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Duration</dt>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <dd>{session.duration_minutes} min</dd>
          </div>
        </dl>
      </div>

      <div className="flex shrink-0 items-center">
        <AvailabilityBadge
          seatsAvailable={session.seats_available}
          waitingCount={session.waiting_count}
        />
      </div>
    </Link>
  );
}
STUDIOFLOW_EOF

write 'components/schedule/WeekNavigator.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/schedule/WeekNavigator.tsx
 *
 * CLIENT COMPONENT — but it holds NO STATE.
 *
 * The selected week lives in the URL as ?week=N, which is the state-management
 * decision from Design §6.1. Putting it in useState would make the view
 * unshareable, unbookmarkable, and lost on refresh; it would also force the
 * schedule itself to become a client component fetching its own data.
 *
 * Because the week is a search param, the SERVER re-renders the schedule for
 * the new week. This component only changes the address.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function WeekNavigator({
  weekOffset,
  rangeLabel,
}: {
  weekOffset: number;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function goToWeek(offset: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === 0) params.delete('week');
    else params.set('week', String(offset));

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => goToWeek(weekOffset - 1)}
        disabled={isPending}
        aria-label="Previous week"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <p
        className="text-sm font-medium text-slate-900"
        aria-live="polite"
        aria-busy={isPending}
      >
        {rangeLabel}
      </p>

      <button
        type="button"
        onClick={() => goToWeek(weekOffset + 1)}
        disabled={isPending}
        aria-label="Next week"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/shared/LocalTime.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/shared/LocalTime.tsx
 *
 * SERVER COMPONENT. Renders a UTC instant in the STUDIO's timezone.
 *
 * Rendering on the server is the point. If the browser formatted the time, a
 * student travelling — or simply with a misconfigured device clock — would see
 * a different hour than the class actually runs at. The studio's timezone is
 * the truth, not the viewer's (test DB-39).
 *
 * <time dateTime={...}> keeps the machine-readable instant in the markup for
 * assistive technology and for copy-paste into a calendar.
 */

import { formatDateTime, formatTime } from '@/lib/time/tz';

export function LocalTime({
  iso,
  timeZone,
  mode = 'time',
  className,
}: {
  iso: string;
  timeZone: string;
  mode?: 'time' | 'datetime';
  className?: string;
}) {
  const label = mode === 'time' ? formatTime(iso, timeZone) : formatDateTime(iso, timeZone);
  return (
    <time dateTime={iso} className={className}>
      {label}
    </time>
  );
}
STUDIOFLOW_EOF

write 'components/shared/RoleNav.tsx' << 'STUDIOFLOW_EOF'
import Link from 'next/link';
import {
  CalendarDays,
  Ticket,
  BookMarked,
  Bell,
  Users,
  Settings,
  ClipboardList,
  BarChart3,
  LogIn,
} from 'lucide-react';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/shared/SignOutButton';

/**
 * components/shared/RoleNav.tsx
 *
 * SERVER COMPONENT. This is the important part.
 *
 * The role is read on the server, from studio_members, on every render. It is
 * never sent to the browser as state, never held in a client store, and never
 * inferred from a JWT claim. The browser receives only the finished HTML for
 * the links that user is entitled to see.
 *
 * This is presentation, NOT security. Hiding the /admin link protects nobody:
 * an attacker types the URL. What actually stops them is the RLS policy that
 * returns zero rows. Navigation exists so a student is never shown a control
 * that will fail — a better experience, not a boundary.
 *
 * Only the sign-out button below is a Client Component. Everything else here
 * ships as markup with no JavaScript at all.
 */

interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STUDENT_LINKS: NavLink[] = [
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/my/bookings', label: 'My classes', icon: BookMarked },
  { href: '/my/credits', label: 'Credits', icon: Ticket },
];

const INSTRUCTOR_LINKS: NavLink[] = [
  { href: '/teach', label: 'Teaching', icon: ClipboardList },
];

const ADMIN_LINKS: NavLink[] = [
  { href: '/admin/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/admin/students', label: 'Students', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export async function RoleNav() {
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <nav className="flex items-center gap-1" aria-label="Main">
        <NavItem href="/schedule" label="Schedule" icon={CalendarDays} />
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in
        </Link>
      </nav>
    );
  }

  const membership = await getMembership();

  // Authenticated but not a member of any studio — a real state, not an error.
  if (!membership) {
    return (
      <nav className="flex items-center gap-1" aria-label="Main">
        <NavItem href="/schedule" label="Schedule" icon={CalendarDays} />
        <SignOutButton />
      </nav>
    );
  }

  const links: NavLink[] = [
    ...STUDENT_LINKS,
    ...(membership.role === 'instructor' || membership.role === 'admin'
      ? INSTRUCTOR_LINKS
      : []),
    ...(membership.role === 'admin' ? ADMIN_LINKS : []),
  ];

  const unreadCount = await getUnreadCount();

  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
      {links.map((link) => (
        <NavItem key={link.href} {...link} />
      ))}

      <Link
        href="/my/notifications"
        className="relative inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Alerts</span>
        {unreadCount > 0 ? (
          <span
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-semibold text-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Link>

      <SignOutButton />
    </nav>
  );
}

function NavItem({ href, label, icon: Icon }: NavLink) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}

/**
 * Unread badge count.
 *
 * `head: true` requests the count WITHOUT the rows — this renders on every
 * authenticated page, and fetching the notification bodies to display a number
 * would be pure waste. Backed by the partial index notifications_unread_idx,
 * which stays small because most notifications get read (Scaling §2.6).
 */
async function getUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) return 0;
  return count ?? 0;
}
STUDIOFLOW_EOF

write 'components/shared/SignOutButton.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/shared/SignOutButton.tsx
 *
 * CLIENT COMPONENT — and deliberately a tiny one.
 *
 * This is the "client island" pattern in miniature. RoleNav is a Server
 * Component rendering a dozen links; only this one button needs an event
 * handler, so only this one button ships JavaScript. Marking RoleNav itself
 * "use client" to get one onClick would drag the entire navigation, its icons
 * and its data-fetching into the browser bundle.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { signOut } from '@/actions/member.actions';

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
          router.replace('/schedule');
          // Discards the client-side router cache so no stale
          // authenticated markup survives the sign-out.
          router.refresh();
        })
      }
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">
        {isPending ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
STUDIOFLOW_EOF

write 'components/ui/action-message.tsx' << 'STUDIOFLOW_EOF'
'use client';

/**
 * components/ui/action-message.tsx
 *
 * Inline feedback for a Server Action result.
 *
 * DEVIATION FROM THE DESIGN DOCUMENT, recorded rather than hidden: §6.1 listed
 * `sonner` for transient feedback. Toasts are the wrong control for these
 * particular messages:
 *
 *   - "This class is full — join the waitlist?" is not transient. It is an
 *     OFFER, and business goal G1 depends on the student acting on it. A
 *     message that disappears after four seconds cannot be acted on.
 *   - "You have no classes left" needs to sit next to the disabled button that
 *     caused it, not float in a corner.
 *
 * So results render inline, next to the control. `role="alert"` on failures
 * makes a screen reader announce them immediately — satisfying Design §8.3's
 * requirement that action results reach a screen-reader user. sonner can still
 * be added later for genuinely incidental confirmations.
 */

import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export type MessageTone = 'success' | 'error' | 'info';

const STYLES: Record<MessageTone, string> = {
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  error: 'bg-rose-50 text-rose-900 ring-rose-200',
  info: 'bg-indigo-50 text-indigo-900 ring-indigo-200',
};

export function ActionMessage({
  tone,
  message,
  children,
}: {
  tone: MessageTone;
  message: string;
  /** Optional follow-up control, e.g. "Join the waitlist" after SESSION_FULL. */
  children?: React.ReactNode;
}) {
  const Icon =
    tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;

  return (
    <div
      // Failures interrupt; successes are announced politely.
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`mt-3 flex flex-col gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${STYLES[tone]}`}
    >
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {children}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/ui/badge.tsx' << 'STUDIOFLOW_EOF'
/** components/ui/badge.tsx — Server Component. */

import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
  info: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
STUDIOFLOW_EOF

write 'components/ui/button.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/ui/button.tsx
 *
 * SERVER COMPONENT. No "use client" — a <button> with no handler needs no
 * JavaScript. Client behaviour is added by the caller wrapping it, not by
 * making every button in the app a client component.
 *
 * Written by hand rather than pulled from shadcn's CLI, which matches the
 * approach in Architecture §6.3: components are copied into the repository so
 * they are readable, modifiable and explainable. Dropping in real shadcn/ui
 * later needs no call-site changes, since the prop shape is the same.
 */

import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600',
  secondary:
    'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-600',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-600',
  destructive:
    'bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-600',
};

const SIZES: Record<Size, string> = {
  // min-h-11 is 44px: the minimum touch target from Design §8.3. Students book
  // on a phone, in a hurry, often already in the studio doorway.
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-colors focus-visible:outline focus-visible:outline-2',
        'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
STUDIOFLOW_EOF

write 'components/ui/card.tsx' << 'STUDIOFLOW_EOF'
/** components/ui/card.tsx — Server Component. Layout only. */

import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
STUDIOFLOW_EOF

write 'components/ui/empty-state.tsx' << 'STUDIOFLOW_EOF'
/**
 * components/ui/empty-state.tsx — Server Component.
 *
 * Design principle 4: empty states TEACH. A studio with no classes yet shows
 * the admin how to create one; a student with no bookings is pointed at the
 * schedule. A blank panel tells a new user their software is broken.
 */

import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-slate-400">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
STUDIOFLOW_EOF

write 'lib/data/credits.queries.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/data/credits.queries.ts
 *
 * READ-ONLY.
 *
 * The ledger uses KEYSET pagination, not offset. That choice is deliberate and
 * is explained in Basic Scaling §4.3:
 *
 *   - Constant cost regardless of depth. Page 400 costs the same as page 1,
 *     whereas OFFSET 10000 makes Postgres scan and discard 10,000 rows.
 *   - Stable under concurrent inserts. Offset pagination can show a row twice
 *     or skip one entirely when a new entry arrives mid-browse — and this is a
 *     financial record, so "the same charge appeared twice" is a support
 *     ticket, not a cosmetic glitch.
 *
 * The cursor is (created_at, id), not created_at alone. Two ledger entries can
 * share a timestamp to the microsecond — a booking deduction and its refund in
 * the same transaction — and ordering on the timestamp alone leaves the cursor
 * ambiguous. The id is the tiebreaker.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type { LedgerEntryType } from '@/lib/types/database.types';

export interface BalanceSummary {
  balance: number;
  nextExpiryAt: string | null;
}

export async function getBalance(userId: string): Promise<BalanceSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_student_balances')
    .select('balance, next_expiry_at')
    .eq('student_id', userId)
    .maybeSingle();

  if (error) {
    logServerError('getBalance', error);
    return { balance: 0, nextExpiryAt: null };
  }

  return {
    balance: data?.balance ?? 0,
    nextExpiryAt: data?.next_expiry_at ?? null,
  };
}

export interface LedgerEntry {
  id: string;
  createdAt: string;
  delta: number;
  entryType: LedgerEntryType;
  note: string | null;
  sessionId: string | null;
  className: string | null;
  sessionStartsAt: string | null;
}

export interface LedgerPage {
  entries: LedgerEntry[];
  nextCursor: { createdAt: string; id: string } | null;
}

/**
 * One page of ledger history.
 *
 * We fetch pageSize + 1 rows and discard the extra. That is how "is there
 * another page?" is answered WITHOUT a separate COUNT over the whole table —
 * a count that would grow with the student's entire history just to decide
 * whether to render one button.
 */
export async function getLedgerPage(
  userId: string,
  cursor: { createdAt: string; id: string } | null,
  pageSize = 25,
): Promise<LedgerPage> {
  const supabase = await createClient();

  let query = supabase
    .from('credit_ledger')
    .select('id, created_at, delta, entry_type, note, session_id')
    .eq('student_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    // Row-value comparison: everything strictly before (created_at, id).
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    logServerError('getLedgerPage', error);
    return { entries: [], nextCursor: null };
  }

  const rows = data ?? [];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  // Resolve class names for the rows that reference a session — ONE query for
  // the whole page, not one per row.
  const sessionIds = [
    ...new Set(
      page
        .map((row) => row.session_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];

  const sessionInfo = new Map<string, { name: string; startsAt: string }>();

  if (sessionIds.length > 0) {
    const { data: sessions, error: sessionError } = await supabase
      .from('v_sessions_with_availability')
      .select('id, class_type_name, starts_at')
      .in('id', sessionIds);

    if (sessionError) {
      logServerError('getLedgerPage:sessions', sessionError);
    } else {
      for (const session of sessions ?? []) {
        sessionInfo.set(session.id, {
          name: session.class_type_name,
          startsAt: session.starts_at,
        });
      }
    }
  }

  const entries: LedgerEntry[] = page.map((row) => {
    const info = row.session_id ? sessionInfo.get(row.session_id) : undefined;
    return {
      id: row.id,
      createdAt: row.created_at,
      delta: row.delta,
      entryType: row.entry_type,
      note: row.note,
      sessionId: row.session_id,
      className: info?.name ?? null,
      sessionStartsAt: info?.startsAt ?? null,
    };
  });

  const last = entries[entries.length - 1];
  const nextCursor =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { entries, nextCursor };
}

/** Active packages, for the "expiring soon" panel. */
export interface ActiveGrant {
  id: string;
  creditsTotal: number;
  creditsRemaining: number;
  expiresAt: string | null;
  note: string | null;
}

export async function getActiveGrants(userId: string): Promise<ActiveGrant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('credit_grants')
    .select('id, credits_total, credits_remaining, expires_at, note')
    .eq('student_id', userId)
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .order('expires_at', { ascending: true, nullsFirst: false });

  if (error) {
    logServerError('getActiveGrants', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    creditsTotal: row.credits_total,
    creditsRemaining: row.credits_remaining,
    expiresAt: row.expires_at,
    note: row.note,
  }));
}
STUDIOFLOW_EOF

write 'lib/data/sessions.queries.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/data/sessions.queries.ts
 *
 * READ-ONLY. Nothing in lib/data/ ever writes — writes go through actions/.
 *
 * Every function here obeys two rules from the Scaling document:
 *
 *   1. AGGREGATE, NEVER LOOP. Counts shown in a list are computed by the same
 *      query that fetches the list. A `.map()` containing an `await` on a data
 *      function is rejected in review — that is the N+1 (HQ-1) that turns one
 *      round trip into forty-one on the busiest page in the product.
 *
 *   2. EVERY QUERY IS BOUNDED. The schedule is always a date range, never
 *      "all sessions".
 *
 * These read as the CALLING USER, so RLS filters the rows. There is no
 * ownership filter anywhere below, and none is needed.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type {
  SessionWithAvailability,
  WaitlistPosition,
} from '@/lib/types/database.types';

export interface StudioSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  cancellationWindowHours: number;
  promotionCutoffHours: number;
}

/**
 * The studio whose schedule the public site shows.
 *
 * v1 serves a single studio, so this takes the first one. The multi-tenant
 * schema is already in place; only this resolution step changes when a second
 * studio is onboarded (it becomes a slug lookup from the route).
 */
export async function getPrimaryStudio(): Promise<StudioSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studios')
    .select(
      'id, name, slug, timezone, cancellation_window_hours, promotion_cutoff_hours',
    )
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logServerError('getPrimaryStudio', error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    timezone: data.timezone,
    cancellationWindowHours: data.cancellation_window_hours,
    promotionCutoffHours: data.promotion_cutoff_hours,
  };
}

/**
 * The whole week's schedule in ONE round trip (solves HQ-1).
 *
 * v_sessions_with_availability computes booked_count, seats_available and
 * waiting_count in a single pass, so rendering forty sessions costs the same
 * as rendering one. The view is declared security_invoker = true, so RLS still
 * applies to the caller — a view that bypassed RLS would be a performance fix
 * that silently became a security hole.
 */
export async function getScheduleRange(
  studioId: string,
  fromIso: string,
  toIso: string,
): Promise<SessionWithAvailability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select('*')
    .eq('studio_id', studioId)
    .eq('status', 'scheduled')
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true });

  if (error) {
    logServerError('getScheduleRange', error);
    return [];
  }
  return data ?? [];
}

export async function getSessionDetail(
  sessionId: string,
): Promise<SessionWithAvailability | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_sessions_with_availability')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    logServerError('getSessionDetail', error);
    return null;
  }
  return data;
}

/**
 * Everything BookingPanel needs about one viewer's relationship to one
 * session, resolved server-side so the client components stay dumb.
 */
export interface ViewerSessionState {
  bookingId: string | null;
  waitlistEntryId: string | null;
  waitlistPosition: number | null;
  balance: number;
}

export async function getViewerSessionState(
  sessionId: string,
  userId: string,
): Promise<ViewerSessionState> {
  const supabase = await createClient();

  // Three independent reads, issued in parallel. They touch different tables
  // and none depends on another's result, so awaiting them in sequence would
  // triple the latency for no benefit.
  const [bookingResult, waitlistResult, balanceResult] = await Promise.all([
    supabase
      .from('bookings')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', userId)
      .eq('status', 'confirmed')
      .maybeSingle(),
    supabase
      .from('v_waitlist_positions')
      .select('id, position')
      .eq('session_id', sessionId)
      .eq('student_id', userId)
      .maybeSingle(),
    supabase
      .from('v_student_balances')
      .select('balance')
      .eq('student_id', userId)
      .maybeSingle(),
  ]);

  if (bookingResult.error) logServerError('viewerState:booking', bookingResult.error);
  if (waitlistResult.error) logServerError('viewerState:waitlist', waitlistResult.error);
  if (balanceResult.error) logServerError('viewerState:balance', balanceResult.error);

  const waitlist = waitlistResult.data as Pick<
    WaitlistPosition,
    'id' | 'position'
  > | null;

  return {
    bookingId: bookingResult.data?.id ?? null,
    waitlistEntryId: waitlist?.id ?? null,
    waitlistPosition: waitlist?.position ?? null,
    balance: balanceResult.data?.balance ?? 0,
  };
}

/** A student's upcoming confirmed bookings, joined to session detail. */
export interface UpcomingBooking {
  bookingId: string;
  sessionId: string;
  startsAt: string;
  className: string;
  instructorName: string;
  roomName: string;
}

export async function getUpcomingBookings(
  userId: string,
): Promise<UpcomingBooking[]> {
  const supabase = await createClient();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, session_id')
    .eq('student_id', userId)
    .eq('status', 'confirmed');

  if (error) {
    logServerError('getUpcomingBookings', error);
    return [];
  }
  if (!bookings || bookings.length === 0) return [];

  // One follow-up query for ALL sessions — not one per booking.
  const { data: sessions, error: sessionError } = await supabase
    .from('v_sessions_with_availability')
    .select('id, starts_at, class_type_name, instructor_name, room_name')
    .in(
      'id',
      bookings.map((booking) => booking.session_id),
    )
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });

  if (sessionError) {
    logServerError('getUpcomingBookings:sessions', sessionError);
    return [];
  }

  const bookingBySession = new Map(
    bookings.map((booking) => [booking.session_id, booking.id]),
  );

  return (sessions ?? []).flatMap((session) => {
    const bookingId = bookingBySession.get(session.id);
    if (!bookingId) return [];
    return [
      {
        bookingId,
        sessionId: session.id,
        startsAt: session.starts_at,
        className: session.class_type_name,
        instructorName: session.instructor_name,
        roomName: session.room_name,
      },
    ];
  });
}
STUDIOFLOW_EOF

write 'lib/domain/policy.ts' << 'STUDIOFLOW_EOF'
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
STUDIOFLOW_EOF

write 'lib/time/tz.ts' << 'STUDIOFLOW_EOF'
/**
 * lib/time/tz.ts
 *
 * All timestamps are stored UTC (BR-14) and DISPLAYED in the studio's
 * timezone. This module is the only place that conversion happens.
 *
 * DEVIATION FROM THE ARCHITECTURE DOCUMENT, recorded rather than hidden:
 * §6.4 specified date-fns + date-fns-tz. In implementation that dependency
 * buys nothing, because the work splits cleanly in two:
 *
 *   - DISPLAY in a named zone -> Intl.DateTimeFormat does this natively and
 *     correctly, including DST, with zero dependencies.
 *   - DST-SENSITIVE ARITHMETIC (advancing a 07:00 class by a week across a
 *     clock change) -> already lives in Postgres, inside
 *     create_recurring_sessions, where it has to be anyway.
 *
 * What remains in TypeScript is subtraction between two absolute instants,
 * which is timezone-independent by definition. If richer parsing is ever
 * needed, date-fns-tz drops in behind this module without touching a single
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

/** Whole hours from `nowIso` until `iso`. Negative once the instant has passed. */
export function hoursUntil(iso: string, nowIso: string): number {
  return (new Date(iso).getTime() - new Date(nowIso).getTime()) / 3_600_000;
}

/** Monday 00:00 of the week containing `base`, offset by N weeks, as UTC ISO. */
export function weekStart(base: Date, weekOffset: number): string {
  const date = new Date(base);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday + weekOffset * 7);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
STUDIOFLOW_EOF

write 'next.config.mjs' << 'STUDIOFLOW_EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Security headers (Basic Security §6.2, improvement S2). Static config,
  // immediate benefit, no runtime cost.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
STUDIOFLOW_EOF

write 'postcss.config.mjs' << 'STUDIOFLOW_EOF'
/** Tailwind v4 runs entirely through this PostCSS plugin. */
const config = {
  plugins: { '@tailwindcss/postcss': {} },
};
export default config;
STUDIOFLOW_EOF

write 'tests/unit/policy.test.ts' << 'STUDIOFLOW_EOF'
import { describe, it, expect } from 'vitest';
import {
  isRefundEligible,
  describeCancellation,
  isInsidePromotionCutoff,
  hasStarted,
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
STUDIOFLOW_EOF

echo
echo "-----------------------------------------------------------------"
echo "Files written: $WROTE   skipped: $SKIPPED"
echo
echo "NEXT STEPS"
echo
echo "1) Install the UI dependencies:"
echo
echo "     npm i lucide-react"
echo "     npm i -D tailwindcss @tailwindcss/postcss postcss"
echo
echo "   AND PIN TYPESCRIPT TO 5.x — Next.js 15 does not support TypeScript 7:"
echo
echo "     npm i -D typescript@^5.9.3"
echo
echo "   Tailwind v4 needs NO tailwind.config.js — configuration lives in"
echo "   app/globals.css, which this script created."
echo
echo "2) Add the policy tests to your test run (they need no database):"
echo
echo "     npx vitest run tests/unit"
echo
echo "3) Build and run:"
echo
echo "     npm run build"
echo "     npm run dev"
echo
echo "NOTES"
echo
echo " - A system font stack is used instead of next/font/google, because"
echo "   next/font downloads at BUILD time and fails on a restricted network."
echo
echo " - Routes referenced by RoleNav that are not part of Part 3"
echo "   (/my/bookings, /teach, /admin/*, /login, /register) will 404 until"
echo "   you add them. The links are there so the navigation is complete."
echo "-----------------------------------------------------------------"
