-- ============================================================================
-- StudioFlow — Migration 002: Tables
-- ----------------------------------------------------------------------------
-- Reference: Detailed Technical Design §3.2 – §3.12
--
-- Two structural rules apply throughout:
--   1. Nothing is ever hard-deleted.  Every entity uses a soft-delete flag or
--      a terminal status, because a studio owner investigating a credit
--      dispute needs the cancelled row to still exist.
--   2. Composite foreign keys are used to make denormalised tenant columns
--      provably consistent rather than merely conventionally correct.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- profiles — public projection of auth.users
-- ---------------------------------------------------------------------------
-- auth.users is managed by Supabase and is not a safe place for application
-- columns or for foreign keys from application tables.  profiles is.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null check (char_length(full_name) between 2 and 100),
  email       text        not null,
  phone       text        check (phone is null or char_length(phone) between 6 and 30),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application-visible identity. Populated automatically by handle_new_user().';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- Create a profile automatically whenever Supabase Auth creates a user, so
-- that a profile always exists for an authenticated identity.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New Member'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- studios — the tenant, and the home of every configurable business rule
-- ---------------------------------------------------------------------------
-- No policy constant is hard-coded in application code.  A studio changing its
-- cancellation window is a data change, not a deployment.
create table public.studios (
  id                           uuid primary key default gen_random_uuid(),
  name                         text        not null check (char_length(name) between 2 and 120),
  slug                         text        not null unique
                                 check (slug ~ '^[a-z0-9-]{2,60}$'),
  timezone                     text        not null default 'Asia/Jerusalem',
  contact_email                text,
  contact_phone                text,

  -- BR-1 / BR-2: cancelling at or before this many hours returns the credit.
  cancellation_window_hours    int         not null default 12
                                 check (cancellation_window_hours between 0 and 168),

  -- BR-3: no automatic waitlist promotion inside this many hours.
  promotion_cutoff_hours       int         not null default 2
                                 check (promotion_cutoff_hours between 0 and 48),

  -- BR-11: how long after a class ends attendance may still be marked.
  attendance_window_hours      int         not null default 24
                                 check (attendance_window_hours between 1 and 168),

  -- BR-12: unmarked bookings resolve to this.  Defaults to 'attended' so that
  -- an instructor's administrative oversight never costs a student a credit.
  unmarked_attendance_default  public.attendance_status not null default 'attended',

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create trigger studios_set_updated_at
  before update on public.studios
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- studio_members — THE source of truth for authorisation
-- ---------------------------------------------------------------------------
create table public.studio_members (
  id                    uuid primary key default gen_random_uuid(),
  studio_id             uuid not null references public.studios (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  role                  public.member_role not null default 'student',
  is_active             boolean not null default true,

  -- Set true when an admin creates an instructor account with a temporary
  -- password (Security §1.6).  Forces rotation at first login.
  must_change_password  boolean not null default false,

  joined_at             timestamptz not null default now(),

  constraint studio_members_unique_person unique (studio_id, user_id)
);

-- Referenced by composite foreign keys below to prove that a booking's
-- student really is a member of that booking's studio.
alter table public.studio_members
  add constraint studio_members_studio_user_key unique (studio_id, user_id, id);


-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studios (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  capacity   int  not null check (capacity between 1 and 200),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  constraint rooms_unique_name unique (studio_id, name),
  -- Needed so sessions can carry a composite FK proving the room belongs to
  -- the same studio as the session.
  constraint rooms_studio_key unique (id, studio_id)
);


-- ---------------------------------------------------------------------------
-- class_types
-- ---------------------------------------------------------------------------
create table public.class_types (
  id               uuid primary key default gen_random_uuid(),
  studio_id        uuid not null references public.studios (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  description      text check (description is null or char_length(description) <= 500),
  duration_minutes int  not null check (duration_minutes between 15 and 240),
  color            text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),

  constraint class_types_unique_name unique (studio_id, name),
  constraint class_types_studio_key unique (id, studio_id)
);


-- ---------------------------------------------------------------------------
-- sessions — the bookable unit
-- ---------------------------------------------------------------------------
create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  studio_id           uuid not null references public.studios (id) on delete cascade,
  class_type_id       uuid not null,
  room_id             uuid not null,
  instructor_id       uuid not null references public.profiles (id),

  -- BR-14: always UTC.  Rendered in the studio's timezone at display time.
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,

  -- Copied from the room at creation, NOT read through it.  Changing a room's
  -- capacity later must not silently resize sessions that already hold
  -- bookings (Detailed Technical Design §3.7).
  capacity            int not null check (capacity between 1 and 200),

  status              public.session_status not null default 'scheduled',
  cancellation_reason text check (cancellation_reason is null
                                  or char_length(cancellation_reason) <= 500),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id),

  -- Links sessions generated by one recurrence operation.
  recurrence_group_id uuid,

  created_at          timestamptz not null default now(),
  created_by          uuid not null references public.profiles (id),

  constraint sessions_ends_after_starts check (ends_at > starts_at),

  -- These composite FKs guarantee the room and class type belong to the same
  -- studio as the session.  Without them a cross-tenant reference is possible
  -- through a direct insert.
  constraint sessions_room_same_studio
    foreign key (room_id, studio_id) references public.rooms (id, studio_id),
  constraint sessions_class_type_same_studio
    foreign key (class_type_id, studio_id) references public.class_types (id, studio_id),

  -- Referenced by bookings and waitlist_entries to prove their denormalised
  -- studio_id matches the session's.
  constraint sessions_studio_key unique (id, studio_id)
);


