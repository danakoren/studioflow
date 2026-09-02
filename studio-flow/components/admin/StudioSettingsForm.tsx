'use client';

/**
 * components/admin/StudioSettingsForm.tsx
 *
 * CLIENT COMPONENT. The studio's business rules.
 *
 * ==========================================================================
 * THIS FORM IS THE REASON NO POLICY CONSTANT IS HARD-CODED
 * ==========================================================================
 * Every value here is read at decision time by the Postgres functions —
 * cancel_booking() reads cancellation_window_hours, the promotion path reads
 * promotion_cutoff_hours, mark_attendance() reads attendance_window_hours. A
 * studio changing its cancellation window is a DATA change, not a deployment
 * (Product Spec: "no policy constant is hard-coded in application code").
 *
 * The consequence of each field is spelled out in its hint, because these are
 * not preferences — they change what happens to other people's money. An owner
 * who shortens the cancellation window is deciding that more students will
 * forfeit credits, and should read that sentence before saving.
 *
 * The cross-field rule (promotion cutoff <= cancellation window) is enforced by
 * updateStudioSettingsSchema's .refine and reported on promotionCutoffHours via
 * its `path`, so it lands on the field the owner should change.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { updateStudioSettings } from '@/actions/studio.actions';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { ActionMessage } from '@/components/ui/action-message';

export interface StudioSettingsValues {
  name: string;
  timezone: string;
  cancellationWindowHours: number;
  promotionCutoffHours: number;
  attendanceWindowHours: number;
  unmarkedAttendanceDefault: 'attended' | 'absent';
}

export function StudioSettingsForm({
  current,
}: {
  current: StudioSettingsValues;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});
    setSaved(false);

    startTransition(async () => {
      const result = await updateStudioSettings({
        name: String(form.get('name') ?? ''),
        timezone: String(form.get('timezone') ?? ''),
        cancellationWindowHours: Number(form.get('cancellationWindowHours') ?? 0),
        promotionCutoffHours: Number(form.get('promotionCutoffHours') ?? 0),
        attendanceWindowHours: Number(form.get('attendanceWindowHours') ?? 0),
        unmarkedAttendanceDefault: String(
          form.get('unmarkedAttendanceDefault') ?? 'attended',
        ) as 'attended' | 'absent',
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setSaved(true);
      // These values are read by every other page, so discard the router cache.
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Studio name"
        name="name"
        required
        defaultValue={current.name}
        disabled={isPending}
        errors={fieldErrors.name}
      />

      <Field
        label="Timezone"
        name="timezone"
        required
        defaultValue={current.timezone}
        disabled={isPending}
        errors={fieldErrors.timezone}
        hint="An IANA name such as Asia/Jerusalem. Every class time in the product is stored in UTC and displayed in this zone."
      />

      <Field
        label="Cancellation window (hours)"
        name="cancellationWindowHours"
        type="number"
        min={0}
        max={168}
        required
        defaultValue={current.cancellationWindowHours}
        disabled={isPending}
        errors={fieldErrors.cancellationWindowHours}
        hint="Cancel at or before this many hours and the credit comes back. Cancel later and it does not. Lowering this means students forfeit credits more often."
      />

      <Field
        label="Waitlist promotion cutoff (hours)"
        name="promotionCutoffHours"
        type="number"
        min={0}
        max={48}
        required
        defaultValue={current.promotionCutoffHours}
        disabled={isPending}
        errors={fieldErrors.promotionCutoffHours}
        hint="Inside this many hours of the start, a freed seat is not filled automatically — too close for the next person to see the message and get here."
      />

      <Field
        label="Attendance window (hours after a class ends)"
        name="attendanceWindowHours"
        type="number"
        min={1}
        max={168}
        required
        defaultValue={current.attendanceWindowHours}
        disabled={isPending}
        errors={fieldErrors.attendanceWindowHours}
        hint="How long an instructor has to mark the register. After this it locks and the default below is applied automatically."
      />

      <SelectField
        label="Unmarked attendance counts as"
        name="unmarkedAttendanceDefault"
        defaultValue={current.unmarkedAttendanceDefault}
        disabled={isPending}
        errors={fieldErrors.unmarkedAttendanceDefault}
        hint="Applied when an instructor never marks a register. 'Attended' errs in the student's favour — 'absent' would take credits from people who came, because of an instructor's oversight."
      >
        <option value="attended">Attended (recommended)</option>
        <option value="absent">Absent</option>
      </SelectField>

      {fieldErrors._form ? (
        <ActionMessage tone="error" message={fieldErrors._form.join(' ')} />
      ) : null}
      {error ? <ActionMessage tone="error" message={error} /> : null}
      {saved ? (
        <ActionMessage
          tone="success"
          message="Saved. The new rules apply to every decision from now on; bookings already made are unaffected."
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
            Save settings
          </>
        )}
      </Button>
    </form>
  );
}
