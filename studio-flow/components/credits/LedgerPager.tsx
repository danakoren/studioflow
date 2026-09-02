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
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-50"
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
