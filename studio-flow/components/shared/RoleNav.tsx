import Link from 'next/link';
import {
  CalendarDays,
  Ticket,
  BookMarked,
  Bell,
  Users,
  Settings,
  ClipboardList,
  BarChart3,
  LayoutDashboard,
  LogIn,
} from 'lucide-react';
import { getVerifiedUser, getMembership } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/shared/SignOutButton';
import { linkButtonClasses } from '@/components/ui/link-button';
import type { MemberRole } from '@/lib/types/database.types';

/**
 * components/shared/RoleNav.tsx
 *
 * SERVER COMPONENT. This is the important part.
 *
 * The role is read on the server, from studio_members, on every render. It is
 * never sent to the browser as state, never held in a client store, and never
 * inferred from a JWT claim. The browser receives only the finished HTML for
 * the links that user is entitled to see.
 *
 * This is presentation, NOT security. Hiding the /admin link protects nobody:
 * an attacker types the URL. What actually stops them is the RLS policy that
 * returns zero rows. Navigation exists so a student is never shown a control
 * that will fail — a better experience, not a boundary.
 *
 * Only the sign-out button below is a Client Component. Everything else here
 * ships as markup with no JavaScript at all.
 */

interface NavLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * ==========================================================================
 * ONE ROLE, ONE MENU — NOT THE UNION OF EVERY ROLE
 * ==========================================================================
 * These lists used to be CONCATENATED: an admin received the student links,
 * then the instructor link, then the admin links. Two things followed, and both
 * were bugs rather than trade-offs:
 *
 *   1. TWO "Schedule" ENTRIES — /schedule from the student set and
 *      /admin/schedule from the admin set, identically labelled and
 *      indistinguishable in the bar.
 *   2. TEN items needing ~1080px inside ~992px of header, so the row wrapped
 *      and pushed "Sign out" onto a second line.
 *
 * Each role now gets ONE list sized to fit. The rule for resolving the
 * duplicate is "the most capable view of the same thing wins": an admin's
 * Schedule points at /admin/schedule, which is a superset of the public page —
 * it shows cancelled classes too and every row opens for editing. Sending an
 * owner to the read-only view and making them navigate again would be the
 * wrong half of the pair to keep.
 *
 * WHAT AN ADMIN NO LONGER HAS HERE, and where it went: their own /my/bookings,
 * /my/credits and /teach. An owner can still attend and teach classes, so those
 * pages are reachable from the tile grid at the foot of /admin rather than
 * removed — the header carries the job they opened the app to do, and the
 * dashboard carries the rest.
 */

const STUDENT_LINKS: NavLink[] = [
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/my/bookings', label: 'My classes', icon: BookMarked },
  { href: '/my/credits', label: 'Credits', icon: Ticket },
];

const INSTRUCTOR_LINKS: NavLink[] = [
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/teach', label: 'Teaching', icon: ClipboardList },
  { href: '/my/bookings', label: 'My classes', icon: BookMarked },
  { href: '/my/credits', label: 'Credits', icon: Ticket },
];

const ADMIN_LINKS: NavLink[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/admin/students', label: 'Students', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

/** The one list this member sees. Never a union. */
function linksForRole(role: MemberRole): NavLink[] {
  switch (role) {
    case 'admin':
      return ADMIN_LINKS;
    case 'instructor':
      return INSTRUCTOR_LINKS;
    default:
      return STUDENT_LINKS;
  }
}

export async function RoleNav() {
  const user = await getVerifiedUser();

  if (!user) {
    return (
      <nav className="flex items-center gap-1" aria-label="Main">
        <NavItem href="/schedule" label="Schedule" icon={CalendarDays} />
        <Link
          href="/login"
          // Was a hand-rolled copy of the button styling that had drifted: no
          // focus ring, no press feedback, no elevation. Shares one definition
          // with every other primary link now.
          className={linkButtonClasses()}
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Sign in
        </Link>
      </nav>
    );
  }

  const membership = await getMembership();

  // Authenticated but not a member of any studio — a real state, not an error.
  if (!membership) {
    return (
      <nav className="flex items-center gap-1" aria-label="Main">
        <NavItem href="/schedule" label="Schedule" icon={CalendarDays} />
        <SignOutButton />
      </nav>
    );
  }

  const links = linksForRole(membership.role);

  const unreadCount = await getUnreadCount();

  return (
    // flex-wrap is kept as a SAFETY NET, not as the layout: every role's list is
    // sized to fit one row at max-w-5xl, and wrapping is still better than
    // overflowing if a future label is longer than expected.
    <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
      {links.map((link) => (
        <NavItem key={link.href} {...link} />
      ))}

      <Link
        href="/my/notifications"
        className="relative inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Alerts</span>
        {unreadCount > 0 ? (
          <span
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-semibold text-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Link>

      <SignOutButton />
    </nav>
  );
}

function NavItem({ href, label, icon: Icon }: NavLink) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}

/**
 * Unread badge count.
 *
 * `head: true` requests the count WITHOUT the rows — this renders on every
 * authenticated page, and fetching the notification bodies to display a number
 * would be pure waste. Backed by the partial index notifications_unread_idx,
 * which stays small because most notifications get read (Scaling §2.6).
 */
async function getUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) return 0;
  return count ?? 0;
}
