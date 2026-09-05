'use client';

/**
 * components/auth/ChangePasswordForm.tsx
 *
 * CLIENT COMPONENT. Terminates the temporary-password flow from Basic Security
 * §1.6: an instructor whose account was created by an admin arrives here on
 * first login and cannot reach anything else until they rotate the credential
 * they were handed verbally.
 *
 * It calls the EXISTING changePassword action, which does two things in order —
 * updates the password through Supabase Auth, then clears
 * studio_members.must_change_password via complete_password_rotation(). That
 * flag is cleared by a SECURITY DEFINER function rather than a direct update
 * because studio_members has no self-update policy at all: granting one would
 * let any member set their own role to 'admin'.
 *
 * Changing a password also invalidates every OTHER session for the account
 * (Basic Security §1.7), so anyone who was handed the temporary password
 * out-of-band loses access at this moment. That is the point of the flow.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, KeyRound } from 'lucide-react';
import { changePassword } from '@/actions/member.actions';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';

interface Props {
  /** Where to go once rotation succeeds. Sanitised server-side. */
  nextPath: string;
}

export function ChangePasswordForm({ nextPath }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const input = {
      newPassword: String(form.get('newPassword') ?? ''),
      confirmPassword: String(form.get('confirmPassword') ?? ''),
    };

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await changePassword(input);

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      router.replace(nextPath || '/schedule');
      // must_change_password has just changed server-side, and the layout that
      // redirected here reads it. Without this refresh the cached redirect
      // would send the user straight back to this form.
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        disabled={isPending}
        errors={fieldErrors.newPassword}
        hint="At least 10 characters. Longer is better than more symbols."
      />

      <Field
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        disabled={isPending}
        // The schema reports a mismatch on confirmPassword via .refine's path.
        errors={fieldErrors.confirmPassword}
      />

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}

      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Set new password
          </>
        )}
      </Button>

      <p className="text-xs text-slate-500">
        Setting a new password signs out any other device using your old one.
      </p>
    </form>
  );
}
