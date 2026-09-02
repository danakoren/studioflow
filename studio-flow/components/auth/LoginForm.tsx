'use client';

/**
 * components/auth/LoginForm.tsx
 *
 * CLIENT COMPONENT — it owns input state and needs a submit handler.
 *
 * ==========================================================================
 * WHY useTransition AND NOT useActionState
 * ==========================================================================
 * useActionState + FormData is the canonical Next.js form pattern and would
 * give progressive enhancement. This codebase deliberately uses a different
 * one, and consistency wins: every action in actions/ takes a TYPED OBJECT and
 * returns ActionResult<T>, so a form can render `message` and `fieldErrors`
 * from one uniform shape. CancelBookingDialog, SignOutButton and the booking
 * controls are all built this way. Introducing a second convention for two
 * screens would mean two ways to read every failure.
 *
 * ==========================================================================
 * THE CLIENT DOES NOT CHOOSE WHERE IT LANDS
 * ==========================================================================
 * `redirectTo` comes back FROM the action, already sanitised by safeNextPath
 * and already accounting for the instructor password-rotation gate. This
 * component never reads ?next= itself and never builds a destination. That is
 * the whole open-redirect defence (Basic Security §4.3) — it works because the
 * decision is not made here.
 *
 * router.refresh() after the navigation is not optional. Sign-in changes which
 * rows RLS returns, but the client router cache still holds the markup rendered
 * for an anonymous visitor — including the "Sign in" nav. Without the refresh
 * the user arrives authenticated and sees a signed-out header.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { signIn } from '@/actions/auth.actions';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';

interface Props {
  /**
   * The raw ?next= value, already sanitised on the server by the page. Passed
   * back to the action so the destination survives the round trip, and used
   * only to build the "create one" link.
   */
  nextPath: string;
}

export function LoginForm({ nextPath }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Read once, here, rather than holding two pieces of controlled state.
    // Uncontrolled inputs keep this component free of per-keystroke re-renders.
    const form = new FormData(event.currentTarget);
    const input = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await signIn(input, nextPath);

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      router.replace(result.data.redirectTo);
      // Discards markup rendered for an anonymous visitor. See the header note.
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={isPending}
        errors={fieldErrors.email}
        placeholder="you@example.com"
      />

      <Field
        label="Password"
        name="password"
        type="password"
        // "current-password" tells a password manager to offer a saved
        // credential rather than to generate a new one.
        autoComplete="current-password"
        required
        disabled={isPending}
        errors={fieldErrors.password}
      />

      {/*
        Form-level Zod errors (schema .refine failures) land under _form. Without
        this they would be parsed, returned, and silently never rendered.
      */}
      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}

      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in
          </>
        )}
      </Button>

    </form>
  );
}
