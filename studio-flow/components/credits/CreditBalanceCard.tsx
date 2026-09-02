/**
 * components/credits/CreditBalanceCard.tsx
 *
 * SERVER COMPONENT.
 *
 * Design principle 3: THE BALANCE IS ALWAYS VISIBLE. Visibility is not a
 * courtesy, it is the sales mechanism behind business goal G4 — students who
 * can see "1 class remaining" repurchase sooner than students who have to ask.
 *
 * The expiry warning appears only within 30 days (Design §8.2). A package
 * expiring in eight months is noise; one expiring on Friday is the reason the
 * student opened this page.
 */

import { Ticket, AlertTriangle } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { formatShortDate } from '@/lib/time/tz';
import { shouldWarnAboutExpiry } from '@/lib/domain/policy';

export function CreditBalanceCard({
  balance,
  nextExpiryAt,
  timeZone,
  nowIso,
}: {
  balance: number;
  nextExpiryAt: string | null;
  timeZone: string;
  nowIso: string;
}) {
  const warn = shouldWarnAboutExpiry(nextExpiryAt, nowIso);

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Ticket className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm text-slate-600">Class credits</p>
            <p className="text-3xl font-semibold tabular-nums text-slate-900">
              {balance}
            </p>
          </div>
        </div>

        {balance === 0 ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            You have no classes left. Contact the studio to buy a package and
            you can book again straight away.
          </p>
        ) : null}

        {warn && nextExpiryAt ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Some of your credits expire on{' '}
              <strong className="font-semibold">
                {formatShortDate(nextExpiryAt, timeZone)}
              </strong>
              . Book before then to use them.
            </span>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
