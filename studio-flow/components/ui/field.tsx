/**
 * components/ui/field.tsx
 *
 * A labelled text input with inline validation errors.
 *
 * No "use client" — like button.tsx, this is markup with no handlers. It
 * becomes part of the client bundle only because the auth forms that import it
 * are themselves Client Components.
 *
 * ==========================================================================
 * THE ACCESSIBILITY WIRING IS THE POINT
 * ==========================================================================
 * A red border is not an error message. Three attributes make a failed field
 * comprehensible to a screen-reader user, and all three are easy to omit:
 *
 *   aria-invalid        announces the field as invalid when it is focused
 *   aria-describedby    ties the message to the input, so moving focus to the
 *                       field reads the reason rather than just the label
 *   role="alert"        announces the message the moment it appears, without
 *                       waiting for focus to arrive
 *
 * Ids are derived from `name` rather than useId() so the component stays usable
 * from a Server Component. Field names are unique within a form, which is all
 * the uniqueness an id needs here.
 */

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  /** Server-returned messages for this field, from ActionFailure.fieldErrors. */
  errors?: string[];
  /** Persistent guidance, e.g. the password length rule. */
  hint?: string;
}

export function Field({
  label,
  name,
  errors,
  hint,
  className = '',
  ...props
}: FieldProps) {
  const hasErrors = Boolean(errors && errors.length > 0);
  const inputId = `field-${name}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  // Both are referenced when both exist, so the hint is not lost the moment a
  // validation error appears.
  const describedBy =
    [hint ? hintId : null, hasErrors ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-slate-900"
      >
        {label}
      </label>

      <input
        id={inputId}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy}
        className={[
          'mt-1.5 block w-full rounded-lg bg-white px-3 py-2.5 text-sm text-slate-900',
          'ring-1 ring-inset transition-shadow placeholder:text-slate-400',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          hasErrors
            ? 'ring-rose-400 focus:outline-rose-600'
            : 'ring-slate-300 focus:outline-brand-600',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          className,
        ].join(' ')}
        {...props}
      />

      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}

      {hasErrors ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-rose-700">
          {errors!.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same label / hint / error / aria wiring, for a <select>.
 *
 * Shares the id derivation and the describedby assembly with Field above so a
 * form built from both cannot end up half-wired — which is exactly what happens
 * when a select is hand-rolled next to a component that already solved this.
 */
export interface SelectFieldProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}

export function SelectField({
  label,
  name,
  errors,
  hint,
  className = '',
  children,
  ...props
}: SelectFieldProps) {
  const hasErrors = Boolean(errors && errors.length > 0);
  const inputId = `field-${name}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, hasErrors ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-900">
        {label}
      </label>

      <select
        id={inputId}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy}
        className={[
          'mt-1.5 block w-full rounded-lg bg-white px-3 py-2.5 text-sm text-slate-900',
          'ring-1 ring-inset transition-shadow',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          hasErrors
            ? 'ring-rose-400 focus:outline-rose-600'
            : 'ring-slate-300 focus:outline-brand-600',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </select>

      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {hasErrors ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-rose-700">
          {errors!.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

/** Multi-line variant, for a cancellation reason or an adjustment note. */
export interface TextareaFieldProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}

export function TextareaField({
  label,
  name,
  errors,
  hint,
  className = '',
  ...props
}: TextareaFieldProps) {
  const hasErrors = Boolean(errors && errors.length > 0);
  const inputId = `field-${name}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, hasErrors ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-900">
        {label}
      </label>

      <textarea
        id={inputId}
        name={name}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy}
        className={[
          'mt-1.5 block w-full rounded-lg bg-white px-3 py-2.5 text-sm text-slate-900',
          'ring-1 ring-inset transition-shadow placeholder:text-slate-400',
          'focus:outline focus:outline-2 focus:outline-offset-0',
          hasErrors
            ? 'ring-rose-400 focus:outline-rose-600'
            : 'ring-slate-300 focus:outline-brand-600',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          className,
        ].join(' ')}
        {...props}
      />

      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {hasErrors ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-rose-700">
          {errors!.join(' ')}
        </p>
      ) : null}
    </div>
  );
}
