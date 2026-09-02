/**
 * app/change-password/page.tsx — SERVER COMPONENT.
 *
 * The far end of the temporary-password flow (Basic Security §1.6, step 7).
 * app/my/layout.tsx redirects here whenever
 * studio_members.must_change_password is true, so this route must exist for an
 * admin-created instructor account to be usable at all.
 *
 * Unlike /login this page DOES check authentication, because
 * middleware's role here is only to keep signed-out visitors out — it cannot
 * tell whether rotation is actually outstanding. As everywhere else in this
 * codebase the check is a user-experience guard rather than the boundary: the
 * password update runs through Supabase Auth as the caller, and
 * complete_password_rotation() touches exactly one boolean on exactly the
 * caller's own row.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { AuthCard } from '@/components/auth/AuthCard';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { safeNextPath, DEFAULT_POST_LOGIN_PATH } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password — StudioFlow',
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next, DEFAULT_POST_LOGIN_PATH);

  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/change-password');

  const membership = await getMembership();

  // Distinguishes "you must do this now" from "you chose to do this", which is
  // the difference between a forced screen and a settings page. Anyone may
  // rotate their password voluntarily; only a flagged account is compelled to.
  const isForced = membership?.mustChangePassword === true;

  return (
    <AuthCard
      title={isForced ? 'Set your own password' : 'Change your password'}
      description={
        isForced
          ? 'Your account was created with a temporary password. Choose your own before continuing.'
          : 'Choose a new password for your account.'
      }
    >
      {isForced ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
        >
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The password you were given is temporary and shared. Replacing it
            now is required before the rest of the app opens up.
          </span>
        </div>
      ) : null}

      <ChangePasswordForm nextPath={nextPath} />
    </AuthCard>
  );
}
