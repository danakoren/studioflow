-- ============================================================================
-- StudioFlow — Migration 011: service_role table grants
-- ----------------------------------------------------------------------------
-- Completes migration 010, which fixed the missing base-table GRANTs for `anon`
-- and `authenticated` but left `service_role` with no table privileges at all.
--
-- The symptom was identical in kind to the one 010 fixed, and just as quiet:
--
--     select on public.studios as service_role
--     -> 42501  permission denied for table studios
--
-- What that breaks in practice:
--
--   * registerStudent() — inserts the studio_members row through the service
--     client, because a registering visitor has no session yet and
--     studio_members deliberately has no self-insert policy (PR-21). Without
--     an INSERT grant here, PUBLIC REGISTRATION CANNOT COMPLETE.
--   * createInstructor() — same insert, for an admin-created instructor.
--   * auth.admin.listUsers() and any future direct read from a cron route.
--
-- ---------------------------------------------------------------------------
-- WHY service_role IS NOT SIMPLY GIVEN EVERYTHING
-- ---------------------------------------------------------------------------
-- service_role bypasses RLS, so withholding a privilege from it is not a
-- policy boundary — the real controls are the ESLint import restriction in
-- .eslintrc.json and never shipping the key to a client. But two invariants in
-- the design documents are stated as applying to EVERY role, and a GRANT is
-- the only place left to honour them:
--
--   INV-4  credit_ledger is append-only for everyone, so that a credit
--          adjustment can never be silently rewritten (threat T5). SELECT and
--          INSERT are granted; UPDATE and DELETE are NOT.
--
--   "Nothing is ever hard-deleted" — DELETE is withheld on every table that
--          carries history. Cancellation is a status change, not a removal.
--
-- Those two aside, service_role gets the read and write access the trusted
-- server-side paths actually need.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Reads: unrestricted. service_role bypasses RLS anyway, and the cron jobs
-- and admin flows legitimately need to see across studios.
-- ---------------------------------------------------------------------------
grant select on public.profiles         to service_role;
grant select on public.studios          to service_role;
grant select on public.studio_members   to service_role;
grant select on public.rooms            to service_role;
grant select on public.class_types      to service_role;
grant select on public.sessions         to service_role;
grant select on public.bookings         to service_role;
grant select on public.waitlist_entries to service_role;
grant select on public.credit_grants    to service_role;
grant select on public.credit_ledger    to service_role;
grant select on public.notifications    to service_role;


-- ---------------------------------------------------------------------------
-- studio_members — the write this migration exists for
-- ---------------------------------------------------------------------------
-- INSERT: registerStudent() and createInstructor().
-- UPDATE: clearing must_change_password, deactivating a member.
grant insert, update on public.studio_members to service_role;


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- INSERT is needed because handle_new_user() runs as the trigger owner rather
-- than as service_role, but an admin repair path may still need to backfill a
-- profile for a user created through the Admin API.
grant insert, update on public.profiles to service_role;


-- ---------------------------------------------------------------------------
-- Scheduling and catalogue — admin tooling and cron-driven maintenance
-- ---------------------------------------------------------------------------
grant insert, update on public.rooms            to service_role;
grant insert, update on public.class_types      to service_role;
grant insert, update on public.sessions         to service_role;
grant insert, update on public.bookings         to service_role;
grant insert, update on public.waitlist_entries to service_role;
grant insert, update on public.credit_grants    to service_role;


-- ---------------------------------------------------------------------------
-- notifications — written by the promotion transaction, updated by the
-- email dispatch job to record delivery outcome.
-- ---------------------------------------------------------------------------
grant insert, update on public.notifications to service_role;


-- ---------------------------------------------------------------------------
-- credit_ledger — INSERT ONLY. See INV-4 in the header.
-- ---------------------------------------------------------------------------
grant insert on public.credit_ledger to service_role;
revoke update, delete on public.credit_ledger from service_role;


-- ---------------------------------------------------------------------------
-- Views. security_invoker = true means these evaluate as the CALLER, so
-- granting them to service_role does not widen anything on its own.
-- ---------------------------------------------------------------------------
grant select on public.v_sessions_with_availability to service_role;
grant select on public.v_waitlist_positions         to service_role;
grant select on public.v_student_balances           to service_role;
-- v_grant_ledger_reconciliation was already granted in migration 006.


-- ---------------------------------------------------------------------------
-- Nothing is ever hard-deleted — restated as an explicit REVOKE so a future
-- blanket "grant all to service_role" cannot quietly reintroduce it.
-- ---------------------------------------------------------------------------
revoke delete on public.profiles         from service_role;
revoke delete on public.studio_members   from service_role;
revoke delete on public.sessions         from service_role;
revoke delete on public.bookings         from service_role;
revoke delete on public.waitlist_entries from service_role;
revoke delete on public.credit_grants    from service_role;
