'use client';

/**
 * components/admin/SessionAdminControls.tsx
 *
 * CLIENT COMPONENTS for managing one existing class.
 *
 * ==========================================================================
 * CancelSessionDialog — WHY A REASON IS MANDATORY
 * ==========================================================================
 * cancelSessionSchema requires min(3) on the reason, and that is a product
 * decision rather than validation for its own sake: cancel_session() refunds
 * every booking and writes a notification to each student, and the reason is
 * what those students read. "Cancelled" with no explanation is how a studio
 * loses members it did not need to lose.
 *
 * The dialog states the blast radius BEFORE confirming — how many people are
 * booked and will be refunded — for the same reason CancelBookingDialog states
 * the credit consequence: nobody should discover the size of what they did
 * afterwards.
 *
 * ==========================================================================
 * RemoveBookingButton — refund is a JUDGEMENT, not a rule
 * ==========================================================================
 * adminRemoveBooking takes an explicit `refund` boolean because the system
 * cannot tell a student who phoned in sick from one who simply did not appear.
 * So the admin is asked, with both outcomes spelled out, rather than having the
 * cancellation window silently decide on their behalf.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CalendarX, UserMinus, Save } from 'lucide-react';
import {
  cancelSession,
  updateSession,
  adminRemoveBooking,
  adminBookStudent,
} from '@/actions/session.actions';
import { Button } from '@/components/ui/button';
import { Field, SelectField, TextareaField } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';
import { zonedWallTimeToUtcIso, utcIsoToZonedWallTime } from '@/lib/time/tz';
import type { Catalogue } from '@/lib/data/admin.queries';

/* -------------------------------------------------------------------------- */

