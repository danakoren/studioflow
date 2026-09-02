/**
 * app/my/notifications/page.tsx — SERVER COMPONENT.
 *
 * The alerts feed. This is the route the header badge has been pointing at
 * since Part 3 began — note the path: the nav LABEL is "Alerts", but the route
 * is /my/notifications, which is why /alerts 404s.
 *
 * ==========================================================================
 * WHY THIS LIVES UNDER /my
 * ==========================================================================
 * Not for tidiness — for the guard. app/my/layout.tsx already redirects a
 * signed-out visitor and forces temporary-password rotation, so this page
 * inherits both and repeats neither. A sibling /alerts route would need its own
 * copy of that logic, which is one more place for it to drift.
 *
 * The feed is per-recipient by RLS rather than by a filter in this file, so
 * there is no `where recipient_id = ...` here to forget.
 *
 * force-dynamic: an unread count baked into a cached page would show one
 * member's alerts to the next visitor.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { MarkAllReadButton } from '@/components/notifications/MarkReadButtons';
import { linkButtonClasses } from '@/components/ui/link-button';
import { NotificationRow } from '@/components/notifications/NotificationRow';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyBellArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getNotificationFeed } from '@/lib/data/notifications.queries';
import { getStudioById } from '@/lib/data/sessions.queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Alerts — StudioFlow' };

const PAGE_SIZE = 50;

export default async function NotificationsPage() {
  const user = await getVerifiedUser();
  // The layout already guarded this; the check narrows the type.
  if (!user) redirect('/login?next=/my/notifications');

  const membership = await getMembership();

  const [studio, feed] = await Promise.all([
    membership ? getStudioById(membership.studioId) : Promise.resolve(null),
    getNotificationFeed({ limit: PAGE_SIZE }),
  ]);

  const timeZone = studio?.timezone ?? membership?.timezone ?? 'Asia/Jerusalem';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Alerts
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {feed.unreadCount > 0
              ? `${feed.unreadCount} unread — waitlist places, cancellations and credit changes.`
              : 'Waitlist places, cancellations and credit changes.'}
          </p>
        </div>

        <MarkAllReadButton unreadCount={feed.unreadCount} />
      </header>

      {feed.items.length === 0 ? (
        <EmptyState
          art={<EmptyBellArt className="h-full w-full" />}
          title="Nothing to catch up on"
          description="We'll let you know here if a waitlist place opens up, a class is cancelled, or your credits change."
          action={
            <Link
              href="/schedule"
              className={linkButtonClasses()}
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              See the schedule
            </Link>
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {feed.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                timeZone={timeZone}
              />
            ))}
          </ul>

          {feed.hasMore ? (
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-5">
              Showing your {PAGE_SIZE} most recent alerts.
            </p>
          ) : null}
        </Card>
      )}
    </div>
  );
}
