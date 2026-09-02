import { redirect } from 'next/navigation';
import { CreditBalanceCard } from '@/components/credits/CreditBalanceCard';
import { CreditLedgerTable } from '@/components/credits/CreditLedgerTable';
import { LedgerPager } from '@/components/credits/LedgerPager';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { EmptyTicketArt } from '@/components/ui/illustrations';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { getBalance, getLedgerPage } from '@/lib/data/credits.queries';

/**
 * app/my/credits/page.tsx — SERVER COMPONENT.
 *
 * ==========================================================================
 * PAGINATION IS KEYSET, NOT OFFSET
 * ==========================================================================
 * The cursor is (created_at, id), carried in the URL. Two reasons, from
 * Basic Scaling §4.3:
 *
 *   1. Constant cost at any depth. OFFSET 500 makes Postgres scan and discard
 *      500 rows to return 25.
 *   2. Stability under concurrent inserts. Offset pagination can show a row
 *      twice, or skip one, when a new entry arrives while the student is
 *      browsing. On a FINANCIAL record that is not a cosmetic glitch — "the
 *      same charge appears twice" is a support ticket and a trust problem.
 *
 * The id is the tiebreaker because a booking deduction and its refund can
 * share a created_at to the microsecond, which would leave a timestamp-only
 * cursor ambiguous.
 *
 * ==========================================================================
 * AUTHORISATION
 * ==========================================================================
 * The redirect below is a UX affordance, not the security boundary. Every
 * query on this page reads as the calling user, and the RLS policies
 * credit_ledger_select_own / credit_grants_select_own restrict rows to
 * student_id = auth.uid(). A student cannot see another student's ledger even
 * by crafting a direct PostgREST request with their own JWT (tests PR-12,
 * PR-13).
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My credits — StudioFlow',
};

const PAGE_SIZE = 25;

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursorAt?: string; cursorId?: string }>;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/my/credits');

  const membership = await getMembership();
  const timeZone = membership?.timezone ?? 'Asia/Jerusalem';
  const nowIso = new Date().toISOString();

  const params = await searchParams;
  const cursor = parseCursor(params.cursorAt, params.cursorId);

  // Independent reads, issued in parallel: the balance does not depend on the
  // ledger page, so awaiting them in sequence would double the latency.
  const [balance, ledger] = await Promise.all([
    getBalance(user.id),
    getLedgerPage(user.id, cursor, PAGE_SIZE),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          My credits
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Every credit added, used, returned or expired — in order.
        </p>
      </header>

      <CreditBalanceCard
        balance={balance.balance}
        nextExpiryAt={balance.nextExpiryAt}
        timeZone={timeZone}
        nowIso={nowIso}
      />

      <Card>
        <CardHeader
          title="History"
          description="This record cannot be edited or deleted — by anyone, including the studio."
        />

        {ledger.entries.length === 0 ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              art={<EmptyTicketArt className="h-full w-full" />}
              title="Nothing here yet"
              description="Once the studio adds a class package, every credit movement will be listed here."
            />
          </div>
        ) : (
          <>
            <CreditLedgerTable entries={ledger.entries} timeZone={timeZone} />
            <LedgerPager
              nextCursor={ledger.nextCursor}
              hasCursor={cursor !== null}
            />
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * A malformed or hand-edited cursor degrades to "start from the beginning"
 * rather than erroring. The values also reach a query, so they are validated
 * for shape before use rather than trusted from the address bar.
 */
function parseCursor(
  cursorAt: string | undefined,
  cursorId: string | undefined,
): { createdAt: string; id: string } | null {
  if (!cursorAt || !cursorId) return null;

  const timestamp = Date.parse(cursorAt);
  if (Number.isNaN(timestamp)) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cursorId,
    );
  if (!isUuid) return null;

  return { createdAt: new Date(timestamp).toISOString(), id: cursorId };
}
