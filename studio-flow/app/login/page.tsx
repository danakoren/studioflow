/**
 * app/login/page.tsx — SERVER COMPONENT.
 *
 * The form itself is a Client Component; this page exists to do the one thing
 * that must not happen in the browser — SANITISE ?next= before it is handed to
 * anything that can navigate (Basic Security §4.3).
 *
 * There is no auth check here. Middleware already bounces an authenticated
 * visitor away from /login, so duplicating that would add a second place for
 * the rule to drift out of agreement with the first.
 *
 * force-dynamic because the rendered output depends on a query parameter and on
 * whether the visitor has a session. A cached login page is a page that shows
 * one person's "sign in to continue" banner to the next visitor.
 */

import type { Metadata } from 'next';
import { LogIn } from 'lucide-react';
import { AuthCard } from '@/components/auth/AuthCard';
import { LoginForm } from '@/components/auth/LoginForm';
import { ActionMessage } from '@/components/ui/action-message';
import { safeNextPath } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in — StudioFlow',
};

export default async function LoginPage({
  searchParams,
}: {
  // In Next.js 15+ searchParams is a Promise and MUST be awaited.
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Empty fallback, not '/schedule': it lets the page distinguish "arrived
  // here from a protected route" from "clicked Sign in" and word itself
  // accordingly. The form receives only this sanitised value.
  const nextPath = safeNextPath(params.next, '');

  // Set by /auth/callback when a confirmation link could not be redeemed.
  // Compared against a known literal — the parameter is never rendered, so it
  // cannot be used to inject arbitrary text into this page.
  const linkFailed = params.error === 'link';

  return (
    <AuthCard
      title="Sign in"
      description={
        nextPath
          ? 'Sign in to continue where you left off.'
          : 'Welcome back. Sign in to book and manage your classes.'
      }
    >
      {linkFailed ? (
        <ActionMessage
          tone="error"
          message="That link has expired or has already been used. Sign in below, or register again to get a new one."
        />
      ) : null}

      {nextPath && !linkFailed ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900 ring-1 ring-inset ring-brand-200"
        >
          <LogIn className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>That page needs an account. Sign in and we&rsquo;ll take you straight there.</span>
        </div>
      ) : null}

      <LoginForm nextPath={nextPath} />
    </AuthCard>
  );
}
