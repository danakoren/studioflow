-- ============================================================================
-- StudioFlow — repair script: make hand-seeded auth.users rows loadable
-- ----------------------------------------------------------------------------
-- RUN THIS ONCE, in the Supabase dashboard SQL editor.
--
-- This is a DATA repair, not a schema migration, which is why it lives outside
-- supabase/migrations/ — it fixes rows that seed.sql already inserted. The
-- underlying bug is fixed in seed.sql itself, so a fresh re-seed does not need
-- this script.
--
-- ---------------------------------------------------------------------------
-- THE SYMPTOM
-- ---------------------------------------------------------------------------
-- Every sign-in for a seeded account fails with:
--
--     POST /auth/v1/token?grant_type=password
--     500  unexpected_failure  "Database error querying schema"
--
-- while a NON-EXISTENT email correctly returns a clean
-- 400 invalid_credentials. That asymmetry is the whole diagnosis: GoTrue can
-- reach the database and evaluate credentials fine, so the problem is the
-- seeded ROWS, not the auth service, not the schema grants, and not RLS.
--
-- ---------------------------------------------------------------------------
-- THE CAUSE
-- ---------------------------------------------------------------------------
-- seed.sql inserted into auth.users directly and set only the columns it cared
-- about. The token columns below were therefore left NULL. GoTrue scans them
-- into non-nullable Go strings, so loading the row errors out before the
-- password is ever compared — which is why a correct password fails
-- identically to a wrong one.
--
-- Note how well this hides: PostgREST, RLS, the views and every page in the
-- app are completely unaffected. The product looks healthy right up until
-- someone tries to log in.
--
-- ---------------------------------------------------------------------------
-- WHY THE DYNAMIC SQL
-- ---------------------------------------------------------------------------
-- auth is a Supabase-managed schema and its exact column set varies across
-- GoTrue versions. Naming a column that does not exist in this project's
-- version would abort the whole script, so each column is checked against
-- information_schema first and only updated if it is present AND nullable.
-- Column names come from the catalogue, never from input, and are still
-- interpolated with format() %I/%L — the safe pattern named in Basic
-- Security §4.3.
-- ============================================================================

do $$
declare
  v_col     text;
  v_updated int;
  v_total   int := 0;
begin
  for v_col in
    select c.column_name
    from information_schema.columns c
    where c.table_schema = 'auth'
      and c.table_name   = 'users'
      and c.is_nullable  = 'YES'
      and c.column_name  = any (array[
        'confirmation_token',
        'recovery_token',
        'email_change',
        'email_change_token_new',
        'email_change_token_current',
        'phone_change',
        'phone_change_token',
        'reauthentication_token'
      ])
    order by c.column_name
  loop
    execute format(
      'update auth.users set %I = %L where %I is null', v_col, '', v_col
    );
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;

    raise notice 'auth.users.%: repaired % NULL value(s)', v_col, v_updated;
  end loop;

  raise notice 'Done. % column value(s) repaired in total.', v_total;
end
$$;


-- ---------------------------------------------------------------------------
-- Verification — every count below must be 0.
-- ---------------------------------------------------------------------------
select
  count(*) as users_total,
  count(*) filter (where confirmation_token is null)         as null_confirmation,
  count(*) filter (where recovery_token is null)             as null_recovery,
  count(*) filter (where email_change is null)               as null_email_change,
  count(*) filter (where email_change_token_new is null)     as null_change_new,
  count(*) filter (where reauthentication_token is null)     as null_reauth
from auth.users;


-- ============================================================================
-- OPTIONAL — remove the throwaway account Claude created while diagnosing
-- ============================================================================
-- One account was created through the Admin API to prove that sign-in works
-- for a correctly-formed row (it does). It could not be deleted afterwards,
-- because auth.admin.listUsers() enumerates every row and therefore hit the
-- very NULL-column failure above.
--
-- Review this before running it. The pattern matches only that account:
-- 'claude.authcheck.<timestamp>@studioflowcheck.dev'. No seeded or real
-- account can match it. Deleting from auth.users cascades to profiles and
-- studio_members. Drop this statement if you would rather remove it yourself
-- from Authentication -> Users in the dashboard.

select id, email, created_at
from auth.users
where email like 'claude.authcheck.%@studioflowcheck.dev';

delete from auth.users
where email like 'claude.authcheck.%@studioflowcheck.dev';
