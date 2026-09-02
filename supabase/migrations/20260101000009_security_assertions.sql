-- ============================================================================
-- StudioFlow — Migration 009: Automated Security Assertions
-- ----------------------------------------------------------------------------
-- Reference: Basic Security §2.2, §8 (pre-deployment checklist items 1, 2, 4, 5)
--
-- The failure mode this file exists to prevent:
--
--   A new table is added late in development.  Policies are written for it,
--   but ALTER TABLE ... ENABLE ROW LEVEL SECURITY is forgotten.  Everything
--   works perfectly through the application, because the application only
--   ever queries as an authorised user.  The table is also WORLD-READABLE to
--   anyone holding the anon key — which is published in the client bundle by
--   design.
--
-- A checklist does not prevent this, because it depends on someone
-- remembering.  These functions do, because CI calls them and fails the build.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Every table in `public` must have RLS enabled and at least one policy.
-- ---------------------------------------------------------------------------
create or replace function public.assert_rls_coverage()
returns table (
  table_name    text,
  rls_enabled   boolean,
  policy_count  int,
  is_secure     boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*)::int from pg_catalog.pg_policy p where p.polrelid = c.oid),
    (c.relrowsecurity
     and (select count(*) from pg_catalog.pg_policy p where p.polrelid = c.oid) > 0)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'                          -- ordinary tables only
    and c.relname not like 'pg_%'
  order by c.relname;
$$;

comment on function public.assert_rls_coverage() is
  'CI asserts every returned row has is_secure = true. A new table without RLS fails the build.';


-- ---------------------------------------------------------------------------
-- Every SECURITY DEFINER function must pin search_path.
-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function with a mutable search path is a
-- privilege-escalation primitive: it can be induced to call an
-- attacker-created object shadowing a real one, executing as the owner.
create or replace function public.assert_definer_search_path()
returns table (
  function_name    text,
  has_search_path  boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.proname::text,
    coalesce(
      exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      ),
      false
    )
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef                              -- SECURITY DEFINER only
  order by p.proname;
$$;


-- ---------------------------------------------------------------------------
-- Every view must be security_invoker.
-- ---------------------------------------------------------------------------
-- A view runs with the DEFINER's rights by default, so a view created to fix
-- an N+1 query would expose every row regardless of policy.  This is a
-- performance change that silently becomes a security hole.
create or replace function public.assert_views_security_invoker()
returns table (
  view_name        text,
  security_invoker boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.relname::text,
    coalesce(
      exists (
        select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) opt
        where opt = 'security_invoker=true' or opt = 'security_invoker=on'
      ),
      false
    )
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
  order by c.relname;
$$;


-- ---------------------------------------------------------------------------
-- INV-2: credits_remaining must always equal the sum of its ledger deltas.
-- ---------------------------------------------------------------------------
-- This is the guard that made the Detailed Technical Design §0.1 amendment
-- acceptable.  We introduced a maintained projection column on the condition
-- that a test proves it never drifts from the append-only ledger.  Returning
-- an empty set is the passing condition.
create or replace function public.assert_ledger_consistency()
returns table (
  grant_id          uuid,
  student_id        uuid,
  credits_remaining int,
  ledger_sum        int
)
language sql
security definer
stable
set search_path = ''
as $$
  select r.grant_id, r.student_id, r.credits_remaining, r.ledger_sum
  from public.v_grant_ledger_reconciliation r
  where not r.is_consistent;
$$;


-- ---------------------------------------------------------------------------
-- INV-1: no session may hold more confirmed bookings than its capacity.
-- ---------------------------------------------------------------------------
-- Run as a whole-system sweep after the test suite, once roughly 150 tests
-- have moved bookings in every possible way.  An empty result is the pass.
create or replace function public.assert_no_overbooking()
returns table (
  session_id      uuid,
  capacity        int,
  confirmed_count int
)
language sql
security definer
stable
set search_path = ''
as $$
  select s.id, s.capacity, count(b.id)::int
  from public.sessions s
  join public.bookings b
    on b.session_id = s.id and b.status = 'confirmed'
  group by s.id, s.capacity
  having count(b.id) > s.capacity;
$$;


-- ---------------------------------------------------------------------------
-- INV-3: nobody holds a confirmed booking AND a waiting entry for one session.
-- ---------------------------------------------------------------------------
create or replace function public.assert_no_dual_state()
returns table (session_id uuid, student_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select b.session_id, b.student_id
  from public.bookings b
  join public.waitlist_entries w
    on w.session_id = b.session_id
   and w.student_id = b.student_id
  where b.status = 'confirmed'
    and w.status = 'waiting';
$$;


-- ---------------------------------------------------------------------------
-- Grants — these are diagnostics, not application surface.
-- ---------------------------------------------------------------------------
revoke all on function public.assert_rls_coverage()             from public, anon, authenticated;
revoke all on function public.assert_definer_search_path()      from public, anon, authenticated;
revoke all on function public.assert_views_security_invoker()   from public, anon, authenticated;
revoke all on function public.assert_ledger_consistency()       from public, anon, authenticated;
revoke all on function public.assert_no_overbooking()           from public, anon, authenticated;
revoke all on function public.assert_no_dual_state()            from public, anon, authenticated;

grant execute on function public.assert_rls_coverage()           to service_role;
grant execute on function public.assert_definer_search_path()    to service_role;
grant execute on function public.assert_views_security_invoker() to service_role;
grant execute on function public.assert_ledger_consistency()     to service_role;
grant execute on function public.assert_no_overbooking()         to service_role;
grant execute on function public.assert_no_dual_state()          to service_role;
