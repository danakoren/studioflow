'use client';

/**
 * components/admin/CreditForms.tsx
 *
 * CLIENT COMPONENTS. The two ways credit moves by hand.
 *
 * ==========================================================================
 * WHY THESE ARE TWO FORMS AND NOT ONE SIGNED NUMBER FIELD
 * ==========================================================================
 * A single "adjust by ±N" control would be less code and worse. They are
 * different acts with different obligations:
 *
 *   GRANT      a package the student paid for. Positive by definition, may
 *              carry an expiry, and the note is optional because the act is
 *              self-explanatory.
 *
 *   ADJUSTMENT a correction. Can be negative, cannot expire, and REQUIRES a
 *              reason — adjustCreditsSchema enforces min(3) on it. The ledger
 *              is append-only, so that sentence is the only record of intent
 *              that will ever exist for this movement.
 *
 * Collapsing them would either make the reason optional on corrections (losing
 * the audit trail that makes threat T5 defensible) or mandatory on ordinary
 * sales (friction on the commonest action).
 *
 * Neither form is optimistic. Both move money-equivalent value, and the useful
 * confirmation is the NEW BALANCE returned by the database — not a guess.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Ticket, Scale } from 'lucide-react';
import { grantCredits, adjustCredits } from '@/actions/credit.actions';
import { Button } from '@/components/ui/button';
import { Field, TextareaField } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';
import { zonedWallTimeToUtcIso } from '@/lib/time/tz';

export function GrantCreditsForm({
  studentId,
  studentName,
  studioTimeZone,
}: {
  studentId: string;
  studentName: string;
  studioTimeZone: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [balance, setBalance] = useState<number | null>(null);
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const expiryWall = String(form.get('expiresAtLocal') ?? '').trim();
    // An expiry is a DATE in the studio's zone, read at end of day so a package
    // "expiring on the 30th" is usable all of the 30th.
    const expiresAt = expiryWall
      ? zonedWallTimeToUtcIso(`${expiryWall}T23:59`, studioTimeZone)
      : null;

    setError(null);
    setFieldErrors({});

    if (expiryWall && !expiresAt) {
      setFieldErrors({ expiresAtLocal: ['Enter a valid date.'] });
      return;
    }

    startTransition(async () => {
      const note = String(form.get('note') ?? '').trim();
      const result = await grantCredits({
        studentId,
        credits: Number(String(form.get('credits') ?? '0')),
        ...(expiresAt ? { expiresAt } : {}),
        ...(note ? { note } : {}),
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setBalance(result.data.newBalance);
      router.refresh();
    });
  }

  if (balance !== null) {
    return (
      <div className="space-y-3">
        <ActionMessage
          tone="success"
          message={`Package added. ${studentName}'s balance is now ${balance}.`}
        />
        <Button type="button" variant="secondary" onClick={() => setBalance(null)}>
          Add another package
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Credits"
        name="credits"
        type="number"
        min={1}
        max={500}
        required
        defaultValue={10}
        disabled={isPending}
        errors={fieldErrors.credits}
        hint="One credit is one class."
      />

      <Field
        label="Expires on"
        name="expiresAtLocal"
        type="date"
        disabled={isPending}
        errors={fieldErrors.expiresAtLocal ?? fieldErrors.expiresAt}
        hint="Optional. Usable all day on the date you pick; leave blank for a package that never expires."
      />

      <TextareaField
        label="Note"
        name="note"
        rows={2}
        maxLength={500}
        disabled={isPending}
        errors={fieldErrors.note}
        hint="Optional. Appears on the student's own credit history."
        placeholder="10-class card, paid by card"
      />

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Adding…
          </>
        ) : (
          <>
            <Ticket className="h-4 w-4" aria-hidden="true" />
            Add package
          </>
        )}
      </Button>
    </form>
  );
}

export function AdjustCreditsForm({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [balance, setBalance] = useState<number | null>(null);
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await adjustCredits({
        studentId,
        delta: Number(String(form.get('delta') ?? '0')),
        reason: String(form.get('reason') ?? ''),
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setBalance(result.data.newBalance);
      router.refresh();
    });
  }

  if (balance !== null) {
    return (
      <div className="space-y-3">
        <ActionMessage
          tone="success"
          message={`Adjustment recorded. ${studentName}'s balance is now ${balance}.`}
        />
        <Button type="button" variant="secondary" onClick={() => setBalance(null)}>
          Make another adjustment
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Change by"
        name="delta"
        type="number"
        min={-500}
        max={500}
        required
        disabled={isPending}
        errors={fieldErrors.delta}
        hint="Negative to take credits away, positive to add them. Cannot be zero."
        placeholder="-1"
      />

      <TextareaField
        label="Reason"
        name="reason"
        rows={2}
        required
        minLength={3}
        maxLength={500}
        disabled={isPending}
        errors={fieldErrors.reason}
        hint="Required. The ledger cannot be edited or deleted afterwards, so this is the permanent record of why."
        placeholder="Refund agreed by phone after a studio closure"
      />

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" variant="secondary" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Recording…
          </>
        ) : (
          <>
            <Scale className="h-4 w-4" aria-hidden="true" />
            Record adjustment
          </>
        )}
      </Button>
    </form>
  );
}
