/**
 * app/api/cron/finalize-attendance/route.ts — CRON ROUTE HANDLER.
 *
 * Applies BR-12 hourly: a confirmed booking whose session ended more than
 * `attendance_window_hours` ago and which the instructor never marked is
 * resolved to the studio's `unmarked_attendance_default` (which is
 * 'attended'), with `attendance_auto_resolved = true` so the no-show report
 * can still tell a real mark from a default.
 *
 * All the logic is in public.finalize_attendance() (migration 008), running
 * under row locks. This handler is an authenticated trigger and nothing more —
 * the rule belongs in the database, where a concurrent instructor marking
 * attendance at the same moment is serialised rather than raced.
 *
 * Idempotent: the function only selects rows with attendance IS NULL, so a
 * duplicate invocation resolves nothing the first one already handled.
 * Vercel may retry, and hourly runs overlap harmlessly.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest } from '@/lib/cron/authorize';
import { logServerError } from '@/lib/errors/map';

// Never prerendered, never cached: this mutates, and a cached 200 would mean
// the job silently stops running.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('finalize_attendance', {});

  if (error) {
    logServerError('cron:finalize-attendance', error);
    return NextResponse.json({ ok: false, error: 'job_failed' }, { status: 500 });
  }

  if (!data?.ok) {
    logServerError(
      'cron:finalize-attendance',
      new Error(`finalize_attendance returned ${data?.error_code ?? 'no envelope'}`),
    );
    return NextResponse.json({ ok: false, error: 'job_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    resolved_count: data.resolved_count ?? 0,
  });
}
