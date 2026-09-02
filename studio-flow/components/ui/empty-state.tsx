/**
 * components/ui/empty-state.tsx — Server Component.
 *
 * Design principle 4: empty states TEACH. A studio with no classes yet shows
 * the admin how to create one; a student with no bookings is pointed at the
 * schedule. A blank panel tells a new user their software is broken.
 *
 * ==========================================================================
 * `art` VS `icon`
 * ==========================================================================
 * Both are supported, and they are not the same thing:
 *
 *   art   a 96×96 spot illustration from components/ui/illustrations.tsx.
 *         Preferred for a WHOLE-PAGE or whole-panel empty state, where there
 *         is room for it and the screen would otherwise be bare.
 *
 *   icon  a lucide glyph. Correct inside a small panel, where an illustration
 *         would dominate a card that is only 200px tall.
 *
 * `art` wins when both are passed. Existing call sites pass `icon` and keep
 * working unchanged — this is additive.
 *
 * The illustration is decoration: it is aria-hidden inside illustrations.tsx,
 * and the heading plus description carry the entire meaning for a screen
 * reader.
 */

import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  art,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  /** A spot illustration. Takes precedence over `icon`. */
  art?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center rounded-xl text-center',
        /*
         * CAPPED AND CENTRED, not full-bleed.
         *
         * This used to stretch the whole content column — a ~990px dashed box
         * around a 96px drawing, which reads as a rendering fault rather than a
         * designed empty state. The complaint was "massive blank space", and the
         * blank space was the BOX, not the illustration. Capping the panel puts
         * the art, heading and sentence into one legible group.
         */
        'mx-auto w-full max-w-md',
        // A dashed border says "this is a container awaiting content" rather
        // than "this is a card with content in it".
        'border border-dashed border-slate-300',
        // A faint vertical wash instead of a flat fill: it separates the empty
        // area from the card it sits in without adding another hard edge.
        'bg-gradient-to-b from-white to-slate-50/80',
        art ? 'px-6 py-10 sm:py-12' : 'px-6 py-10',
        // Entrance, so a page that resolves to empty does not flash a bare box.
        'animate-rise',
      ].join(' ')}
    >
      {art ? (
        /*
         * The art is a single hue driven entirely by currentColor, so this one
         * class tints the whole drawing. brand-500 rather than the previous
         * slate-400: at 80px the slate strokes were so pale they read as a
         * rendering fault rather than a deliberately light illustration.
         *
         * Note the failure mode if this class ever goes missing from the build:
         * currentColor falls back to the inherited body colour (slate-900), so
         * the drawing goes DARK — visible and obviously unstyled — rather than
         * vanishing. That is the whole reason illustrations.tsx paints with
         * currentColor instead of its own fill-* utilities.
         */
        <div className="mb-4 h-24 w-24 text-brand-500 sm:h-28 sm:w-28">
          {art}
        </div>
      ) : icon ? (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {icon}
        </div>
      ) : null}

      <h3 className="text-base font-semibold tracking-tight text-slate-900">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-600">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
