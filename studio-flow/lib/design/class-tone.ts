/**
 * lib/design/class-tone.ts
 *
 * The categorical palette that colour-codes classes by type, and the rule that
 * assigns one to each class type.
 *
 * ==========================================================================
 * THE PALETTE WAS VALIDATED, NOT CHOSEN BY EYE
 * ==========================================================================
 * Colour here carries IDENTITY — "which kind of class is this" — which makes it
 * a categorical palette, and categorical palettes fail in ways that are
 * invisible to the person picking them. Three earlier candidate sets were
 * rejected by measurement:
 *
 *   olive  #4d7c0f ↔ rose #be123c   ΔE 2.6 (deuteranopia) — indistinguishable
 *   emerald #047857 ↔ sky #0369a1   ΔE 14.0 (NORMAL vision) — below the 15 floor
 *   cyan   #0e7490                  chroma 0.094 — reads as grey
 *
 * The set below passes the lightness band, the chroma floor, the normal-vision
 * floor (worst adjacent pair 22.0) and contrast against the page surface.
 *
 * ONE CAVEAT, RECORDED RATHER THAN HIDDEN: the worst colour-blind pair is
 * green ↔ amber at ΔE 6.8 (protanopia). That sits in the 6–8 "floor" band,
 * which is only acceptable WITH SECONDARY ENCODING. This design supplies it —
 * every block renders its class name as text and blocks are separated by a
 * visible gap, so no one has to distinguish two classes by hue alone. If a
 * future layout ever drops the text label, this palette must be re-stepped.
 *
 * ==========================================================================
 * WHY NOT JUST USE class_types.color?
 * ==========================================================================
 * That column exists and admins set it, so it is the source of INTENT — but it
 * cannot be the source of PIXELS. A stored hex carries no guarantee: a pale
 * yellow would render unreadable text on a tinted surface, and two class types
 * set to similar blues would be indistinguishable on the grid (which is exactly
 * the case today — Vinyasa is #6366f1 and Reformer is #0ea5e9).
 *
 * So the stored colour chooses a PREFERRED SLOT and the palette supplies the
 * actual values. Collisions fall through to the next free slot, so two similar
 * hues still end up visually distinct.
 */

export interface ClassTone {
  /** Stable slot name. Useful in tests and debugging, never shown to a user. */
  key: string;
  /** Tinted block background. */
  surface: string;
  /** Block border. */
  border: string;
  /** Body text on `surface` — every pair is AA (8.7–9.5:1). */
  text: string;
  /** Muted text on `surface`, for the metadata line. */
  textMuted: string;
  /** The left spine and dot. A graphic, so it needs 3:1, and clears 4.8–6.2:1. */
  accent: string;
  /** Hover surface, one step up. */
  surfaceHover: string;
  /** Reference hue angle, used only to match a stored hex to this slot. */
  hue: number;
}

/**
 * Slot order is FIXED and is the order collisions fall through. It is also the
 * order the validator checked adjacent pairs in — reordering these without
 * re-running the validator can silently reintroduce a failing pair.
 *
 * Class names are written out in full rather than composed, because Tailwind
 * generates utilities by scanning source text: `bg-${hue}-50` produces nothing.
 */
export const CLASS_TONES: ClassTone[] = [
  {
    key: 'amber',
    hue: 30,
    surface: 'bg-amber-50',
    surfaceHover: 'group-hover:bg-amber-100/70',
    border: 'border-amber-200',
    text: 'text-amber-900',
    textMuted: 'text-amber-900/70',
    accent: 'bg-amber-700',
  },
  {
    key: 'green',
    hue: 142,
    surface: 'bg-green-50',
    surfaceHover: 'group-hover:bg-green-100/70',
    border: 'border-green-200',
    text: 'text-green-900',
    textMuted: 'text-green-900/70',
    accent: 'bg-green-700',
  },
  {
    key: 'fuchsia',
    hue: 294,
    surface: 'bg-fuchsia-50',
    surfaceHover: 'group-hover:bg-fuchsia-100/70',
    border: 'border-fuchsia-200',
    text: 'text-fuchsia-900',
    textMuted: 'text-fuchsia-900/70',
    accent: 'bg-fuchsia-700',
  },
  {
    key: 'blue',
    hue: 226,
    surface: 'bg-blue-50',
    surfaceHover: 'group-hover:bg-blue-100/70',
    border: 'border-blue-200',
    text: 'text-blue-900',
    textMuted: 'text-blue-900/70',
    accent: 'bg-blue-700',
  },
  {
    key: 'rose',
    hue: 344,
    surface: 'bg-rose-50',
    surfaceHover: 'group-hover:bg-rose-100/70',
    border: 'border-rose-200',
    text: 'text-rose-900',
    textMuted: 'text-rose-900/70',
    accent: 'bg-rose-700',
  },
];

