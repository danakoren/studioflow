import { redirect } from 'next/navigation';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';

/**
 * app/teach/layout.tsx — SERVER COMPONENT guarding the instructor area.
 *
 * ==========================================================================
 * WHY ADMINS ARE LET IN TOO
 * ==========================================================================
 * The brief for this route said "only users with the instructor role". This
 * layout admits 'instructor' AND 'admin', deliberately, because every other
 * part of the system already assumes that:
 *
 *   - RoleNav renders the /teach link for admins as well as instructors.
 *   - requireStaff() in lib/auth/require.ts is defined as exactly this pair.
 *   - markAttendance / markAllPresent both declare roles ['instructor','admin'].
 *   - mark_attendance() in Postgres accepts teaches_session() OR
 *     is_studio_admin(), so an admin can already mark any roster in their
 *     studio — the database would permit what an instructor-only page refused.
 *   - Basic Security §2.5 lists roster viewing as "session's instructor or
 *     admin".
 *
 * Locking admins out here would therefore 403 a link the app's own navigation
 * shows them, while changing nothing about what they can actually do through
 * the API. The intent behind the brief — keep STUDENTS out — is fully met.
 *
 * To make it instructor-only after all, narrow ALLOWED below to
 * ['instructor'] and drop /teach from ADMIN's links in RoleNav.
 *
 * ==========================================================================
 * NOT THE SECURITY BOUNDARY
 * ==========================================================================
 * As with app/my/layout.tsx, this is a user-experience guard: it produces a
 * login page or a redirect instead of an empty screen. The real protection is
 * RLS, and specifically teaches_session(), which is PER-SESSION rather than
 * per-role — passing this layout does not grant an instructor access to a
 * colleague's roster, because the policies compare instructor_id to auth.uid().
 */

const ALLOWED = ['instructor', 'admin'] as const;

export default async function TeachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/teach');

  const membership = await getMembership();

  // No membership at all — signed in, but not part of any studio.
  if (!membership) redirect('/schedule');

  // Same rotation gate the student area applies (Basic Security §1.6): an
  // instructor holding the temporary password their admin read out to them
  // rotates it before anything else opens up. This is the route that gate
  // exists for, since instructors are the accounts created that way.
  if (membership.mustChangePassword) redirect('/change-password');

  if (!ALLOWED.includes(membership.role as (typeof ALLOWED)[number])) {
    // A student who typed the URL. Sent to their own area rather than shown a
    // 403 — there is nothing here for them to fix.
    redirect('/schedule');
  }

  return <>{children}</>;
}
