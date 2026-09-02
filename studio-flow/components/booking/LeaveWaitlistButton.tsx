'use client';

/**
 * components/booking/LeaveWaitlistButton.tsx
 *
 * CLIENT COMPONENT. No confirmation dialog: leaving a waitlist costs nothing
 * and is trivially reversible by re-joining. Confirmation prompts are reserved
 * for actions with a real consequence — see CancelBookingDialog, where a
 * credit can be lost.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { leaveWaitlist } from '@/actions/booking.actions';
import { Button } from '@/components/ui/button';
import { ActionMessage } from '@/components/ui/action-message';

export function LeaveWaitlistButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await leaveWaitlist(entryId);
            if (result.ok) {
              router.refresh();
              return;
            }
            setError(result.message);
          });
        }}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <X className="h-4 w-4" aria-hidden="true" />
        )}
        Leave the waitlist
      </Button>

      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}
