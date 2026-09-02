'use client';

/**
 * components/admin/SessionForm.tsx
 *
 * CLIENT COMPONENT. Creates one class, or N weekly repeats.
 *
 * ==========================================================================
 * THE TIMEZONE CONVERSION IS THE IMPORTANT LINE
 * ==========================================================================
 * The <input type="datetime-local"> yields a wall-clock string with no zone.
 * It is converted with zonedWallTimeToUtcIso(value, studioTimeZone) — the
 * STUDIO'S zone, never the browser's. An owner scheduling their Jerusalem
 * studio from a laptop set to London would otherwise create every class two
 * hours late, and the mistake is invisible until a student turns up. See the
 * note on that function and tests/unit/tz.test.ts.
 *
 * ==========================================================================
 * CONFLICTS ARE NOT PRE-CHECKED HERE
 * ==========================================================================
 * Double-booking a room or an instructor is caught by the GiST exclusion
 * constraints in migration 003 and surfaces as ROOM_CONFLICT /
 * INSTRUCTOR_CONFLICT. A client-side pre-check would have a race window between
 * looking and inserting; the constraint has none. So this form submits
 * optimistically and renders whichever conflict the database reports.
 *
 * ==========================================================================
 * PARTIAL SUCCESS IS A REAL OUTCOME FOR A REPEAT
 * ==========================================================================
 * create_recurring_sessions() creates the weeks it can and reports the dates it
 * could not. "10 of 12 created, weeks 3 and 7 clashed" is the truth, and
 * collapsing it to a red error would throw away ten real classes.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CalendarPlus } from 'lucide-react';
import {
  createSession,
  createRecurringSessions,
  type RecurrenceConflict,
} from '@/actions/session.actions';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';
import { zonedWallTimeToUtcIso, utcIsoToZonedWallTime } from '@/lib/time/tz';
import type { Catalogue } from '@/lib/data/admin.queries';

export function SessionForm({
  catalogue,
  studioTimeZone,
  defaultStartsAtIso,
}: {
  catalogue: Catalogue;
  studioTimeZone: string;
  /** Seeds the picker with a sensible near-future slot. */
  defaultStartsAtIso: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [repeat, setRepeat] = useState(false);
  const [conflicts, setConflicts] = useState<RecurrenceConflict[] | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const router = useRouter();

  const noCatalogue =
    catalogue.classTypes.length === 0 ||
    catalogue.rooms.length === 0 ||
    catalogue.instructors.length === 0;

  if (noCatalogue) {
    return (
      <ActionMessage
        tone="info"
        message="A class needs at least one class type, one room and one instructor before it can be scheduled. Those are managed in the database for now — see the note on the schedule page."
      />
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const wallTime = String(form.get('startsAtLocal') ?? '');
    const startsAt = zonedWallTimeToUtcIso(wallTime, studioTimeZone);

    setError(null);
    setFieldErrors({});
    setConflicts(null);

    if (!startsAt) {
      setFieldErrors({ startsAtLocal: ['Enter a valid date and time.'] });
      return;
    }

    const capacityRaw = String(form.get('capacity') ?? '').trim();
    const base = {
      classTypeId: String(form.get('classTypeId') ?? ''),
      roomId: String(form.get('roomId') ?? ''),
      instructorId: String(form.get('instructorId') ?? ''),
      startsAt,
      // Omitted rather than null when blank, so the action falls back to the
      // room's capacity instead of writing an explicit empty override.
      ...(capacityRaw ? { capacity: Number(capacityRaw) } : {}),
    };

    startTransition(async () => {
      if (repeat) {
        const weeks = Number(String(form.get('weeks') ?? '1'));
        const result = await createRecurringSessions({ ...base, weeks });

        if (!result.ok) {
          setError(result.message);
          setFieldErrors(result.fieldErrors ?? {});
          return;
        }
        setCreated(result.data.createdCount);
        setConflicts(result.data.conflicts);
        router.refresh();
        return;
      }

      const result = await createSession(base);
      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      // One class created — go look at it.
      router.push(`/admin/sessions/${result.data.sessionId}`);
      router.refresh();
    });
  }

  // Repeat outcome, reported rather than redirected away from.
  if (created !== null) {
    return (
      <div className="space-y-4">
        <ActionMessage
          tone={conflicts && conflicts.length > 0 ? 'info' : 'success'}
          message={
            created === 1
              ? '1 class created.'
              : `${created} classes created.`
          }
        />

        {conflicts && conflicts.length > 0 ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <p className="font-semibold">
              {conflicts.length === 1
                ? '1 week was skipped'
                : `${conflicts.length} weeks were skipped`}
            </p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5">
              {conflicts.map((conflict) => (
                <li key={conflict.startsAt}>
                  {utcIsoToZonedWallTime(conflict.startsAt, studioTimeZone).replace(
                    'T',
                    ' at ',
                  )}{' '}
                  — {conflict.reason}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              The other weeks were created. Add the skipped ones individually
              once the clash is resolved.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={() => router.push('/admin/schedule')}>
            See the schedule
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setConflicts(null);
            }}
          >
            Add another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <SelectField
        label="Class type"
        name="classTypeId"
        required
        disabled={isPending}
        errors={fieldErrors.classTypeId}
        hint="Sets the duration."
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
        required
        disabled={isPending}
        errors={fieldErrors.roomId}
        hint="Capacity defaults to the room's unless you override it below."
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
        required
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
        required
        disabled={isPending}
        defaultValue={utcIsoToZonedWallTime(defaultStartsAtIso, studioTimeZone)}
        errors={fieldErrors.startsAtLocal ?? fieldErrors.startsAt}
        hint={`Entered in the studio's timezone (${studioTimeZone}).`}
      />

      <Field
        label="Capacity override"
        name="capacity"
        type="number"
        min={1}
        max={200}
        disabled={isPending}
        errors={fieldErrors.capacity}
        hint="Leave blank to use the room's capacity. Copied at creation, so changing the room later will not resize this class."
      />

      {/* Weekly repeat. Checkbox rather than a second form, because every other
          field means the same thing either way. */}
      <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-inset ring-slate-200">
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(event) => setRepeat(event.target.checked)}
            disabled={isPending}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          Repeat weekly
        </label>

        {repeat ? (
          <div className="mt-3">
            <SelectField
              label="For how many weeks"
              name="weeks"
              defaultValue="4"
              disabled={isPending}
              errors={fieldErrors.weeks}
              hint="Each week becomes its own class, independently editable."
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'week' : 'weeks'}
                </option>
              ))}
            </SelectField>
          </div>
        ) : null}
      </div>

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Creating…
          </>
        ) : (
          <>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            {repeat ? 'Create the series' : 'Create the class'}
          </>
        )}
      </Button>
    </form>
  );
}
