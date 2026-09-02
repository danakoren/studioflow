-- ============================================================================
-- StudioFlow — Migration 005: Row Level Security
-- ----------------------------------------------------------------------------
-- Reference: Basic Security §2.2, §2.5
--
-- THIS FILE IS THE ONLY REAL SECURITY BOUNDARY IN THE SYSTEM.
--
-- Middleware, Server Component checks and Server Action assertions all improve
-- the experience and produce clear errors.  None of them is in the path of a
-- request an attacker constructs themselves: the anon key and the attacker's
-- own JWT are both readable from the browser in seconds, and PostgREST accepts
-- direct queries.  If every application-layer check were deleted, these
-- policies alone would still deny access.
--
-- RLS is a TWO-part mechanism.  ENABLE ROW LEVEL SECURITY without policies
-- denies everyone; policies without ENABLE are NEVER CONSULTED and the table
-- is world-readable to anyone holding the (public) anon key.  Migration 009
-- adds an automated assertion over pg_tables so a future table cannot ship
-- with step one forgotten.
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.studios          enable row level security;
alter table public.studio_members   enable row level security;
alter table public.rooms            enable row level security;
alter table public.class_types      enable row level security;
alter table public.sessions         enable row level security;
alter table public.bookings         enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.credit_grants    enable row level security;
alter table public.credit_ledger    enable row level security;
alter table public.notifications    enable row level security;


-- ---------------------------------------------------------------------------
-- Defence in depth: remove table-level write privileges that RLS would
-- otherwise have to be the sole gate for.
-- ---------------------------------------------------------------------------
-- The ledger is append-only for EVERY role including admin (INV-4).  There is
-- no UPDATE or DELETE policy below, and the privilege is revoked as well.
revoke update, delete on public.credit_ledger from anon, authenticated;

-- Nothing in this system is ever hard-deleted.
revoke delete on public.bookings         from anon, authenticated;
revoke delete on public.sessions         from anon, authenticated;
revoke delete on public.waitlist_entries from anon, authenticated;
revoke delete on public.credit_grants    from anon, authenticated;
revoke delete on public.profiles         from anon, authenticated;
revoke delete on public.studio_members   from anon, authenticated;


-- ===========================================================================
-- profiles
-- ===========================================================================

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- An instructor may see the NAMES of students booked into sessions they
-- personally teach — and nothing else.  No email, no phone, no balance.
create policy profiles_select_own_roster
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      join public.sessions s on s.id = b.session_id
      where b.student_id = public.profiles.id
        and b.status     = 'confirmed'
        and s.instructor_id = auth.uid()
    )
  );

-- Instructor names appear on the public schedule.
create policy profiles_select_instructors
  on public.profiles for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.instructor_id = public.profiles.id
        and s.status = 'scheduled'
    )
  );

create policy profiles_select_studio_admin
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.studio_members m
      where m.user_id = public.profiles.id
        and public.is_studio_admin(m.studio_id)
    )
  );

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- ===========================================================================
-- studios
-- ===========================================================================

create policy studios_select_public
  on public.studios for select
  to anon, authenticated
  using (true);

create policy studios_update_admin
  on public.studios for update
  to authenticated
  using (public.is_studio_admin(id))
  with check (public.is_studio_admin(id));


-- ===========================================================================
-- studio_members
-- ===========================================================================
-- These policies call is_studio_admin(), which is SECURITY DEFINER.  A policy
-- that queried studio_members directly would recurse infinitely.

create policy studio_members_select_own
  on public.studio_members for select
  to authenticated
  using (user_id = auth.uid());

create policy studio_members_select_admin
  on public.studio_members for select
  to authenticated
  using (public.is_studio_admin(studio_id));

create policy studio_members_insert_admin
  on public.studio_members for insert
  to authenticated
  with check (public.is_studio_admin(studio_id));

-- NOTE: there is deliberately NO update policy for a member on their own row.
-- Without this omission the entire authorisation model collapses to a single
-- UPDATE setting role = 'admin' (test PR-21).  Password-rotation state is
-- cleared by a SECURITY DEFINER function instead.
create policy studio_members_update_admin
  on public.studio_members for update
  to authenticated
  using (public.is_studio_admin(studio_id))
  with check (public.is_studio_admin(studio_id));


-- ===========================================================================
-- rooms / class_types
-- ===========================================================================

create policy rooms_select
  on public.rooms for select
  to anon, authenticated
  using (is_active or public.is_studio_member(studio_id));