-- ---------------------------------------------------------------------------
-- credit_grants — a purchased package
-- ---------------------------------------------------------------------------
-- Design amendment recorded in Detailed Technical Design §0.1: per-grant
-- expiry (BR-13) cannot be derived from a flat signed ledger without
-- reconstructing FIFO allocation on every read, so grants are first-class
-- rows.  The ledger remains the append-only audit authority; INV-2 asserts
-- the two agree.
create table public.credit_grants (
  id                uuid primary key default gen_random_uuid(),
  studio_id         uuid not null,
  student_id        uuid not null,
  credits_total     int  not null check (credits_total between 1 and 500),
  credits_remaining int  not null,
  expires_at        timestamptz,
  status            public.grant_status not null default 'active',
  note              text check (note is null or char_length(note) <= 500),
  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),

  -- Makes over-consumption impossible at the storage layer, independently of
  -- whether book_session's logic is correct.
  constraint credit_grants_remaining_in_range
    check (credits_remaining >= 0 and credits_remaining <= credits_total),

  -- Proves the student is actually a member of this studio.
  constraint credit_grants_member
    foreign key (studio_id, student_id)
    references public.studio_members (studio_id, user_id) on delete cascade
);


-- ---------------------------------------------------------------------------
-- bookings — a student's seat
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                       uuid primary key default gen_random_uuid(),
  session_id               uuid not null,
  student_id               uuid not null references public.profiles (id),

  -- Denormalised so RLS policies filter without joining to sessions on the
  -- highest-traffic table in the system (Scaling §2.7).  The composite FK
  -- below makes the denormalisation provably consistent.
  studio_id                uuid not null,

  status                   public.booking_status not null default 'confirmed',
  attendance               public.attendance_status,
  source                   public.booking_source not null default 'self',

  booked_at                timestamptz not null default now(),
  cancelled_at             timestamptz,
  cancelled_by             uuid references public.profiles (id),
  credit_refunded          boolean not null default false,

  attendance_marked_at     timestamptz,
  attendance_marked_by     uuid references public.profiles (id),
  -- Distinguishes an instructor's explicit mark from the BR-12 default, which
  -- keeps the no-show report honest.
  attendance_auto_resolved boolean not null default false,

  constraint bookings_session_same_studio
    foreign key (session_id, studio_id) references public.sessions (id, studio_id),
  constraint bookings_member
    foreign key (studio_id, student_id)
    references public.studio_members (studio_id, user_id),

  -- A cancelled booking must record when and by whom.
  constraint bookings_cancellation_consistent
    check ((status = 'cancelled') = (cancelled_at is not null))
);


-- ---------------------------------------------------------------------------
-- waitlist_entries — a queued claim.  Consumes no credit.
-- ---------------------------------------------------------------------------
-- Position is NOT stored.  A stored position must be renumbered whenever
-- anyone leaves, which is a write-amplification problem and a source of gaps
-- under concurrency.  It is derived from joined_at instead.
create table public.waitlist_entries (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null,
  student_id          uuid not null references public.profiles (id),
  studio_id           uuid not null,
  status              public.waitlist_status not null default 'waiting',
  joined_at           timestamptz not null default now(),
  promoted_at         timestamptz,
  promoted_booking_id uuid references public.bookings (id),
  left_at             timestamptz,

  constraint waitlist_session_same_studio
    foreign key (session_id, studio_id) references public.sessions (id, studio_id),
  constraint waitlist_member
    foreign key (studio_id, student_id)
    references public.studio_members (studio_id, user_id)
);


-- ---------------------------------------------------------------------------
-- credit_ledger — append-only audit of every credit movement
-- ---------------------------------------------------------------------------
-- No role, including admin, has an UPDATE or DELETE policy on this table
-- (INV-4).  A correction is a new 'adjustment' row.  This is the control
-- against a studio owner silently rewriting history.
create table public.credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null,
  student_id  uuid not null,
  grant_id    uuid references public.credit_grants (id),
  delta       int  not null check (delta <> 0),
  entry_type  public.ledger_entry_type not null,
  booking_id  uuid references public.bookings (id),
  session_id  uuid,
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid references public.profiles (id),   -- null means system/job
  created_at  timestamptz not null default now(),

  constraint credit_ledger_member
    foreign key (studio_id, student_id)
    references public.studio_members (studio_id, user_id)
);


-- ---------------------------------------------------------------------------
-- notifications — in-app feed AND transactional email outbox
-- ---------------------------------------------------------------------------
-- One table for both, deliberately.  The row is written inside the promotion
-- transaction and therefore cannot be lost; email is a later projection of
-- it.  If the mail provider is down the student still sees the notification
-- (Architecture principle 5, assumption A4).
create table public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null references public.studios (id) on delete cascade,
  recipient_id       uuid not null references public.profiles (id) on delete cascade,
  type               public.notification_type not null,
  title              text not null check (char_length(title) <= 200),
  body               text not null check (char_length(body) <= 2000),
  payload            jsonb not null default '{}'::jsonb,
  related_session_id uuid references public.sessions (id) on delete set null,
  read_at            timestamptz,

  email_status       public.email_status not null default 'pending',
  email_attempts     int  not null default 0 check (email_attempts >= 0),
  email_sent_at      timestamptz,
  last_error         text,

  created_at         timestamptz not null default now()
);
