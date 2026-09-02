/**
 * components/ui/badge.tsx — Server Component.
 *
 * Tones use a DARK text step on a LIGHT tint (emerald-800 on emerald-50), never
 * white on a mid step. Two reasons:
 *
 *   1. Contrast. Every pair here clears AA comfortably — emerald-800/emerald-50
 *      is 7.29:1, rose-800/rose-50 is 7.30:1, amber-900/amber-50 is 8.75:1.
 *      White on emerald-600 is 3.77:1 and was rejected outright.
 *   2. Weight. A badge is an annotation, not a call to action. Solid saturated
 *      pills compete with the primary button and turn a dense table into a
 *      christmas tree.
 */

import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
  info: 'bg-brand-50 text-brand-800 ring-brand-200',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
