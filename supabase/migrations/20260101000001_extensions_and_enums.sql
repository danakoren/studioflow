-- ============================================================================
-- StudioFlow — Migration 001: Extensions and Enumerated Types
-- ----------------------------------------------------------------------------
-- Reference: Detailed Technical Design §3.1
--
-- NOTE ON search_path:
--   Every function in this project is declared with SET search_path = ''.
--   That means all objects must be schema-qualified (public.x, auth.uid()).
--   pg_catalog is ALWAYS implicitly searched first by PostgreSQL, so built-ins
--   such as now(), count() and jsonb_build_object() need no qualification.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- btree_gist lets a GiST exclusion constraint mix an equality operator on a
-- scalar column (room_id WITH =) with an overlap operator on a range
-- (tstzrange WITH &&).  Without it the constraints in migration 003 cannot be
-- created.  See Detailed Technical Design §3.7.
create extension if not exists btree_gist with schema extensions;

-- pgcrypto is used only by seed.sql to create local demo auth users.
create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

-- Role held by a person WITHIN a studio.  Roles are never global: the same
-- person can be an instructor at one studio and a student at another.
create type public.member_role as enum ('student', 'instructor', 'admin');

-- Lifecycle of a scheduled class instance.  Sessions are never hard-deleted.
create type public.session_status as enum ('scheduled', 'cancelled');

-- Whether a booking exists.  Orthogonal to attendance (see below).
create type public.booking_status as enum ('confirmed', 'cancelled');

-- What actually happened at the class.  Deliberately separate from
-- booking_status so that "cancelled" and "no-show" remain distinguishable.
create type public.attendance_status as enum ('attended', 'absent');

-- How a booking came to exist.  'waitlist_promotion' is what makes the
-- waitlist conversion rate (business goal G1) measurable.
create type public.booking_source as enum ('self', 'admin', 'waitlist_promotion');

-- Lifecycle of a waitlist claim.
create type public.waitlist_status as enum ('waiting', 'promoted', 'left');

-- Every movement of credit is one of these.  The ledger is append-only, so a
-- correction is a new 'adjustment' row and never an edit.
create type public.ledger_entry_type as enum (
  'grant',      -- admin issued a package
  'booking',    -- credit consumed by a booking
  'refund',     -- credit returned by an eligible cancellation
  'expiry',     -- unused credits lapsed (BR-13)
  'adjustment'  -- manual correction, always with a reason
);

-- Lifecycle of a purchased package.
create type public.grant_status as enum ('active', 'exhausted', 'expired');

create type public.notification_type as enum (
  'waitlist_promoted',
  'session_cancelled',
  'session_updated',
  'credits_granted',
  'credits_expiring',
  'booking_confirmed'
);

-- Outbox delivery state.  The notification row itself is the guaranteed
-- in-app channel; email is a projection of it (Architecture §2.2).
create type public.email_status as enum ('pending', 'sent', 'failed', 'skipped');
