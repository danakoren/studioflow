'use client';

/**
 * components/feedback/CreditSpentToast.tsx
 *
 * CLIENT COMPONENT, mounted once in the root layout.
 *
 * ==========================================================================
 * WHY THIS IS NOT A PANEL INSIDE BookButton
 * ==========================================================================
 * It was, first, and it never painted. The reason is worth recording.
 *
 * bookSession() calls revalidatePath(), so Next re-renders the route as soon as
 * the Server Action returns — no router.refresh() involved. BookingPanel then
 * re-renders, sees the viewer now HAS a booking, takes its "already booked"
 * branch, and UNMOUNTS BookButton together with anything it was rendering.
 * Deferring the refresh does not help: the re-render is the action's own doing.
 *
 * So feedback that must OUTLIVE the action cannot live in the subtree the
 * action changes. This lives in the root layout, which no route transition
 * unmounts.
 *
 * ==========================================================================
 * A MODULE-LEVEL EMITTER, NOT CONTEXT AND NOT sessionStorage
 * ==========================================================================
 * The button and the toast have no common React ancestor that survives the
 * re-render, so they need a channel outside the tree.
 *
 *   NOT context   — a provider would have to wrap the app, and the value would
 *                   be re-created by the very re-render we are trying to
 *                   survive.
 *   NOT storage   — sessionStorage tempts you into reading it during render or
 *                   in an effect body. Reading in `useState` breaks hydration
 *                   (the server has no sessionStorage); reading in an effect and
 *                   calling setState synchronously is the cascading-render
 *                   pattern React now lints against. It also introduces a
 *                   staleness window that needs its own timestamp guard.
 *   THIS          — one module variable plus a listener set. The module is not
 *                   re-evaluated by an RSC re-render, so the message survives
 *                   exactly as long as it needs to, and the toast learns about
 *                   it through a SUBSCRIPTION CALLBACK, which is the pattern
 *                   effects are actually for.
 *
 * The numbers are the database's: `to` is book_session()'s new_balance,
 * computed in the same transaction that took the seat. Nothing here is a local
 * decrement, so it cannot disagree with /my/credits.
 */

import { useEffect, useState } from 'react';
import { Ticket, ArrowRight, X } from 'lucide-react';

export interface CreditSpentPayload {
  /** Balance before the spend. */
  from: number;
  /** Balance after, straight from the action. */
  to: number;
  /** What it was spent on, e.g. "Reformer Pilates". */
  label?: string;
}

/* -------------------------------------------------------------------------- */
/* The channel                                                                */
/* -------------------------------------------------------------------------- */

type Listener = (payload: CreditSpentPayload) => void;
const listeners = new Set<Listener>();

/**
 * Announce a spend. Called by the booking button immediately before the route
 * re-render unmounts it.
 *
 * Fire-and-forget: with no toast mounted the message is simply dropped, which
 * is the right outcome — the booking already succeeded and the receipt is a
 * flourish, never a confirmation the user depends on.
 */
export function announceCreditSpent(payload: CreditSpentPayload) {
  for (const listener of listeners) listener(payload);
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */

export function CreditSpentToast() {
  const [payload, setPayload] = useState<CreditSpentPayload | null>(null);

  // Subscribe on mount. setState happens in the CALLBACK, when the external
  // source changes — not synchronously in the effect body.
  useEffect(() => subscribe(setPayload), []);

  // Auto-dismiss: long enough to read, short enough not to sit over the UI.
  useEffect(() => {
    if (!payload) return;
    const timer = setTimeout(() => setPayload(null), 5200);
    return () => clearTimeout(timer);
  }, [payload]);

  if (!payload) return null;

  return (
    <div
      /*
       * Fixed, above the sticky header, and pointer-events-none on the WRAPPER
       * so a full-width overlay can never swallow a tap aimed at the page
       * beneath it. The card re-enables pointer events for itself.
       */
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      <div className="animate-pop pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-2xl bg-slate-900 py-3 pl-4 pr-3 shadow-xl ring-1 ring-white/10">
        {/* One light sweep, once — not an idle loop, which would be noise. */}
        <span
          aria-hidden="true"
          className="animate-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
        />

        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20">
          {/* One expanding ring. Draws the eye without moving any layout. */}
          <span
            aria-hidden="true"
            className="animate-pulse-ring absolute inset-0 rounded-full bg-brand-400"
          />
          <Ticket
            className="relative h-4 w-4 text-brand-200"
            aria-hidden="true"
          />
        </span>

        <div className="relative min-w-0">
          <p className="text-sm font-medium text-white">
            {payload.label ? `Booked ${payload.label}` : 'Class booked'}
          </p>

          {/* The screen reader gets a sentence; sighted users get the
              arithmetic. Announcing "12 arrow 11" would be meaningless. */}
          <span className="sr-only">
            1 credit used. {payload.to}{' '}
            {payload.to === 1 ? 'credit' : 'credits'} remaining.
          </span>
          <p
            aria-hidden="true"
            className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-300"
          >
            <span className="tabular-nums line-through opacity-60">
              {payload.from}
            </span>
            <ArrowRight className="h-3 w-3" />
            <span className="animate-count-up text-sm font-semibold tabular-nums text-white">
              {payload.to}
            </span>
            <span>{payload.to === 1 ? 'credit left' : 'credits left'}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setPayload(null)}
          className="relative ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  );
}
