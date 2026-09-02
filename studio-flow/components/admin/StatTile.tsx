/**
 * components/admin/StatTile.tsx and RateBar — SERVER COMPONENTS.
 *
 * ==========================================================================
 * WHY THESE ARE NOT CHARTS
 * ==========================================================================
 * "Active members: 9" has one value. Its job is to be READ, not compared, and
 * the correct form for a single headline figure is a large number with a label —
 * a donut showing 9-of-9, or a sparkline of one point, adds ink and removes
 * clarity. Charts start earning their place at the fill-rate breakdowns below,
 * where the job is comparing magnitudes across categories.
 *
 * ==========================================================================
 * THE COLOUR RULES THESE FOLLOW
 * ==========================================================================
 *   - RateBar is ONE HUE (indigo, the app's accent), because it encodes ONE
 *     measure — magnitude. A categorical palette here would imply the rows are
 *     different KINDS of thing rather than different amounts of the same thing.
 *   - Every bar is accompanied by its own numeric value as text, so the
 *     information is never carried by colour or length alone.
 *   - Numbers and labels wear text colours, never the mark's colour.
 *   - `tone` on StatTile is drawn from the STATUS palette (amber/rose) and is
 *     always paired with the words that say the same thing — "12 with no
 *     credits" reads correctly in greyscale, to a colourblind viewer, and to a
 *     screen reader.
 */

import type { ReactNode } from 'react';
import { Card, CardBody } from '@/components/ui/card';

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  /** Status only — never used to distinguish one series from another. */
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const valueTone =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-900';

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-600">{label}</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}
            >
              {value}
            </p>
            {hint ? (
              <p className="mt-1 text-xs text-slate-500">{hint}</p>
            ) : null}
          </div>
          {icon ? (
            <span className="shrink-0 text-slate-400" aria-hidden="true">
              {icon}
            </span>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * A proportion meter for one row of a breakdown table.
 *
 * `value` is 0..1 or null. Null means "not computable" (no capacity in the
 * window) and renders as an em dash rather than as a 0% bar — an empty bar
 * claims a real measurement of zero, which is a different and false statement.
 *
 * The track is a recessive slate; the fill is the single accent hue with a
 * rounded data-end. The numeric percentage sits beside it in text colour.
 */
export function RateBar({
  value,
  label,
}: {
  value: number | null;
  /** Accessible description, e.g. "Fill rate for Vinyasa Flow". */
  label: string;
}) {
  if (value === null) {
    return (
      <span className="text-slate-400" aria-label={`${label}: not available`}>
        —
      </span>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <span className="flex items-center justify-end gap-2">
      <span
        className="hidden h-2 w-24 overflow-hidden rounded-full bg-slate-200 sm:block"
        role="img"
        aria-label={`${label}: ${pct}%`}
      >
        <span
          className="block h-full rounded-full bg-brand-600"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums text-slate-900">{pct}%</span>
    </span>
  );
}
