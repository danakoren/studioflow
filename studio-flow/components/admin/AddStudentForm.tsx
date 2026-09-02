'use client';

/**
 * components/admin/AddStudentForm.tsx
 *
 * CLIENT COMPONENT. Front-desk account creation.
 *
 * Public sign-up was removed by product decision, so this is the ONLY way a
 * student account comes into existence. That makes it worth being explicit
 * about two things in the UI rather than leaving them for the admin to discover:
 *
 *   1. THE PASSWORD IS SHOWN ONCE, HERE, AND NEVER AGAIN. It is not emailed and
 *      it is not stored anywhere the studio can read it back — the admin has to
 *      hand it over in person or on the call. The success panel therefore
 *      repeats it, because a password typed and then navigated away from is a
 *      support ticket.
 *
 *   2. THE STUDENT MUST CHANGE IT AT FIRST LOGIN. The admin necessarily knows
 *      the password they just typed, so the account is created with
 *      must_change_password and the student is sent to /change-password before
 *      anything else opens up. Saying so on the form stops the admin promising
 *      the student a password that will stop working.
 *
 * The field values are read from FormData on submit rather than held in state,
 * so the password never sits in a React state tree across renders.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus, Check, Copy } from 'lucide-react';
import { createStudent } from '@/actions/member.actions';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';

interface CreatedStudent {
  fullName: string;
  email: string;
  /** Held only long enough for the admin to read it out. */
  password: string;
}

export function AddStudentForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<CreatedStudent | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const input = {
      fullName: String(form.get('fullName') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    };

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createStudent(input);

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      setCreated({
        fullName: result.data.fullName,
        email: result.data.email,
        // Echoed back from what was typed. The action deliberately does NOT
        // return it — a password in a server response is a password in a
        // server log the moment anyone adds request logging.
        password: input.password,
      });
      formRef.current?.reset();
      router.refresh();
    });
  }

  if (created) {
    return (
      <div className="space-y-4">
        <ActionMessage
          tone="success"
          message={`${created.fullName} can sign in now.`}
        />

        {/*
          The handover panel. Deliberately plain text and selectable — an admin
          reading this down a phone line should not be fighting a masked field.
        */}
        <dl className="rounded-lg bg-slate-50 px-3 py-3 text-sm ring-1 ring-inset ring-slate-200">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-600">Email</dt>
            <dd className="min-w-0 truncate font-medium text-slate-900">
              {created.email}
            </dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <dt className="text-slate-600">Password</dt>
            <dd className="min-w-0 truncate font-mono text-[13px] font-medium text-slate-900">
              {created.password}
            </dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Give these to {created.fullName.split(' ')[0]} now — the password is
            not shown again and is not emailed. They&rsquo;ll be asked to choose
            their own the first time they sign in.
          </span>
        </p>

        <Button
          type="button"
          variant="secondary"
          onClick={() => setCreated(null)}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add another student
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Full name"
        name="fullName"
        type="text"
        autoComplete="off"
        required
        disabled={isPending}
        errors={fieldErrors.fullName}
        placeholder="Noa Shapira"
      />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="off"
        required
        disabled={isPending}
        errors={fieldErrors.email}
        placeholder="noa@example.com"
        hint="They sign in with this. It is confirmed automatically, so there is no email for them to click."
      />

      <Field
        label="Temporary password"
        name="password"
        type="text"
        /*
         * type="text", not "password", on purpose. The admin is typing a
         * credential they must then read aloud — masking it invites a typo they
         * cannot see, for no benefit, since the person who chose it is the
         * person looking at the screen.
         *
         * autoComplete="new-password" still tells a password manager not to
         * autofill the ADMIN'S own credentials into this box.
         */
        autoComplete="new-password"
        required
        disabled={isPending}
        errors={fieldErrors.password}
        hint="At least 10 characters. Shown once so you can pass it on — they must change it at first sign-in."
      />

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Creating the account…
          </>
        ) : (
          <>
            <Check className="h-4 w-4" aria-hidden="true" />
            Create student account
          </>
        )}
      </Button>
    </form>
  );
}
