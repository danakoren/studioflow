/**
 * actions/booking.actions.ts
 *
 * Student-facing booking and waitlist mutations.
 *
 * Every action here is a THIN ORCHESTRATOR. The business rules — capacity,
 * credit consumption, refund eligibility, FIFO promotion — all live in the
 * Postgres functions from migration 007, under a row lock.
 *
 * That placement is not stylistic. The natural TypeScript implementation of
 * booking (read count, compare to capacity, insert) fails at exactly the
 * moment it matters most: the last seat of a popular class, when several
 * students tap simultaneously and Vercel runs their requests as genuinely
 * parallel invocations. Moving the check-and-write into one locked
 * transaction is the only correct fix, and it protects EVERY caller — this
 * action, a cron job, or an admin running SQL in the Supabase console.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import {
  fromRpc,
  envString,
  envBool,
  envNumber,
  mapPostgresError,
  logServerError,
} from '@/lib/errors/map';
import {
  bookSessionSchema,
  cancelBookingSchema,
  joinWaitlistSchema,
  leaveWaitlistSchema,
} from '@/lib/validation/booking.schema';
import {
  markNotificationReadSchema,
  markAllNotificationsReadSchema,
} from '@/lib/validation/studio.schema';

export interface BookSessionResult {
  bookingId: string;
  newBalance: number | null;
}

/**
 * Book a seat.
 *
 * Takes ONLY a sessionId. There is deliberately no studentId parameter: the
 * acting user comes from the verified session, so a caller cannot book on
 * someone else's behalf by editing the payload.
 */
export async function bookSession(
  sessionId: string,
): Promise<ActionResult<BookSessionResult>> {
  return runAction(
    { sessionId },
    {
      schema: bookSessionSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('book_session', {
          p_session_id: input.sessionId,
        });

        return fromRpc(data, error, (env) => ({
          bookingId: envString(env, 'booking_id') ?? '',
          newBalance: envNumber(env, 'new_balance'),
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/schedule/${input.sessionId}`,
        '/my/bookings',
        '/my/credits',
      ],
    },
  );
}

export interface CancelBookingResult {
  refunded: boolean;
  promotedBookingId: string | null;
  newBalance: number | null;
}

/**
 * Cancel a booking.
 *
 * The refund decision (BR-1/BR-2) and the waitlist promotion (BR-3/BR-7) both
 * happen inside cancel_booking(), in ONE transaction. The promotion email is
 * NOT sent here — the function writes an outbox row and the cron dispatcher
 * sends it later. External I/O inside the transaction would hold the session
 * lock across a network round trip and let a mail outage roll back a
 * legitimate cancellation.
 */
export async function cancelBooking(
  bookingId: string,
): Promise<ActionResult<CancelBookingResult>> {
  return runAction(
    { bookingId },
    {
      schema: cancelBookingSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('cancel_booking', {
          p_booking_id: input.bookingId,
        });

        return fromRpc(data, error, (env) => ({
          refunded: envBool(env, 'refunded'),
          promotedBookingId: envString(env, 'promoted_booking_id'),
          newBalance: envNumber(env, 'new_balance'),
        }));
      },
      // Cancelling can promote someone else, so the shared schedule changes
      // too — not just this student's pages.
      revalidate: () => [
        '/schedule',
        '/my/bookings',
        '/my/credits',
        '/my/history',
      ],
    },
  );
}

export interface JoinWaitlistResult {
  entryId: string;
  position: number | null;
}

/** Join a waitlist. Consumes NO credit — an entry is a claim, not a booking. */
export async function joinWaitlist(
  sessionId: string,
): Promise<ActionResult<JoinWaitlistResult>> {
  return runAction(
    { sessionId },
    {
      schema: joinWaitlistSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('join_waitlist', {
          p_session_id: input.sessionId,
        });

        return fromRpc(data, error, (env) => ({
          entryId: envString(env, 'entry_id') ?? '',
          position: envNumber(env, 'position'),
        }));
      },
      revalidate: ({ input }) => [
        '/schedule',
        `/schedule/${input.sessionId}`,
        '/my/bookings',
      ],
    },
  );
}

/** Leave a waitlist. Remaining positions shift up automatically, because
 *  position is derived from joined_at rather than stored. */
export async function leaveWaitlist(
  entryId: string,
): Promise<ActionResult<null>> {
  return runAction(
    { entryId },
    {
      schema: leaveWaitlistSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { data, error } = await supabase.rpc('leave_waitlist', {
          p_entry_id: input.entryId,
        });

        return fromRpc(data, error, () => null);
      },
      revalidate: () => ['/schedule', '/my/bookings'],
    },
  );
}

/**
 * Mark a notification read.
 *
 * Ownership is enforced by the RLS policy on notifications (recipient_id =
 * auth.uid()), so this action carries no explicit ownership check — the
 * update simply affects zero rows for anyone else.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult<null>> {
  return runAction(
    { notificationId },
    {
      schema: markNotificationReadSchema,
      handler: async ({ input }) => {
        const supabase = await createClient();
        const { error } = await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', input.notificationId)
          .is('read_at', null);

        if (error) {
          logServerError('markNotificationRead', error);
          return fail(mapPostgresError(error));
        }
        return ok(null);
      },
      revalidate: () => ['/my/notifications'],
    },
  );
}

export interface MarkAllReadResult {
  marked: number;
}

/**
 * Mark every unread notification read.
 *
 * ==========================================================================
 * NO recipientId PARAMETER, AND NO EXPLICIT WHERE CLAUSE FOR IT EITHER
 * ==========================================================================
 * The update names no recipient. It does not need to: notifications_update_own
 * restricts the rows this statement can touch to recipient_id = auth.uid(), so
 * an unqualified "clear my unread" cannot reach another member's alerts even
 * though the SQL looks like it might. This is the pattern the whole codebase
 * relies on — the absent filter is the point, not an omission (Basic Security
 * §2.2).
 *
 * `.is('read_at', null)` is not just an optimisation: without it, re-reading
 * the page would rewrite read_at on already-read rows and lose the original
 * timestamp.
 *
 * Returns the COUNT so the UI can say "4 alerts cleared" rather than guessing.
 */
export async function markAllNotificationsRead(): Promise<
  ActionResult<MarkAllReadResult>
> {
  return runAction(
    {},
    {
      schema: markAllNotificationsReadSchema,
      handler: async () => {
        const supabase = await createClient();
        const { data, error } = await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .is('read_at', null)
          .select('id');

        if (error) {
          logServerError('markAllNotificationsRead', error);
          return fail(mapPostgresError(error));
        }
        return ok({ marked: data?.length ?? 0 });
      },
      revalidate: () => ['/my/notifications'],
    },
  );
}
