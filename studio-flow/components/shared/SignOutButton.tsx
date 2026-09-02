'use client';

/**
 * components/shared/SignOutButton.tsx
 *
 * CLIENT COMPONENT — and deliberately a tiny one.
 *
 * This is the "client island" pattern in miniature. RoleNav is a Server
 * Component rendering a dozen links; only this one button needs an event
 * handler, so only this one button ships JavaScript. Marking RoleNav itself
 * "use client" to get one onClick would drag the entire navigation, its icons
 * and its data-fetching into the browser bundle.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { signOut } from '@/actions/member.actions';

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
          router.replace('/schedule');
          // Discards the client-side router cache so no stale
          // authenticated markup survives the sign-out.
          router.refresh();
        })
      }
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">
        {isPending ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
