import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

/** app/not-found.tsx — Server Component. Always offers a way back. */
export default function NotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        We couldn&rsquo;t find that
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        The class may have been cancelled, or the link may be out of date.
      </p>
      <Link
        href="/schedule"
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        Back to the schedule
      </Link>
    </div>
  );
}
