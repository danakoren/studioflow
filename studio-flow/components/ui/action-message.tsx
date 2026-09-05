'use client';

/**
 * components/ui/action-message.tsx
 *
 * Inline feedback for a Server Action result.
 *
 * NO TOAST LIBRARY IS USED FOR ACTION RESULTS, and that is deliberate. Toasts
 * are the wrong control for these particular messages:
 *
 *   - "This class is full — join the waitlist?" is not transient. It is an
 *     OFFER, and business goal G1 depends on the student acting on it. A
 *     message that disappears after four seconds cannot be acted on.
 *   - "You have no classes left" needs to sit next to the disabled button that
 *     caused it, not float in a corner.
 *
 * So results render inline, next to the control. `role="alert"` on failures
 * makes a screen reader announce them immediately — satisfying Design §8.3's
 * requirement that action results reach a screen-reader user. A toast library
 * could still be added later for genuinely incidental confirmations.
 */

import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export type MessageTone = 'success' | 'error' | 'info';

const STYLES: Record<MessageTone, string> = {
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  error: 'bg-rose-50 text-rose-900 ring-rose-200',
  info: 'bg-brand-50 text-brand-900 ring-brand-200',
};

export function ActionMessage({
  tone,
  message,
  children,
}: {
  tone: MessageTone;
  message: string;
  /** Optional follow-up control, e.g. "Join the waitlist" after SESSION_FULL. */
  children?: React.ReactNode;
}) {
  const Icon =
    tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;

  return (
    <div
      // Failures interrupt; successes are announced politely.
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      // animate-rise: an inline result that appears without transition reads as
      // a layout glitch, because it also pushes the content below it down. The
      // 8px entrance ties the movement to the new element arriving.
      className={`animate-rise mt-3 flex flex-col gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${STYLES[tone]}`}
    >
      <span className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </span>
      {children}
    </div>
  );
}
