/**
 * app/api/cron/expire-credits/route.ts — CRON ROUTE HANDLER.
 *
 * Applies BR-13 nightly. A grant past its `expires_at` with credits unused
 * gets a compensating negative ledger entry typed 'expiry', then drops to
 * credits_remaining = 0 / status = 'expired'.
 *
 * The compensating-entry design (Architecture §199) is what keeps a balance a
 * plain SUM over the ledger instead of a query that must know today's date and
 * every grant's expiry. It also leaves the student a dated, plain-language line
 * saying exactly where their credits went, which a read-time filter cannot.
 *
 * TWO jobs run here, in this order:
 *
 *   1. notify_expiring_credits() — the courtesy warning for grants lapsing
 *      within seven days. It must run BEFORE the expiry sweep: afterwards
 *      those grants are already 'expired' and no longer match its predicate,
 *      so warnings for anything expiring today would be lost.
 *   2. expire_credits() — the sweep itself.
 *
 * (§4.7 of the design lists only the sweep for this route. The warning
 * function exists in migration 008, is granted to service_role, and otherwise
 * has no caller anywhere in the app — so it would be dead SQL. Delete the
 * first block if you want the route to match the table literally.)
 *
 * Both are idempotent: the warning skips grants that already have a matching
 * notification, and the sweep only selects status = 'active'.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest } from '@/lib/cron/authorize';
import { logServerError } from '@/lib/errors/map';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = createServiceClient();

  // Step 1 — warn. A failure here is logged but does NOT abort the sweep:
  // BR-13 is the rule with financial consequence, and skipping it because a
  // courtesy notification failed would be the wrong trade.
  let notifiedCount = 0;
  const warned = await supabase.rpc('notify_expiring_credits', {});

  if (warned.error || !warned.data?.ok) {
    logServerError(
      'cron:expire-credits:notify',
      warned.error ??
        new Error(`notify_expiring_credits returned ${warned.data?.error_code ?? 'no envelope'}`),
    );
  } else {
    notifiedCount = warned.data.notified_count ?? 0;
  }

  // Step 2 — expire.
  const { data, error } = await supabase.rpc('expire_credits', {});

  if (error) {
    logServerError('cron:expire-credits', error);
    return NextResponse.json({ ok: false, error: 'job_failed' }, { status: 500 });
  }

  if (!data?.ok) {
    logServerError(
      'cron:expire-credits',
      new Error(`expire_credits returned ${data?.error_code ?? 'no envelope'}`),
    );
    return NextResponse.json({ ok: false, error: 'job_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    notified_count: notifiedCount,
    grants_expired: data.grants_expired ?? 0,
    credits_expired: data.credits_expired ?? 0,
  });
}
