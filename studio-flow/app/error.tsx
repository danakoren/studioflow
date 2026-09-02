'use client';

/**
 * app/error.tsx — route-segment error boundary. MUST be a Client Component.
 *
 * Design §7.3: a friendly message and a retry, with navigation preserved. What
 * is deliberately ABSENT is the error's message, its stack, and any database
 * detail: constraint names and SQL fragments describe the schema to an
 * attacker (Security §4.4). The full detail is already logged server-side by
 * logServerError.
 */

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest correlates this screen with the server log entry without
    // exposing anything about the failure to the user.
    console.error('Route error', error.digest);
  }, [error]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">
        Something went wrong
      </h1>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        The page couldn&rsquo;t be loaded. Trying again usually fixes it — if it
        keeps happening, let the studio know.
      </p>
      <div className="mt-4">
        <Button type="button" onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
      {error.digest ? (
        <p className="mt-3 text-xs text-slate-400">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
