/**
 * components/notifications/NotificationRow.tsx
 *
 * SERVER COMPONENT. One alert. Only the mark-read button ships JavaScript.
 *
 * ==========================================================================
 * THE ICON IS DECORATION; THE TEXT CARRIES THE MEANING
 * ==========================================================================
 * Every type gets an icon and a tone, but the title and body already say what
 * happened — the row reads correctly in greyscale, with images off, and to a
 * screen reader. Unread state is signalled THREE ways for the same reason: a
 * left border, a tinted surface, and the word "New". Colour alone would leave
 * the most important distinction on this page invisible to some readers.
 *
 * ==========================================================================
 * WHY THE TITLE IS A LINK ONLY SOMETIMES
 * ==========================================================================
 * related_session_id is nullable — "credits granted" and "credits expiring"
 * belong to no class. Linking the row unconditionally would produce dead ends
 * pointing at /schedule/null. Where a class DOES exist the title links to it,
 * and the mark-read button stays a separate target rather than being nested
 * inside the link, which keyboard and screen-reader users navigate badly.
 */

import Link from 'next/link';
import {
  UserCheck,
  CalendarX2,
  CalendarClock,
  Ticket,
  TriangleAlert,
  CalendarCheck,
  Bell,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MarkOneReadButton } from '@/components/notifications/MarkReadButtons';
import { formatDateTime } from '@/lib/time/tz';
import type { NotificationItem } from '@/lib/data/notifications.queries';
import type { NotificationType } from '@/lib/types/database.types';

const PRESENTATION: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; classes: string }
> = {
  // A seat opened up — the mechanism behind business goal G1, so it gets the
  // most positive treatment on the page.
  waitlist_promoted: {
    icon: UserCheck,
    classes: 'bg-emerald-50 text-emerald-700',
  },
  session_cancelled: { icon: CalendarX2, classes: 'bg-rose-50 text-rose-700' },
  session_updated: {
    icon: CalendarClock,
    classes: 'bg-brand-50 text-brand-700',
  },
  credits_granted: { icon: Ticket, classes: 'bg-emerald-50 text-emerald-700' },
  credits_expiring: {
    icon: TriangleAlert,
    classes: 'bg-amber-50 text-amber-700',
  },
  booking_confirmed: {
    icon: CalendarCheck,
    classes: 'bg-slate-100 text-slate-600',
  },
};

export function NotificationRow({
  notification,
  timeZone,
}: {
  notification: NotificationItem;
  timeZone: string;
}) {
  const isUnread = notification.readAt === null;

  // Fall back rather than crashing if a new enum value ships before this map is
  // updated — an unknown alert type should still be readable.
  const presentation = PRESENTATION[notification.type] ?? {
    icon: Bell,
    classes: 'bg-slate-100 text-slate-600',
  };
  const Icon = presentation.icon;

  /*
   * A WAITLIST PROMOTION IS THE BEST NEWS THIS PRODUCT DELIVERS.
   *
   * It is also the only outcome the student did not trigger themselves — a seat
   * opened while they were elsewhere, and the app booked them in. There is no
   * click to attach feedback to, so the ALERT is the moment of feedback, and an
   * unread one gets a celebratory treatment the other types do not: an emerald
   * wash instead of the neutral brand tint, and a single light sweep on arrival.
   *
   * Only while UNREAD. Once acknowledged it settles into an ordinary row —
   * a permanent celebration is just decoration.
   */
  const isCelebration = isUnread && notification.type === 'waitlist_promoted';

  return (
    <li
      className={[
        'relative flex items-start gap-3 overflow-hidden border-l-2 px-4 py-3.5 sm:px-5',
        isCelebration
          ? 'border-l-emerald-500 bg-emerald-50/60'
          : isUnread
            ? 'border-l-brand-500 bg-brand-50/40'
            : 'border-l-transparent',
      ].join(' ')}
    >
      {isCelebration ? (
        <span
          aria-hidden="true"
          className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        />
      ) : null}
      {/* relative on both children so they stack above the absolute sheen. */}
      <span
        className={`relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${presentation.classes}`}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {notification.relatedSessionId ? (
            <Link
              href={`/schedule/${notification.relatedSessionId}`}
              className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
            >
              {notification.title}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-slate-900">
              {notification.title}
            </span>
          )}

          {isUnread ? <Badge tone="info">New</Badge> : null}
        </div>

        <p className="mt-0.5 text-sm text-slate-600">{notification.body}</p>

        <time
          dateTime={notification.createdAt}
          className="mt-1 block text-xs text-slate-500"
        >
          {formatDateTime(notification.createdAt, timeZone)}
        </time>
      </div>

      {isUnread ? (
        <MarkOneReadButton
          notificationId={notification.id}
          title={notification.title}
        />
      ) : null}
    </li>
  );
}