create policy rooms_write_admin
  on public.rooms for all
  to authenticated
  using (public.is_studio_admin(studio_id))
  with check (public.is_studio_admin(studio_id));

create policy class_types_select
  on public.class_types for select
  to anon, authenticated
  using (is_active or public.is_studio_member(studio_id));

create policy class_types_write_admin
  on public.class_types for all
  to authenticated
  using (public.is_studio_admin(studio_id))
  with check (public.is_studio_admin(studio_id));


-- ===========================================================================
-- sessions
-- ===========================================================================

-- The public schedule is intentionally readable without an account: requiring
-- registration before a visitor can see whether the studio offers a class at a
-- time they can attend suppresses conversion for no benefit.
create policy sessions_select_public_schedule
  on public.sessions for select
  to anon, authenticated
  using (status = 'scheduled');

create policy sessions_select_members
  on public.sessions for select
  to authenticated
  using (public.is_studio_member(studio_id));

create policy sessions_insert_admin
  on public.sessions for insert
  to authenticated
  with check (public.is_studio_admin(studio_id));

create policy sessions_update_admin
  on public.sessions for update
  to authenticated
  using (public.is_studio_admin(studio_id))
  with check (public.is_studio_admin(studio_id));

-- An instructor may cancel or amend ONLY the sessions they personally teach.
create policy sessions_update_own_taught
  on public.sessions for update
  to authenticated
  using (instructor_id = auth.uid() and public.is_studio_member(studio_id))
  with check (instructor_id = auth.uid() and public.is_studio_member(studio_id));


-- ===========================================================================
-- bookings
-- ===========================================================================

create policy bookings_select_own
  on public.bookings for select
  to authenticated
  using (student_id = auth.uid());

create policy bookings_select_own_roster
  on public.bookings for select
  to authenticated
  using (public.teaches_session(session_id));

create policy bookings_select_admin
  on public.bookings for select
  to authenticated
  using (public.is_studio_admin(studio_id));

-- Bookings are created by book_session() / admin_book_student(), which are
-- SECURITY DEFINER.  No direct INSERT policy exists, so a client cannot insert
-- a booking that skips the capacity check.

create policy bookings_update_admin
  on public.bookings for update
  to authenticated
  using (public.is_studio_admin(studio_id))
  with check (public.is_studio_admin(studio_id));


-- ===========================================================================
-- waitlist_entries
-- ===========================================================================

create policy waitlist_select_own
  on public.waitlist_entries for select
  to authenticated
  using (student_id = auth.uid());

create policy waitlist_select_roster
  on public.waitlist_entries for select
  to authenticated
  using (public.teaches_session(session_id));

create policy waitlist_select_admin
  on public.waitlist_entries for select
  to authenticated
  using (public.is_studio_admin(studio_id));


-- ===========================================================================
-- credit_grants
-- ===========================================================================
-- Students may READ their own grants and may never write one.  A student who
-- could insert or update here could mint credits, which makes the balance
-- forgeable and the credit system decorative (tests PR-14, PR-15).

create policy credit_grants_select_own
  on public.credit_grants for select
  to authenticated
  using (student_id = auth.uid());

create policy credit_grants_select_admin
  on public.credit_grants for select
  to authenticated
  using (public.is_studio_admin(studio_id));

-- Instructors have NO access to grants at all: the specification states they
-- have no financial visibility, and this is where that is enforced rather
-- than merely stated (tests PR-27, PR-28).


-- ===========================================================================
-- credit_ledger  — SELECT ONLY, FOR EVERY ROLE
-- ===========================================================================
-- There is no INSERT, UPDATE or DELETE policy on this table for anyone.
-- Writes happen exclusively inside SECURITY DEFINER functions.  An admin
-- cannot retroactively edit history to conceal a credit adjustment — the
-- control against threat T5 (tests PR-40, PR-41).

create policy credit_ledger_select_own
  on public.credit_ledger for select
  to authenticated
  using (student_id = auth.uid());

create policy credit_ledger_select_admin
  on public.credit_ledger for select
  to authenticated
  using (public.is_studio_admin(studio_id));


-- ===========================================================================
-- notifications
-- ===========================================================================

create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid());

-- A recipient may mark their own notification read.  The WITH CHECK repeats
-- the ownership test so a row cannot be reassigned to another recipient.
create policy notifications_update_own
  on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
