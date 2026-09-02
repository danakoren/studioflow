-- ============================================================================
-- StudioFlow — Migration 003: Indexes and Exclusion Constraints
-- ----------------------------------------------------------------------------
-- Reference: Basic Scaling §3.2, Detailed Technical Design §3.7 – §3.12
--
-- Indexes here are not about table size — the whole three-year dataset is a
-- few tens of megabytes.  They exist because an unindexed scan INSIDE a
-- locked transaction extends the lock duration, and the session row lock is
-- the system's real throughput constraint (Scaling §1.3).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- IX-1  bookings: the capacity count inside book_session
-- ---------------------------------------------------------------------------
-- Partial: a booking is 'confirmed' for its whole life or 'cancelled' at the
-- end, and the capacity count only ever asks about confirmed rows.  Cancelled
-- rows leave the index entirely rather than accumulating as dead weight.
create index bookings_session_confirmed_idx
  on public.bookings (session_id)
  where status = 'confirmed';

-- INV-3 / BR-6, enforced structurally: one confirmed booking per student per
-- session.  This is a second, independent guarantee behind book_session's
-- explicit duplicate check.
create unique index bookings_one_confirmed_per_student_idx
  on public.bookings (session_id, student_id)
  where status = 'confirmed';

-- IX-3  student booking history
create index bookings_student_history_idx
  on public.bookings (student_id, booked_at desc);

-- IX-11  the hourly attendance-finalisation job (BR-12)
create index bookings_pending_attendance_idx
  on public.bookings (session_id)
  where status = 'confirmed' and attendance is null;


-- ---------------------------------------------------------------------------
-- IX-2 / IX-8 / IX-12  sessions
-- ---------------------------------------------------------------------------
-- Column order is (studio_id, starts_at) and not the reverse: every schedule
-- query filters on an exact studio and then a time range, so Postgres can
-- seek to the studio and scan the range.  Reversed, it would scan every
-- studio's sessions in that range and filter.
create index sessions_studio_schedule_idx
  on public.sessions (studio_id, starts_at);

create index sessions_instructor_schedule_idx
  on public.sessions (instructor_id, starts_at)
  where status = 'scheduled';

create index sessions_recurrence_group_idx
  on public.sessions (recurrence_group_id)
  where recurrence_group_id is not null;


-- ---------------------------------------------------------------------------
-- Exclusion constraints — INV-7
-- ---------------------------------------------------------------------------
-- Makes a double-booked room or instructor STRUCTURALLY impossible, including
-- for two admins acting concurrently and for the recurrence generator
-- inserting twelve rows in one statement.  Application-level conflict checks
-- cannot make that guarantee.
--
-- '[)' — a class ending at 08:00 and one starting at 08:00 do not overlap.
alter table public.sessions
  add constraint sessions_no_room_overlap
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled');

alter table public.sessions
  add constraint sessions_no_instructor_overlap
  exclude using gist (
    instructor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled');


-- ---------------------------------------------------------------------------
-- IX-4  waitlist: the FIFO promotion selection (BR-7)
-- ---------------------------------------------------------------------------
create index waitlist_session_fifo_idx
  on public.waitlist_entries (session_id, joined_at)
  where status = 'waiting';

-- INV-3 / BR-6: one active waitlist entry per student per session.
create unique index waitlist_one_waiting_per_student_idx
  on public.waitlist_entries (session_id, student_id)
  where status = 'waiting';

create index waitlist_student_idx
  on public.waitlist_entries (student_id, joined_at desc);


-- ---------------------------------------------------------------------------
-- IX-5  credit_grants: earliest-expiring selection and balance
-- ---------------------------------------------------------------------------
create index credit_grants_student_active_idx
  on public.credit_grants (student_id, status, expires_at);

-- The nightly expiry sweep (BR-13).
create index credit_grants_expiring_idx
  on public.credit_grants (expires_at)
  where status = 'active' and expires_at is not null;

create index credit_grants_studio_idx
  on public.credit_grants (studio_id, student_id);


-- ---------------------------------------------------------------------------
-- IX-6  credit_ledger: keyset-paginated history
-- ---------------------------------------------------------------------------
create index credit_ledger_student_history_idx
  on public.credit_ledger (student_id, created_at desc, id desc);

-- Supports INV-2: reconciling a grant against its ledger entries.
create index credit_ledger_grant_idx
  on public.credit_ledger (grant_id)
  where grant_id is not null;

create index credit_ledger_studio_idx
  on public.credit_ledger (studio_id, created_at desc);


-- ---------------------------------------------------------------------------
-- IX-7  studio_members: read on nearly every authenticated request
-- ---------------------------------------------------------------------------
create index studio_members_user_idx
  on public.studio_members (user_id)
  where is_active;


-- ---------------------------------------------------------------------------
-- IX-9 / IX-10  notifications
-- ---------------------------------------------------------------------------
create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The unread badge renders on every authenticated page.  Because most
-- notifications are read, this partial index stays small and permanently
-- cached (Scaling §2.6).
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- The five-minute dispatch job.
create index notifications_pending_email_idx
  on public.notifications (created_at)
  where email_status = 'pending';


-- ---------------------------------------------------------------------------
-- Catalogue lookups
-- ---------------------------------------------------------------------------
create index rooms_studio_idx       on public.rooms (studio_id) where is_active;
create index class_types_studio_idx on public.class_types (studio_id) where is_active;
