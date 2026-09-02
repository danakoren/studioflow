-- ============================================================================
-- StudioFlow — Migration 004: RLS Helper Functions
-- ----------------------------------------------------------------------------
-- Reference: Basic Security §2.4
--
-- Every helper below carries THREE attributes, each preventing a distinct
-- problem.  All three are required; omitting any one produces a bug that is
-- invisible in normal use.
--
--   SECURITY DEFINER      Prevents INFINITE RECURSION.  A policy on
--                         studio_members that queries studio_members recurses
--                         and fails at runtime.  Running the helper with the
--                         definer's rights breaks the cycle.
--
--   STABLE                Prevents PER-ROW RE-EVALUATION.  PostgreSQL calls a
--                         STABLE function once per statement instead of once
--                         per row.  A VOLATILE helper would turn a 500-row
--                         scan into 500 extra subqueries (Scaling §2.7).
--
--   SET search_path = ''  Prevents SEARCH-PATH HIJACKING.  A SECURITY DEFINER
--                         function with a mutable search path can be induced
--                         to call an attacker-created object shadowing a real
--                         one, executing with elevated privileges.  This is a
--                         privilege-escalation primitive, not a style choice.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Is the current user an ACTIVE member of this studio?
-- ---------------------------------------------------------------------------
create or replace function public.is_studio_member(p_studio_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_members m
    where m.studio_id = p_studio_id
      and m.user_id   = auth.uid()
      and m.is_active
  );
$$;


-- ---------------------------------------------------------------------------
-- Does the current user hold this role in this studio?
-- ---------------------------------------------------------------------------
create or replace function public.has_studio_role(
  p_studio_id uuid,
  p_role      public.member_role
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_members m
    where m.studio_id = p_studio_id
      and m.user_id   = auth.uid()
      and m.role      = p_role
      and m.is_active
  );
$$;


-- ---------------------------------------------------------------------------
-- Convenience wrapper: admin of this studio?
-- ---------------------------------------------------------------------------
create or replace function public.is_studio_admin(p_studio_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.has_studio_role(p_studio_id, 'admin'::public.member_role);
$$;


-- ---------------------------------------------------------------------------
-- Does the current user TEACH this specific session?
-- ---------------------------------------------------------------------------
-- Note this is per-session, not per-role.  An instructor may only reach the
-- rosters of sessions they personally teach — role alone grants nothing.
create or replace function public.teaches_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    join public.studio_members m
      on m.studio_id = s.studio_id
     and m.user_id   = auth.uid()
    where s.id            = p_session_id
      and s.instructor_id = auth.uid()
      and m.is_active
      and m.role in ('instructor', 'admin')
  );
$$;


-- ---------------------------------------------------------------------------
-- Is the current user an admin of the studio owning this session?
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and public.is_studio_admin(s.studio_id)
  );
$$;


-- ---------------------------------------------------------------------------
-- Current user's active membership (used by the application, not by policies)
-- ---------------------------------------------------------------------------
create or replace function public.current_membership()
returns table (
  studio_id            uuid,
  studio_name          text,
  studio_slug          text,
  timezone             text,
  role                 public.member_role,
  must_change_password boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.name, s.slug, s.timezone, m.role, m.must_change_password
  from public.studio_members m
  join public.studios s on s.id = m.studio_id
  where m.user_id = auth.uid()
    and m.is_active
  order by m.joined_at
  limit 1;
$$;


-- ---------------------------------------------------------------------------
-- Student credit balance
-- ---------------------------------------------------------------------------
-- Sum over active, unexpired grants.  INV-2 asserts this always agrees with
-- the sum of the corresponding ledger deltas.
create or replace function public.student_balance(p_student_id uuid)
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(sum(g.credits_remaining), 0)::int
  from public.credit_grants g
  where g.student_id = p_student_id
    and g.status     = 'active'
    and (g.expires_at is null or g.expires_at > now());
$$;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default, so an
-- explicit REVOKE is required before granting deliberately.
--
-- anon needs EXECUTE on the membership helpers because policies on publicly
-- readable tables evaluate them; for an anonymous request auth.uid() is null
-- and every helper correctly returns false.

revoke all on function public.is_studio_member(uuid)                     from public;
revoke all on function public.has_studio_role(uuid, public.member_role)  from public;
revoke all on function public.is_studio_admin(uuid)                      from public;
revoke all on function public.teaches_session(uuid)                      from public;
revoke all on function public.can_manage_session(uuid)                   from public;
revoke all on function public.current_membership()                       from public;
revoke all on function public.student_balance(uuid)                      from public;

grant execute on function public.is_studio_member(uuid)                    to anon, authenticated, service_role;
grant execute on function public.has_studio_role(uuid, public.member_role) to anon, authenticated, service_role;
grant execute on function public.is_studio_admin(uuid)                     to anon, authenticated, service_role;
grant execute on function public.teaches_session(uuid)                     to anon, authenticated, service_role;
grant execute on function public.can_manage_session(uuid)                  to anon, authenticated, service_role;
grant execute on function public.current_membership()                      to authenticated, service_role;
grant execute on function public.student_balance(uuid)                     to authenticated, service_role;
