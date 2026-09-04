/**
 * app/api/cron/dispatch-notifications/route.ts — CRON ROUTE HANDLER.
 *
 * Drains the notification email queue. In-app notifications are already
 * visible the moment __notify() writes them; this job is only the EMAIL
 * channel, which is best-effort by design (assumption A4). A Resend outage
 * degrades delivery without losing the message.
 *
 * Flow per invocation:
 *   1. claim_pending_notifications(50) — rows with email_status 'pending' and
 *      fewer than 3 attempts, oldest first.
 *   2. Send each via the Resend REST API.
 *   3. mark_notification_email_result() per row — success marks 'sent', the
 *      third consecutive failure marks 'failed' and stops the retries.
 *
 * ==========================================================================
 * WHY IT RETURNS EARLY WHEN RESEND IS NOT CONFIGURED
 * ==========================================================================
 * This is the single most consequential decision in the file. Attempts are
 * counted, and three of them burn a notification permanently to 'failed'.
 * If the job ran against a missing or placeholder RESEND_API_KEY, then within
 * fifteen minutes every queued notification would be permanently dead — and
 * they would stay dead after the key was eventually added, because nothing
 * ever resurrects a 'failed' row.
 *
 * So an unconfigured mailer is NOT an error and NOT a failed send. It claims
 * nothing, marks nothing, and reports skipped. The queue simply waits.
 *
 * ==========================================================================
 * WHY SENDS ARE SEQUENTIAL AND PACED
 * ==========================================================================
 * Resend's default rate limit is low (2 requests/second on the free tier).
 * Firing 50 requests concurrently would earn a wall of 429s, and — because a
 * 429 is indistinguishable from a real failure once it has been recorded —
 * would burn attempts on notifications that were never actually rejected.
 * Sequential with a small delay keeps inside the limit.
 *
 * A 429 or 5xx therefore ABANDONS THE BATCH without marking anything: those
 * mean "ask again later", and the rows stay pending with their attempt count
 * untouched. Only a genuine 4xx rejection (bad address, rejected payload) is
 * recorded as an attempt.
 *
 * ==========================================================================
 * KNOWN LIMITATION (pre-existing, in the SQL)
 * ==========================================================================
 * claim_pending_notifications() selects FOR UPDATE SKIP LOCKED but does not
 * move rows to a 'sending' state, and the lock is released when the function's
 * transaction ends — i.e. before any email is sent. Two OVERLAPPING
 * invocations could therefore claim the same row and send twice. At a 5-minute
 * schedule with a job that finishes in seconds this does not arise in
 * practice; making it structurally impossible needs a 'sending' status in
 * migration 008, not a change here.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest } from '@/lib/cron/authorize';
import { logServerError } from '@/lib/errors/map';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Sequential paced sends need more than the default budget. 60s is the ceiling
// on the Hobby plan; the deadline below stops well short of it.
export const maxDuration = 60;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const PLACEHOLDER_KEY = 'your-resend-key';

/** Matches the batch size in Detailed Design §4.7. */
const BATCH_LIMIT = 50;
/** ~2 requests/second, Resend's free-tier ceiling. */
const SEND_INTERVAL_MS = 550;
/** Stop claiming new sends past this point and leave the rest for the next run. */
const DEADLINE_MS = 45_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'rejected'; error: string }
  | { kind: 'retry-later'; error: string };

async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
): Promise<SendOutcome> {
  let response: Response;

  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
  } catch (cause) {
    // Network-level failure: nothing was rejected, so do not spend an attempt.
    return { kind: 'retry-later', error: `network: ${(cause as Error).message}` };
  }

  if (response.ok) return { kind: 'sent' };

  // Body may carry a useful reason. It is recorded in last_error, which is
  // admin-visible only, and never contains the API key.
  const detail = await response.text().catch(() => '');
  const summary = `${response.status} ${detail.slice(0, 200)}`.trim();

  if (response.status === 429 || response.status >= 500) {
    return { kind: 'retry-later', error: summary };
  }

  return { kind: 'rejected', error: summary };
}

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || 'StudioFlow <onboarding@resend.dev>';

  if (!apiKey || apiKey === PLACEHOLDER_KEY) {
    // Not an error. See the header comment: claiming here would destroy the
    // queue rather than delay it.
    return NextResponse.json({
      ok: true,
      skipped: 'resend_not_configured',
      claimed: 0,
      sent: 0,
      failed: 0,
    });
  }

  const supabase = createServiceClient();

  const { data: claimed, error } = await supabase.rpc('claim_pending_notifications', {
    p_limit: BATCH_LIMIT,
  });

  if (error) {
    logServerError('cron:dispatch-notifications:claim', error);
    return NextResponse.json({ ok: false, error: 'job_failed' }, { status: 500 });
  }

  const batch = claimed ?? [];
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');

  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const [index, notification] of batch.entries()) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      // Remaining rows keep email_status 'pending' and an unchanged attempt
      // count, so the next run picks them up from the front of the queue.
      deferred = batch.length - index;
      break;
    }

    if (index > 0) await sleep(SEND_INTERVAL_MS);

    const text = siteUrl
      ? `${notification.body}\n\nView it in StudioFlow: ${siteUrl}/my/notifications`
      : notification.body;

    const outcome = await sendEmail(
      apiKey,
      from,
      notification.recipient_email,
      notification.title,
      text,
    );

    if (outcome.kind === 'retry-later') {
      // Provider is rate-limiting or down. Abandon the rest of the batch
      // WITHOUT recording attempts — every remaining row is untouched.
      logServerError('cron:dispatch-notifications:backoff', new Error(outcome.error));
      deferred = batch.length - index;
      break;
    }

    const marked = await supabase.rpc('mark_notification_email_result', {
      p_notification_id: notification.id,
      p_success: outcome.kind === 'sent',
      p_error: outcome.kind === 'rejected' ? outcome.error : null,
    });

    if (marked.error) {
      // The email may well have gone out; only the bookkeeping failed. Logged
      // rather than thrown, so one bad row cannot stall the whole queue.
      logServerError('cron:dispatch-notifications:mark', marked.error);
    }

    if (outcome.kind === 'sent') sent += 1;
    else failed += 1;
  }

  return NextResponse.json({
    ok: true,
    claimed: batch.length,
    sent,
    failed,
    deferred,
  });
}
