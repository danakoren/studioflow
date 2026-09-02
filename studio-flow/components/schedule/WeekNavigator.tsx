'use client';

/**
 * components/schedule/WeekNavigator.tsx
 *
 * CLIENT COMPONENT — but it holds NO STATE.
 *
 * The selected week lives in the URL as ?week=N, which is the state-management
 * decision from Design §6.1. Putting it in useState would make the view
 * unshareable, unbookmarkable, and lost on refresh; it would also force the
 * schedule itself to become a client component fetching its own data.
 *
 * Because the week is a search param, the SERVER re-renders the schedule for
 * the new week. This component only changes the address.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function WeekNavigator({
  weekOffset,
  rangeLabel,
}: {
  weekOffset: number;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function goToWeek(offset: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (offset === 0) params.delete('week');
    else params.set('week', String(offset));

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => goToWeek(weekOffset - 1)}
        disabled={isPending}
        aria-label="Previous week"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>

      <p
        className="text-sm font-medium text-slate-900"
        aria-live="polite"
        aria-busy={isPending}
      >
        {rangeLabel}
      </p>

      <button
        type="button"
        onClick={() => goToWeek(weekOffset + 1)}
        disabled={isPending}
        aria-label="Next week"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
