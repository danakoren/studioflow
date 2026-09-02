/**
 * lib/auth/require.ts
 *
 * ==========================================================================
 * THE MOST IMPORTANT RULE IN THIS CODEBASE
 * ==========================================================================
 *
 *   ALWAYS  supabase.auth.getUser()   -> sends the token to the Auth server,
 *                                        which VERIFIES ITS SIGNATURE.
 *
 *   NEVER   supabase.auth.getSession() -> decodes the cookie LOCALLY, without
 *                                         contacting the Auth server.
 *
 * A cookie is client-controlled data. getSession() returns whatever the
 * cookie CLAIMS, so a forged or tampered cookie yields a user object that
 * looks entirely legitimate to application code.
 *
 * The two are easy to confuse because they appear to behave identically in
 * development. getSession() must not appear in any authorisation path, and
 * pre-deployment checklist item 11 greps for it.
 *
 * (Basic Security §1.4)
 * ==========================================================================
 *
 * These helpers implement stages 1 and 3 of the five-stage action skeleton.
 * They return ActionResult rather than throwing, so an action propagates a
 * failure with `if (!auth.ok) return auth;`.
 */

import 'server-only';
import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import { logServerError } from '@/lib/errors/map';
import type { MemberRole } from '@/lib/types/database.types';

export interface Membership {
  studioId: string;
  studioName: string;
  studioSlug: string;
  timezone: string;
  role: MemberRole;
  mustChangePassword: boolean;
}

export interface AuthContext {
  user: User;
  membership: Membership;
}

/**
 * Stage 1 — Authenticate.
 *
 * `cache()` deduplicates this within a single request, so a layout, a page and
 * three components asking for the current user produce ONE verification call
 * rather than five.
 */
export const getVerifiedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser(): Promise<ActionResult<User>> {
  const user = await getVerifiedUser();
  if (!user) return fail('NOT_AUTHENTICATED');
  return ok(user);
}

/**
 * Stage 3 — Authorize (membership).
 *
 * The role is read SERVER-SIDE from studio_members on every call. It is never
 * taken from the client, never passed as a parameter, and never trusted from a
 * JWT custom claim (Basic Security §2.3).
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const user = await getVerifiedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studio_members')
    .select(
      'studio_id, role, must_change_password, studios!inner(id, name, slug, timezone)',
    )
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logServerError('getMembership', error);
    return null;
  }
  if (!data) return null;

  // supabase-js types an !inner join as an object or an array depending on
  // inference; normalise rather than casting blindly.
  const studioJoin = data.studios as unknown;
  const studio = Array.isArray(studioJoin)
    ? (studioJoin[0] as Record<string, unknown> | undefined)
    : (studioJoin as Record<string, unknown> | null);

  if (!studio) return null;

  return {
    studioId: data.studio_id,
    studioName: String(studio.name ?? ''),
    studioSlug: String(studio.slug ?? ''),
    timezone: String(studio.timezone ?? 'Asia/Jerusalem'),
    role: data.role,
    mustChangePassword: data.must_change_password,
  };
});

/** Authenticated AND an active member of a studio. */
export async function requireMembership(): Promise<ActionResult<AuthContext>> {
  const user = await getVerifiedUser();
  if (!user) return fail('NOT_AUTHENTICATED');

  const membership = await getMembership();
  if (!membership) return fail('NOT_A_MEMBER');

  return ok({ user, membership });
}

/**
 * Membership plus a role check.
 *
 * This is stage 3 of the skeleton. It exists to fail FAST with a
 * comprehensible message — RLS denies the operation regardless, but a policy
 * denial surfaces as an empty result set, which is a poor error for a user.
 */
export async function requireRole(
  ...allowed: MemberRole[]
): Promise<ActionResult<AuthContext>> {
  const context = await requireMembership();
  if (!context.ok) return context;

  if (!allowed.includes(context.data.membership.role)) {
    return fail('FORBIDDEN');
  }
  return context;
}

export async function requireAdmin(): Promise<ActionResult<AuthContext>> {
  return requireRole('admin');
}

export async function requireStaff(): Promise<ActionResult<AuthContext>> {
  return requireRole('instructor', 'admin');
}

/**
 * Blocks an instructor who is still holding the temporary password issued at
 * account creation, until they have rotated it (Basic Security §1.6).
 */
export async function requireRotatedPassword(
  context: AuthContext,
): Promise<ActionResult<AuthContext>> {
  if (context.membership.mustChangePassword) {
    return fail('PASSWORD_ROTATION_REQUIRED');
  }
  return ok(context);
}
