/**
 * lib/data/notifications.queries.ts
 *
 * READ-ONLY.
 *
 * ==========================================================================
 * ONE TABLE, TWO CHANNELS — AND THIS READS ONLY THE IN-APP ONE
 * ==========================================================================
 * `notifications` is deliberately both the in-app feed AND the transactional
 * email outbox (Architecture principle 5). The row is written inside the same
 * transaction as the event it describes, so it cannot be lost; email is a later
 * projection of it, dispatched by cron.
 *
 * That means the table carries delivery plumbing — email_status, email_attempts,
 * last_error — which is NOT selected here. A student does not need to know that
 * their promotion email is on its third retry, and "last_error" is exactly the
 * kind of internal detail Basic Security §4.4 keeps off the client. The feed
 * shows what happened, not how we tried to post it.
 *
 * As everywhere in lib/data/, there is no recipient filter: RLS
 * (notifications_select_own) restricts rows to recipient_id = auth.uid().
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/errors/map';
import type { NotificationType } from '@/lib/types/database.types';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Set when the alert is about a specific class, so the row can link to it. */
  relatedSessionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationItem[];
  /** Exact unread total — NOT items.filter(unread).length, see below. */
  unreadCount: number;
  /** True when older notifications exist beyond the fetched page. */
  hasMore: boolean;
}

/**
 * The notification feed, newest first.
 *
 * TWO queries, in parallel:
 *
 *   1. The page of rows, BOUNDED (Basic Scaling §2). A feed is append-only and
 *      grows forever, so "select everything" would get slower every week the
 *      studio operates.
 *
 *   2. An exact unread COUNT with head: true — the count WITHOUT the rows.
 *      Deriving it from the fetched page instead would silently under-report
 *      once a member has more unread items than the page size, and the badge in
 *      the header would disagree with the badge on the page. This is the same
 *      read RoleNav performs, and the two must not be able to drift.
 */
export async function getNotificationFeed(
  { limit = 50 } = {},
): Promise<NotificationFeed> {
  const supabase = await createClient();

  const [page, unread] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, title, body, related_session_id, read_at, created_at')
      .order('created_at', { ascending: false })
      // One extra row answers "is there more?" without a second COUNT over the
      // whole feed — the same trick getLedgerPage uses.
      .limit(limit + 1),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null),
  ]);

  if (page.error) {
    logServerError('getNotificationFeed', page.error);
    return { items: [], unreadCount: 0, hasMore: false };
  }
  if (unread.error) logServerError('getNotificationFeed:unread', unread.error);

  const rows = page.data ?? [];
  const hasMore = rows.length > limit;

  return {
    items: (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      relatedSessionId: row.related_session_id,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unreadCount: unread.count ?? 0,
    hasMore,
  };
}
