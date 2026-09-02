'use client';

/**
 * components/booking/WaitlistButton.tsx
 *
 * CLIENT COMPONENT. Joining a waitlist consumes NO credit — an entry is a
 * claim, not a booking — so the copy says so plainly. A student who thinks
 * waiting costs a class will not wait.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ListPlus } from 'lucide-react';
import { joinWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function WaitlistButton({ sessionId }: { sessionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        disabled={isPending}
        className="w-full"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await joinWaitlist(sessionId);
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.message);
          });
        }}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Joining…
          </>
        ) : (
          <>
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Join the waitlist
          </>
        )}
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