/**
 * Neutral fallback once every slot is taken.
 *
 * A SIXTH class type gets slate rather than a generated hue. The rule for
 * categorical palettes is that you never invent colour 6 — a machine-generated
 * hue lands wherever it lands, including on top of one of the five above. Grey
 * is honest: it says "this one has no assigned colour" instead of pretending.
 */
export const NEUTRAL_TONE: ClassTone = {
  key: 'neutral',
  hue: -1,
  surface: 'bg-slate-100',
  surfaceHover: 'group-hover:bg-slate-200/70',
  border: 'border-slate-300',
  text: 'text-slate-900',
  textMuted: 'text-slate-600',
  accent: 'bg-slate-600',
};

/** Hue angle 0–360 from a #rrggbb string. -1 when the input is unusable. */
export function hueOf(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return -1;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return -1; // grey has no hue to match on

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** Shortest distance between two hue angles, accounting for the wrap at 360. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export interface ClassTypeLike {
  id: string;
  /** The admin's stored preference, e.g. '#6366f1'. */
  color: string;
}

/**
 * Assign one tone per class type.
 *
 * ==========================================================================
 * STABILITY IS THE REQUIREMENT
 * ==========================================================================
 * A class type must be the SAME colour on every page and in every week. So the
 * caller passes the studio's full class-type list — not just the types that
 * happen to appear in the week being rendered. Assigning from the visible
 * subset would make Vinyasa green one week and blue the next, which destroys
 * the only thing colour-coding is for.
 *
 * The input order is therefore also load-bearing: it decides who wins a
 * contested slot. Callers sort by created_at, so an existing type never loses
 * its colour because a new one was added later.
 *
 * Each type takes its NEAREST FREE slot by hue. With today's data:
 *   Vinyasa  #6366f1 (hue 239) -> blue (226)
 *   Reformer #0ea5e9 (hue 199) -> blue taken, falls through to its next
 *                                 nearest free slot
 *   Prenatal #f59e0b (hue 38)  -> amber (30)
 */
export function assignClassTones(
  classTypes: readonly ClassTypeLike[],
): Map<string, ClassTone> {
  const assigned = new Map<string, ClassTone>();
  const free = new Set(CLASS_TONES.map((tone) => tone.key));

  for (const classType of classTypes) {
    if (free.size === 0) {
      assigned.set(classType.id, NEUTRAL_TONE);
      continue;
    }

    const hue = hueOf(classType.color);
    const candidates = CLASS_TONES.filter((tone) => free.has(tone.key));

    // A greyscale or malformed stored colour has no hue to match on, so it
    // simply takes the next free slot in fixed order rather than matching
    // arbitrarily.
    const chosen =
      hue < 0
        ? candidates[0]
        : candidates.reduce((best, tone) =>
            hueDistance(hue, tone.hue) < hueDistance(hue, best.hue) ? tone : best,
          );

    free.delete(chosen.key);
    assigned.set(classType.id, chosen);
  }

  return assigned;
}

/** Lookup with a safe default, so an unknown id can never crash a render. */
export function toneFor(
  tones: Map<string, ClassTone>,
  classTypeId: string | null | undefined,
): ClassTone {
  if (!classTypeId) return NEUTRAL_TONE;
  return tones.get(classTypeId) ?? NEUTRAL_TONE;
}
