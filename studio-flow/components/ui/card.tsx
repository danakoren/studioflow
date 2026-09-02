/** components/ui/card.tsx — Server Components. Layout only. */

import type { ReactNode } from 'react';

/**
 * ==========================================================================
 * A HAIRLINE RING, NOT A BORDER
 * ==========================================================================
 * `ring-1 ring-slate-200/70` instead of `border`: a ring draws OUTSIDE the box
 * and so does not participate in layout, which means nesting a card inside a
 * card never shifts content by a pixel per level. The 70% alpha keeps the edge
 * from competing with the text — at full opacity a grid of cards reads as a
 * wireframe.
 *
 * Elevation comes from --shadow-sm (two stacked shadows: a tight contact
 * shadow plus a wide diffuse one). One large blur reads as a grey smudge.
 */
export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Set on a card that is itself a link or button. Adds the hover lift.
   *
   * Deliberately opt-in: a lift on a card that does nothing when clicked is a
   * promise the interface cannot keep, and users learn to distrust the cue.
   */
  interactive?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70',
        interactive
          ? [
              'transition-[transform,box-shadow] duration-200',
              'ease-[var(--ease-out-soft)]',
              // 2px. Enough to register as "this responds", small enough that a
              // list of them does not appear to wobble as the cursor crosses it.
              'hover:-translate-y-0.5 hover:shadow-md',
              // Presses back down — the same tactile logic as Button.
              'active:translate-y-0 active:shadow-sm',
            ].join(' ')
          : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  // Padding steps up on larger screens: 16px is right when it is most of the
  // viewport width, and looks cramped once the card is 700px wide.
  return <div className={`p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-slate-200/80 p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
