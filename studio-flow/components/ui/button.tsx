/**
 * components/ui/button.tsx
 *
 * SERVER COMPONENT. No "use client" — a <button> with no handler needs no
 * JavaScript. Client behaviour is added by the caller wrapping it, not by
 * making every button in the app a client component.
 *
 * Written by hand rather than pulled from shadcn's CLI, which matches the
 * approach in Architecture §6.3: components are copied into the repository so
 * they are readable, modifiable and explainable. Dropping in real shadcn/ui
 * later needs no call-site changes, since the prop shape is the same.
 */

import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // shadow-xs plus a hover lift to shadow-sm: enough to read as raised without
  // the drop-shadow look of an early-2010s button.
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 hover:shadow-sm focus-visible:outline-brand-600',
  secondary:
    'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 shadow-xs hover:bg-slate-50 hover:ring-slate-400 focus-visible:outline-slate-600',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-600',
  destructive:
    'bg-rose-600 text-white shadow-xs hover:bg-rose-700 hover:shadow-sm focus-visible:outline-rose-600',
};

const SIZES: Record<Size, string> = {
  // min-h-11 is 44px: the minimum touch target from Design §8.3. Students book
  // on a phone, in a hurry, often already in the studio doorway.
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        /*
         * THE PRESS IS THE IMPORTANT INTERACTION.
         *
         * The micro-interaction budget for a button is spent on :active rather
         * than :hover, because this product is used on a phone and THERE IS NO
         * HOVER on touch. A hover style gives a touch user no feedback at all;
         * :active fires for pointer and touch alike.
         *
         * 3%, not 10%. Heavy scaling on a 44px control reads as a novelty;
         * 3% reads as the surface giving slightly under a finger.
         *
         * The transition names its properties instead of using `all`, which
         * animates things you did not intend — including layout-affecting ones
         * — and is a reliable source of jank.
         */
        'transition-[transform,background-color,box-shadow,color] duration-150',
        'ease-[var(--ease-out-soft)] active:scale-[0.97]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        // A disabled control must not depress: depressing and then doing
        // nothing is a lie about what happened.
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        // Stops the label being selected on a double-tap, which on iOS pops the
        // text-selection handles over the control.
        'select-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
