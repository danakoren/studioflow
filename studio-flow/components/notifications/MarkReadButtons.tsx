'use client';

/**
 * components/notifications/MarkReadButtons.tsx
 *
 * CLIENT COMPONENTS. The two ways an alert gets cleared.
 *
 * ==========================================================================
 * WHY READING THE PAGE DOES NOT MARK EVERYTHING READ
 * ==========================================================================
 * The obvious implementation is to clear the unread flag in the page's own
 * render — open the feed, badge gone. It is wrong for two concrete reasons:
 *
 *   1. NEXT PREFETCHES LINKS. The header badge is a <Link> to this page, so
 *      Next may fetch the route as soon as it enters the viewport. A render
 *      that mutates would clear a member's alerts because they SCROLLED PAST
 *      the link, having never seen a word of it.
 *
 *   2. A GET SHOULD NOT WRITE. Rendering is re-run on refresh, on back
 *      navigation, and by the router cache; each of those becoming a write is a
 *      class of bug that is very hard to see afterwards.
 *
 * So clearing is an explicit act, and the page keeps the unread styling until
 * the member does it. That also preserves the thing the styling is FOR: seeing
 * at a glance which alerts are new.
 *
 * ==========================================================================
 * router.refresh() IS WHAT CLEARS THE HEADER BADGE
 * ==========================================================================
 * The count in the navbar is rendered by RoleNav in the ROOT LAYOUT, not by
 * this page. The action's revalidatePath('/my/notifications') invalidates the
 * server render; router.refresh() then discards the client Router Cache so the
 * layout — and therefore the badge — is re-fetched. Without it the number would
 * sit there, stale, over an empty feed.
 *
 * revalidatePath('/', 'layout') would also do it, and is forbidden: it discards
 * the entire route cache for every user on the deployment to update one
 * person's badge (Basic Scaling §4.5, and the security audit greps for it).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Loader2 } from 'lucide-react';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function MarkAllReadButton({ unreadCount }: { unreadCount: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (unreadCount === 0) return null;

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markAllNotificationsRead();
            if (result.ok) {
              // Repaints the feed AND the header badge. See the note above.
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
            Clearing…
          </>
        ) : (
          <>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Mark all {unreadCount} as read
          </>
        )}
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}

export function MarkOneReadButton({
  notificationId,
  title,
}: {
  notificationId: string;
  /** Names the alert in the accessible label, so the button is not just "Mark read" repeated N times. */
  title: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="shrink-0">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markNotificationRead(notificationId);
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.message);
          });
        }}
        // 44px target: this sits in a list that is thumbed through on a phone.
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span aria-hidden="true">Mark read</span>
        <span className="sr-only">Mark &ldquo;{title}&rdquo; as read</span>
      </button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
