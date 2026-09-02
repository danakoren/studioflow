import { redirect } from 'next/navigation';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';

/**
 * app/my/layout.tsx — SERVER COMPONENT guarding the student area.
 *
 * This is a USER-EXPERIENCE guard, not a security boundary. It exists so a
 * signed-out visitor gets a login page instead of an empty dashboard. The
 * actual protection is RLS: every query beneath this layout returns only rows
 * belonging to auth.uid(), whether or not this check runs.
 *
 * It also enforces the temporary-password rotation from Security §1.6 — an
 * instructor still holding the password their admin handed them is sent to
 * change it before anything else becomes reachable.
 */

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/my/bookings');

  const membership = await getMembership();
  if (membership?.mustChangePassword) redirect('/change-password');

  return <>{children}</>;
}
