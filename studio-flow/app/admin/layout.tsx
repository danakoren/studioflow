import { redirect } from 'next/navigation';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';

/**
 * app/admin/layout.tsx — SERVER COMPONENT guarding the studio-owner area.
 *
 * ADMIN ONLY. Unlike app/teach/layout.tsx — which admits admins alongside
 * instructors because every other layer already does — there is no ambiguity
 * here: RoleNav shows ADMIN_LINKS to admins alone, requireAdmin() exists for
 * exactly this pair of routes, and every action beneath this tree declares
 * roles: ['admin'].
 *
 * ==========================================================================
 * STILL NOT THE SECURITY BOUNDARY
 * ==========================================================================
 * This produces a redirect instead of an empty dashboard. It is not what stops
 * an instructor reading the studio's ledger — that is RLS, and specifically
 * is_studio_admin(), evaluated per row inside the policies from migration 005.
 * If this file were deleted, an instructor who typed /admin/students would see
 * a page rendering zero rows rather than a page rendering other people's money.
 *
 * The most privileged plausible attacker is not an instructor, though: it is
 * admin.b@test, a full administrator of a DIFFERENT studio, who is seeded so
 * that isolation can be exercised. Nothing in this layout defends
 * against them — every query below scopes to the ACTOR'S OWN membership, and
 * the policies enforce it independently.
 */

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getVerifiedUser();
  if (!user) redirect('/login?next=/admin');

  const membership = await getMembership();
  if (!membership) redirect('/schedule');

  // An admin account can also be created with a temporary password, so the
  // rotation gate from Basic Security §1.6 applies here too.
  if (membership.mustChangePassword) redirect('/change-password');

  // Sent to the schedule rather than shown a 403: for a student or instructor
  // there is nothing here to fix, and naming the area confirms it exists.
  if (membership.role !== 'admin') redirect('/schedule');

  return <>{children}</>;
}
