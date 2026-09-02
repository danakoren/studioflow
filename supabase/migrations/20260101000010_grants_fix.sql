-- ============================================================================
-- StudioFlow — Migration 010: Base Table Grants (fix)
-- ----------------------------------------------------------------------------
-- Bug: migrations 001-009 enable RLS and write policies for every table
-- (migration 005), and GRANT SELECT on the views and EXECUTE on the functions
-- built on top of them (migrations 004, 006, 007, 008, 009) — but never GRANT
-- any privilege on the base tables themselves to `anon` / `authenticated`.
--
-- RLS and GRANT are two independent gates in Postgres:
--   - GRANT decides whether a role may touch a relation AT ALL. Missing it
--     fails the whole statement with 42501 ("permission denied for table
--     x"), before RLS is ever evaluated.
--   - RLS policies (migration 005) then decide which ROWS are visible/
--     writable once the GRANT gate is passed.
--
-- Without table-level GRANTs, every query against a base table 42501s — this
-- surfaced as opaque `{}` errors in the app (getPrimaryStudio, then
-- getScheduleRange, and it would have continued through every other
-- lib/data/*.queries.ts function next) because those catch blocks log the
-- PostgrestError object, which stringifies to `{}` in most loggers.
--
-- This migration is additive only: it grants nothing that migration 005's
-- policies don't already gate, and it does not touch any policy. Where 005
-- already REVOKEd a privilege (credit_ledger UPDATE/DELETE; DELETE on
-- bookings, sessions, waitlist_entries, credit_grants, profiles,
-- studio_members) that privilege is deliberately NOT re-granted here.
--
-- One nuance worth calling out: `bookings` and `waitlist_entries` get SELECT
-- granted to `anon` even though neither has an `anon` RLS policy. That is
-- required so that v_sessions_with_availability — already granted to anon in
-- migration 006, and the public /schedule page's data source
-- (sessions_select_public_schedule has NO LOGIN WALL by design) — can
-- execute its lateral COUNT(*) subqueries over those tables at all under
-- security_invoker. It grants no row visibility: with no matching anon
-- policy, RLS still returns zero rows to anon on any direct query against
-- either table, so this only stops the aggregate query from being rejected
-- outright — it discloses nothing beyond the count the view already exposes.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- SELECT: own row, own roster (as instructor), instructor names on the public
-- schedule (anon+authenticated), studio admin — see policies profiles_select_*.
grant select on public.profiles to anon, authenticated;
-- UPDATE: own row only (profiles_update_own). No INSERT grant: rows are
-- created exclusively by the handle_new_user() trigger (SECURITY DEFINER).
grant update on public.profiles to authenticated;


-- ---------------------------------------------------------------------------
-- studios
-- ---------------------------------------------------------------------------
-- SELECT: public (studios_select_public). This is the "quick unblock" already
-- applied by hand; restated here so the migration history is authoritative.
grant select on public.studios to anon, authenticated;
-- UPDATE: studio admin only (studios_update_admin). No INSERT/DELETE policy
-- exists, so none is granted.
grant update on public.studios to authenticated;


-- ---------------------------------------------------------------------------
-- studio_members
-- ---------------------------------------------------------------------------
-- No anon policy anywhere on this table — no anon grant.
grant select on public.studio_members to authenticated;         -- own row + admin
grant insert on public.studio_members to authenticated;         -- admin only (insert_admin)
grant update on public.studio_members to authenticated;         -- admin only (update_admin)
-- DELETE intentionally not granted (revoked explicitly in migration 005, and
-- there is deliberately no update-own-row policy either — see that file's
-- comment on why membership self-service would collapse the auth model).


-- ---------------------------------------------------------------------------
-- rooms / class_types
-- ---------------------------------------------------------------------------
-- SELECT: active rooms/class types are public; inactive ones are member-only,
-- filtered by the *_select policies either way.
grant select on public.rooms to anon, authenticated;
grant select on public.class_types to anon, authenticated;
-- The *_write_admin policies are `for all` (insert/update/delete), scoped to
-- studio admins, so all three are granted — rooms/class_types are configuration
-- data, not booking history, and were never covered by migration 005's
-- soft-delete-only revokes.
grant insert, update, delete on public.rooms to authenticated;
grant insert, update, delete on public.class_types to authenticated;


-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
-- SELECT: public schedule (status = 'scheduled', no login wall) plus full
-- visibility for studio members.
grant select on public.sessions to anon, authenticated;
-- INSERT/UPDATE: studio admin (sessions_insert_admin, sessions_update_admin)
-- and an instructor updating only sessions they teach (sessions_update_own_taught).
grant insert, update on public.sessions to authenticated;
-- DELETE intentionally not granted — revoked in migration 005 (nothing is
-- ever hard-deleted; cancellation is a status change).


-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
-- SELECT: see the file header note above re: anon + v_sessions_with_availability.
-- Direct anon access to booking rows remains fully blocked by RLS.
grant select on public.bookings to anon, authenticated;
-- UPDATE: studio admin only (bookings_update_admin).
grant update on public.bookings to authenticated;
-- No INSERT grant: bookings are created exclusively by book_session() /
-- admin_book_student(), both SECURITY DEFINER — there is deliberately no
-- INSERT policy, so a client can never insert a booking that skips the
-- capacity check. DELETE intentionally not granted (revoked in migration 005).


-- ---------------------------------------------------------------------------
-- waitlist_entries
-- ---------------------------------------------------------------------------
-- SELECT: same reasoning as bookings — anon needed only for the view's
-- waiting_count lateral subquery; RLS blocks all direct anon row access.
grant select on public.waitlist_entries to anon, authenticated;
-- No INSERT/UPDATE grant: join_waitlist() / leave_waitlist() are SECURITY
-- DEFINER and are the only path that writes this table. DELETE intentionally
-- not granted (revoked in migration 005).


-- ---------------------------------------------------------------------------
-- credit_grants
-- ---------------------------------------------------------------------------
-- Not part of any public view — no anon grant anywhere on this table.
grant select on public.credit_grants to authenticated;           -- own + admin
-- No INSERT/UPDATE grant: grant_credits() / adjust_credits() / refund logic
-- are all SECURITY DEFINER. DELETE intentionally not granted (revoked in
-- migration 005; a grant is corrected with an adjustment row, never edited).


-- ---------------------------------------------------------------------------
-- credit_ledger — SELECT ONLY, for every role, forever
-- ---------------------------------------------------------------------------
-- INV-4: no role, including admin, may rewrite ledger history. Migration 005
-- already revoked UPDATE/DELETE from anon+authenticated; this file adds
-- nothing beyond SELECT, and there is no anon policy so no anon grant.
grant select on public.credit_ledger to authenticated;           -- own + admin


-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
-- Not part of any public view — no anon grant.
grant select on public.notifications to authenticated;           -- own only
grant update on public.notifications to authenticated;           -- own only, mark-read
-- No INSERT grant: rows are written exclusively inside the promotion/booking
-- transaction and by the job functions in migration 008, all SECURITY DEFINER.
