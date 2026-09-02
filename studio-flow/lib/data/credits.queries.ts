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
