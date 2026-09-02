/**
 * app/layout.tsx — the root layout. SERVER COMPONENT.
 *
 * Note what is NOT here: no provider tree, no store, no query client, no theme
 * context. That absence is the architecture working as intended.
 *
 * In a client-state application this file typically wraps everything in four
 * or five providers, each of which forces the entire tree to become client
 * code. Here, server data arrives through Server Components and mutations go
 * through Server Actions, so there is nothing global to provide. The only
 * JavaScript that reaches the browser is the handful of interactive leaves.
 *
 * RoleNav is awaited here rather than inside each page so that navigation is
 * resolved once per request.
 */

import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { RoleNav } from '@/components/shared/RoleNav';
import { CreditSpentToast } from '@/components/feedback/CreditSpentToast';
import './globals.css';

export const metadata: Metadata = {
  title: 'StudioFlow — book your classes',
  description:
    'Class schedule, booking and waitlist for small yoga and Pilates studios.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* Keyboard users reach the content without tabbing the whole nav. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:ring-2 focus:ring-brand-600"
        >
          Skip to content
        </a>

        {/*
          STICKY, TRANSLUCENT HEADER.

          Sticky because the nav carries the alerts badge and the primary
          destinations, and on a phone the schedule is long enough that losing
          them means scrolling back up.

          The translucency + blur is what makes it read as a native app chrome
          rather than a web banner: content passing underneath stays faintly
          visible, so the bar feels like a layer over the page instead of a lid
          on top of it. `supports-[backdrop-filter]` keeps a fully opaque
          fallback wherever backdrop-filter is unavailable — without it the
          header would be semi-transparent with NO blur, and text would collide
          with whatever scrolled beneath.
        */}
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 supports-[backdrop-filter]:bg-white/70 supports-[backdrop-filter]:backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link
              href="/schedule"
              className="group inline-flex items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
            >
              {/* A mark, so the wordmark is not the only brand element. The
                  three ascending bars read as a class schedule at 20px. */}
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white shadow-xs transition-transform duration-200 ease-[var(--ease-out-soft)] group-hover:scale-105"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                  <path
                    d="M6 15v4M12 9v10M18 5v14"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {/* One flex child, so the wordmark stays a single word — the
                  parent's gap-2 belongs between the MARK and the name, not
                  between "Studio" and "Flow". */}
              <span>
                Studio<span className="text-brand-600">Flow</span>
              </span>
            </Link>
            <RoleNav />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
          {children}
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs text-slate-500">
          <p>All times are shown in the studio&rsquo;s local timezone.</p>
        </footer>

        {/*
          Mounted HERE, at the root, deliberately. A Server Action that calls
          revalidatePath re-renders the route and can unmount the component that
          triggered it — which is exactly what destroyed the first version of the
          booking receipt. The layout survives every route transition, so
          feedback that must outlive the action it describes belongs in it.
        */}
        <CreditSpentToast />
      </body>
    </html>
  );
}
