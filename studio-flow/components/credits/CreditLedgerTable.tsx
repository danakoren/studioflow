/**
 * components/credits/CreditLedgerTable.tsx
 *
 * SERVER COMPONENT.
 *
 * Each row reads as a SENTENCE, not a database record: "Booked Vinyasa Flow,
 * Tue 3 Sep, 07:00" rather than "booking  -1". The ledger is what a student
 * reads when they believe they have been charged wrongly, so it has to answer
 * the question in their own words (Design §8.2).
 *
 * The ledger is append-only, so this table is genuinely immutable history —
 * there is no edit control here because there is no UPDATE policy in the
 * database for ANY role, including the studio owner.
 */

import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatDateTime } from '@/lib/time/tz';
import { describeLedgerEntry } from '@/lib/domain/policy';
import type { LedgerEntry } from '@/lib/data/credits.queries';

export function CreditLedgerTable({
  entries,
  timeZone,
}: {
  entries: LedgerEntry[];
  timeZone: string;
}) {
  return (
    <ul className="divide-y divide-slate-200" aria-label="Credit history">
      {entries.map((entry) => {
        const positive = entry.delta > 0;
        const description = describeLedgerEntry(entry.entryType, entry.delta, {
          className: entry.className,
          when: entry.sessionStartsAt
            ? formatDateTime(entry.sessionStartsAt, timeZone)
            : null,
          note: entry.note,
        });

        return (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <span
              aria-hidden="true"
              className={[
                'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                positive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600',
              ].join(' ')}
            >
              {positive ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-900">{description}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDateTime(entry.createdAt, timeZone)}
              </p>
            </div>

            <span
              className={[
                'shrink-0 text-sm font-semibold tabular-nums',
                positive ? 'text-emerald-700' : 'text-slate-700',
              ].join(' ')}
            >
              {positive ? '+' : ''}
              {entry.delta}
              <span className="sr-only">
                {' '}
                {Math.abs(entry.delta) === 1 ? 'credit' : 'credits'}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
