/**
 * components/ui/link-button.ts
 *
 * The Button primitive's styling, as a class string, for things that must be a
 * <Link> rather than a <button>.
 *
 * ==========================================================================
 * WHY THIS EXISTS
 * ==========================================================================
 * "Sign in", "Add a class" and the empty-state CTAs are NAVIGATION — they take
 * you somewhere, so they have to render as anchors for middle-click, cmd-click,
 * "copy link address" and the status-bar preview to work. Wrapping <Button> in a
 * <Link> would produce a button inside an anchor, which is invalid HTML and
 * which assistive technology announces incoherently.
 *
 * So the styling was hand-copied into five files instead, and immediately began
 * to drift: none of the copies picked up the press feedback, the elevation or
 * the disabled handling that Button gained later. This is the single definition
 * they should all have been sharing.
 *
 * It deliberately mirrors components/ui/button.tsx. If you change one, change
 * both — they are two renderings of one visual component, and the duplication
 * is the price of correct semantics.
 */

type LinkButtonVariant = 'primary' | 'secondary';

const VARIANTS: Record<LinkButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 hover:shadow-sm focus-visible:outline-brand-600',
  secondary:
    'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 shadow-xs hover:bg-slate-50 hover:ring-slate-400 focus-visible:outline-slate-600',
};

export function linkButtonClasses(
  variant: LinkButtonVariant = 'primary',
  extra = '',
): string {
  return [
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4',
    'text-sm font-medium',
    // Same press-over-hover reasoning as Button: there is no hover on touch.
    'transition-[transform,background-color,box-shadow,color] duration-150',
    'ease-[var(--ease-out-soft)] active:scale-[0.97]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    'select-none',
    VARIANTS[variant],
    extra,
  ].join(' ');
}