export function EditSessionForm({
  sessionId,
  catalogue,
  studioTimeZone,
  current,
}: {
  sessionId: string;
  catalogue: Catalogue;
  studioTimeZone: string;
  current: {
    classTypeId: string;
    roomId: string;
    instructorId: string;
    startsAt: string;
    capacity: number;
  };
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<{ promoted: number } | null>(null);
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});
    setSaved(null);

    const wall = String(form.get('startsAtLocal') ?? '');
    const startsAt = zonedWallTimeToUtcIso(wall, studioTimeZone);
    if (!startsAt) {
      setFieldErrors({ startsAtLocal: ['Enter a valid date and time.'] });
      return;
    }

    startTransition(async () => {
      const result = await updateSession({
        sessionId,
        classTypeId: String(form.get('classTypeId') ?? ''),
        roomId: String(form.get('roomId') ?? ''),
        instructorId: String(form.get('instructorId') ?? ''),
        startsAt,
        capacity: Number(String(form.get('capacity') ?? current.capacity)),
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setSaved({ promoted: result.data.promotedFromWaitlist });
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <SelectField
        label="Class type"
        name="classTypeId"
        defaultValue={current.classTypeId}
        disabled={isPending}
        errors={fieldErrors.classTypeId}
      >
        {catalogue.classTypes.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.durationMinutes} min)
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Room"
        name="roomId"
        defaultValue={current.roomId}
        disabled={isPending}
        errors={fieldErrors.roomId}
      >
        {catalogue.rooms.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} (holds {option.capacity})
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Instructor"
        name="instructorId"
        defaultValue={current.instructorId}
        disabled={isPending}
        errors={fieldErrors.instructorId}
      >
        {catalogue.instructors.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </SelectField>

      <Field
        label="Starts at"
        name="startsAtLocal"
        type="datetime-local"
        defaultValue={utcIsoToZonedWallTime(current.startsAt, studioTimeZone)}
        disabled={isPending}
        errors={fieldErrors.startsAtLocal ?? fieldErrors.startsAt}
        hint={`In the studio's timezone (${studioTimeZone}). Moving a class does NOT notify the people already booked — tell them yourself.`}
      />

      <Field
        label="Capacity"
        name="capacity"
        type="number"
        min={1}
        max={200}
        defaultValue={current.capacity}
        disabled={isPending}
        errors={fieldErrors.capacity}
        hint="Raising this books in anyone waiting, oldest first. It cannot be set below the number already booked."
      />

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}

      {/* The promotion is a consequence for OTHER PEOPLE — a credit spent and a
          seat taken — so it is reported explicitly rather than left for the
          admin to infer from a changed roster count. */}
      {saved ? (
        <ActionMessage
          tone="success"
          message={
            saved.promoted === 0
              ? 'Class updated.'
              : saved.promoted === 1
                ? 'Class updated. 1 student was booked in from the waitlist and notified.'
                : `Class updated. ${saved.promoted} students were booked in from the waitlist and notified.`
          }
        />
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save changes
          </>
        )}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export function CancelSessionDialog({
  sessionId,
  className,
  whenLabel,
  bookedCount,
}: {
  sessionId: string;
  className: string;
  whenLabel: string;
  bookedCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ refunded: number } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  if (outcome) {
    return (
      <ActionMessage
        tone="info"
        message={
          outcome.refunded === 0
            ? 'Class cancelled. Nobody was booked, so no credits were returned.'
            : `Class cancelled. ${outcome.refunded} ${
                outcome.refunded === 1 ? 'credit was' : 'credits were'
              } returned and everyone affected has been notified.`
        }
      />
    );
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setIsOpen(true)}>
        <CalendarX className="h-4 w-4" aria-hidden="true" />
        Cancel this class
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => setIsOpen(false)}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        aria-labelledby="cancel-session-title"
        /* m-auto centres a native dialog — Tailwind's preflight zeroes the
           margin the UA stylesheet relies on. Same fix as CancelBookingDialog. */
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <form
          className="p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(
              new FormData(event.currentTarget).get('reason') ?? '',
            );
            setError(null);
            startTransition(async () => {
              const result = await cancelSession(sessionId, reason);
              if (result.ok) {
                setOutcome({ refunded: result.data.refundedCount });
                setIsOpen(false);
                router.refresh();
                return;
              }
              setError(result.message);
            });
          }}
        >
          <h2
            id="cancel-session-title"
            className="text-base font-semibold text-slate-900"
          >
            Cancel this class?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {className} · {whenLabel}
          </p>

          {/* The blast radius, stated before the button is reachable. */}
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            {bookedCount === 0 ? (
              'Nobody is booked into this class, so no credits will move.'
            ) : (
              <>
                <strong className="font-semibold">
                  {bookedCount} {bookedCount === 1 ? 'student is' : 'students are'}{' '}
                  booked in.
                </strong>{' '}
                Every one of them gets their credit back and is notified,
                regardless of how close the class is. This cannot be undone.
              </>
            )}
          </div>

          <div className="mt-4">
            <TextareaField
              label="Reason"
              name="reason"
              rows={2}
              required
              minLength={3}
              maxLength={500}
              disabled={isPending}
              hint="Sent to everyone booked in. Say what happened."
              placeholder="Instructor unwell — sorry for the short notice"
            />
          </div>

          {error ? <ActionMessage tone="error" message={error} /> : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Keep the class
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Cancelling…
                </>
              ) : (
                'Cancel and refund everyone'
              )}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function RemoveBookingButton({
  bookingId,
  studentName,
}: {
  bookingId: string;
  studentName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const router = useRouter();

  function remove(refund: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await adminRemoveBooking(bookingId, refund);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  if (!asking) {
    return (
      <div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAsking(true)}
          disabled={isPending}
        >
          <UserMinus className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Remove {studentName}</span>
          Remove
        </Button>
        {error ? <ActionMessage tone="error" message={error} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="text-xs text-slate-600">Return their credit?</p>
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="secondary"
          onClick={() => remove(true)}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Yes, refund
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => remove(false)}
          disabled={isPending}
        >
          No refund
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAsking(false)}
          disabled={isPending}
        >
          Keep
        </Button>
      </div>
      {error ? <ActionMessage tone="error" message={error} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function AddStudentForm({
  sessionId,
  students,
  isFull,
}: {
  sessionId: string;
  students: { id: string; name: string }[];
  isFull: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const router = useRouter();

  if (students.length === 0) return null;

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const studentId = String(
          new FormData(event.currentTarget).get('studentId') ?? '',
        );
        setError(null);
        setAdded(null);
        startTransition(async () => {
          const result = await adminBookStudent(sessionId, studentId);
          if (result.ok) {
            setAdded(
              students.find((s) => s.id === studentId)?.name ?? 'Student',
            );
            router.refresh();
            return;
          }
          setError(result.message);
        });
      }}
    >
      <div className="flex-1">
        <SelectField
          label="Book someone in"
          name="studentId"
          disabled={isPending}
          hint={
            isFull
              ? 'This class is full. Capacity binds admins too — the booking will be refused.'
              : 'Uses one of their credits, exactly as if they had booked it themselves.'
          }
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name}
            </option>
          ))}
        </SelectField>
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Adding…
          </>
        ) : (
          'Add'
        )}
      </Button>

      {added ? (
        <ActionMessage tone="success" message={`${added} is booked in.`} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}
    </form>
  );
}
