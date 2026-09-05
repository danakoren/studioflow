-- ============================================================================
-- StudioFlow — Seed Data
-- ----------------------------------------------------------------------------
-- Reference: Test Specification §0.5
--
-- LOCAL DEVELOPMENT AND TESTING ONLY.  This file writes directly into
-- auth.users, which is acceptable against a local `supabase start` stack and
-- must NEVER be run against production.
--
-- Two studios are created deliberately.  Studio B exists for one purpose: to
-- give cross-tenant isolation checks a real attacker to work with.
-- run as admin.b@test — a FULL ADMINISTRATOR of another studio, which is the
-- most privileged plausible attacker — and assert they can read nothing.
--
-- All sessions are created RELATIVE TO now().  A fixture with a hard-coded
-- date passes in March and fails in April.
--
-- Every demo account uses the password:  password123
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Temporary helper to create an auth user + identity + profile.
-- Dropped at the end of this script.
-- ---------------------------------------------------------------------------
create or replace function public.__seed_user(
  p_email text,
  p_name  text,
  p_password text default 'password123'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  -- ---------------------------------------------------------------------
  -- THE EMPTY-STRING TOKEN COLUMNS BELOW ARE LOAD-BEARING. DO NOT DROP THEM.
  -- ---------------------------------------------------------------------
  -- GoTrue (the Supabase Auth service) reads these columns into non-nullable
  -- Go strings. Leaving them NULL — which is what they default to when you
  -- INSERT into auth.users by hand — makes the row unreadable to the auth
  -- service, and EVERY sign-in for that user fails with
  --
  --     500  unexpected_failure  "Database error querying schema"
  --
  -- The failure is identical for a correct and an incorrect password, because
  -- it happens while loading the row, before the password is ever compared.
  -- It is also invisible until someone tries to log in: PostgREST reads,
  -- RLS and the whole public schema are entirely unaffected, so the app's
  -- pages work perfectly while authentication is completely broken.
  --
  -- Supabase's own signup path sets these to '' rather than NULL. Seeding by
  -- hand has to do the same.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  )
  values (
    v_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name),
    now(), now(),
    '', '',
    '', '', '',
    '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at,
    created_at, updated_at, email
  )
  values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', p_email),
    'email', now(), now(), now(), p_email
  );

  return v_id;
end;
$$;


do $seed$
declare
  -- Studios
  v_studio_a uuid;
  v_studio_b uuid;

  -- Studio A people
  v_admin_a   uuid;
  v_inst1_a   uuid;
  v_inst2_a   uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid;

  -- Studio B people
  v_admin_b uuid;
  v_s1_b    uuid;

  -- Catalogue
  v_room_main  uuid;
  v_room_small uuid;
  v_room_b     uuid;
  v_ct_vinyasa uuid;
  v_ct_reformer uuid;
  v_ct_prenatal uuid;
  v_ct_b       uuid;

  -- Sessions
  v_sess_future    uuid;   -- 48h away, capacity 2, will be FULL + waitlisted
  v_sess_open      uuid;   -- 72h away, plenty of space
  v_sess_soon      uuid;   -- 6h away  -> inside cancellation window (BR-1)
  v_sess_imminent  uuid;   -- 90m away -> inside promotion cutoff  (BR-3)
  v_sess_tiny      uuid;   -- 24h away, capacity 1 -> race-condition target
  v_sess_past      uuid;   -- ended 2h ago -> attendance marking window open

  v_tz text := 'Asia/Jerusalem';
  i int;
begin
  -- =========================================================================
  -- Studios
  -- =========================================================================
  insert into public.studios (name, slug, timezone, contact_email,
                              cancellation_window_hours, promotion_cutoff_hours)
  values ('Flow Studio', 'flow-studio', v_tz, 'hello@flowstudio.test', 12, 2)
  returning id into v_studio_a;

  insert into public.studios (name, slug, timezone, contact_email)
  values ('Other Studio', 'other-studio', v_tz, 'hello@otherstudio.test')
  returning id into v_studio_b;

  -- =========================================================================
  -- People  (profiles are created automatically by the handle_new_user trigger)
  -- =========================================================================
  v_admin_a := public.__seed_user('admin.a@test',      'Dana Cohen');
  v_inst1_a := public.__seed_user('instructor1.a@test','Yael Bar');
  v_inst2_a := public.__seed_user('instructor2.a@test','Omer Levi');
  v_s1      := public.__seed_user('student1.a@test',   'Noa Shapira');
  v_s2      := public.__seed_user('student2.a@test',   'Itai Golan');
  v_s3      := public.__seed_user('student3.a@test',   'Maya Peretz');
  v_s4      := public.__seed_user('student4.a@test',   'Ron Azulay');
  v_s5      := public.__seed_user('student5.a@test',   'Tamar Ben-David');
  v_s6      := public.__seed_user('student6.a@test',   'Gal Mizrahi');

  v_admin_b := public.__seed_user('admin.b@test',      'Rival Admin');
  v_s1_b    := public.__seed_user('student1.b@test',   'Rival Student');

  -- Memberships
  insert into public.studio_members (studio_id, user_id, role) values
    (v_studio_a, v_admin_a, 'admin'),
    (v_studio_a, v_inst1_a, 'instructor'),
    (v_studio_a, v_inst2_a, 'instructor'),
    (v_studio_a, v_s1, 'student'),
    (v_studio_a, v_s2, 'student'),
    (v_studio_a, v_s3, 'student'),
    (v_studio_a, v_s4, 'student'),
    (v_studio_a, v_s5, 'student'),
    (v_studio_a, v_s6, 'student'),
    (v_studio_b, v_admin_b, 'admin'),
    (v_studio_b, v_s1_b, 'student');

  -- =========================================================================
  -- Rooms and class types
  -- =========================================================================
  insert into public.rooms (studio_id, name, capacity) values
    (v_studio_a, 'Main Studio', 14) returning id into v_room_main;
  insert into public.rooms (studio_id, name, capacity) values
    (v_studio_a, 'Small Studio', 6) returning id into v_room_small;
  insert into public.rooms (studio_id, name, capacity) values
    (v_studio_b, 'Rival Room', 10) returning id into v_room_b;

  insert into public.class_types (studio_id, name, description, duration_minutes, color)
  values (v_studio_a, 'Vinyasa Flow', 'Dynamic breath-led flow.', 60, '#6366f1')
  returning id into v_ct_vinyasa;

  insert into public.class_types (studio_id, name, description, duration_minutes, color)
  values (v_studio_a, 'Reformer Pilates', 'Equipment-based, small group.', 50, '#0ea5e9')
  returning id into v_ct_reformer;

  insert into public.class_types (studio_id, name, description, duration_minutes, color)
  values (v_studio_a, 'Prenatal Yoga', 'Gentle practice for expecting mothers.', 60, '#f59e0b')
  returning id into v_ct_prenatal;

  insert into public.class_types (studio_id, name, duration_minutes)
  values (v_studio_b, 'Rival Class', 60)
  returning id into v_ct_b;

  -- =========================================================================
  -- Credit packages
  -- =========================================================================
  -- Balances are varied deliberately so the fixtures cover every branch:
  --   s1: 10   s2: 5    s3: 2    s4: 1
  --   s5: 0  (INSUFFICIENT_CREDITS path, and the BR-7 "skip" candidate)
  --   s6: 3, expiring in 3 days (credits_expiring notification path)
  insert into public.credit_grants
    (studio_id, student_id, credits_total, credits_remaining, expires_at, note, created_by)
  values
    (v_studio_a, v_s1, 10, 10, now() + interval '90 days', '10-class card', v_admin_a),
    (v_studio_a, v_s2,  5,  5, now() + interval '60 days', '5-class card',  v_admin_a),
    (v_studio_a, v_s3,  2,  2, now() + interval '30 days', 'Trial pack',    v_admin_a),
    (v_studio_a, v_s4,  1,  1, null,                        'Single class',  v_admin_a),
    (v_studio_a, v_s6,  3,  3, now() + interval '3 days',  'Expiring soon', v_admin_a),
    (v_studio_b, v_s1_b, 8, 8, null,                        'Rival pack',    v_admin_b);

  -- Matching ledger entries so INV-2 holds from the very first row.
  insert into public.credit_ledger
    (studio_id, student_id, grant_id, delta, entry_type, note, created_by)
  select g.studio_id, g.student_id, g.id, g.credits_total, 'grant', g.note, g.created_by
  from public.credit_grants g;

  -- =========================================================================
  -- Sessions — all relative to now()
  -- =========================================================================

  -- 48h away, capacity 2. Filled below, then waitlisted.
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_vinyasa, v_room_main, v_inst1_a,
     now() + interval '48 hours', now() + interval '48 hours' + interval '60 minutes',
     2, v_admin_a)
  returning id into v_sess_future;

  -- 72h away, roomy.
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_reformer, v_room_small, v_inst2_a,
     now() + interval '72 hours', now() + interval '72 hours' + interval '50 minutes',
     6, v_admin_a)
  returning id into v_sess_open;

  -- 6h away: INSIDE the 12h cancellation window (BR-2).
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_vinyasa, v_room_main, v_inst1_a,
     now() + interval '6 hours', now() + interval '6 hours' + interval '60 minutes',
     3, v_admin_a)
  returning id into v_sess_soon;

  -- 90m away: INSIDE the 2h promotion cutoff (BR-3).
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_prenatal, v_room_small, v_inst2_a,
     now() + interval '90 minutes', now() + interval '90 minutes' + interval '60 minutes',
     2, v_admin_a)
  returning id into v_sess_imminent;

  -- Capacity 1: the concurrency harness target (DB-02).
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_vinyasa, v_room_small, v_inst1_a,
     now() + interval '24 hours', now() + interval '24 hours' + interval '60 minutes',
     1, v_admin_a)
  returning id into v_sess_tiny;

  -- Ended 2h ago: attendance marking window is open (BR-11).
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_a, v_ct_vinyasa, v_room_main, v_inst1_a,
     now() - interval '3 hours', now() - interval '2 hours',
     14, v_admin_a)
  returning id into v_sess_past;

  -- A month of regular Tuesday classes, generated in LOCAL time so that the
  -- wall-clock hour survives any daylight-saving transition.
  for i in 1 .. 4 loop
    insert into public.sessions
      (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
       capacity, created_by)
    values (
      v_studio_a, v_ct_reformer, v_room_small, v_inst2_a,
      ((now() at time zone v_tz)::date + (i * 7) + time '07:00') at time zone v_tz,
      (((now() at time zone v_tz)::date + (i * 7) + time '07:00') at time zone v_tz)
        + interval '50 minutes',
      6, v_admin_a
    );
  end loop;

  -- Studio B session, so cross-tenant reads have something to fail to reach.
  insert into public.sessions
    (studio_id, class_type_id, room_id, instructor_id, starts_at, ends_at,
     capacity, created_by)
  values
    (v_studio_b, v_ct_b, v_room_b, v_admin_b,
     now() + interval '30 hours', now() + interval '30 hours' + interval '60 minutes',
     10, v_admin_b);

  -- =========================================================================
  -- Bookings and waitlist — the full-with-waitlist scenario, pre-built
  -- =========================================================================
  -- v_sess_future has capacity 2. s1 and s2 are booked (FULL).
  -- s5 (no credits) joins the waitlist FIRST, then s3.
  -- Cancelling s1 must therefore promote s3, SKIPPING s5 — BR-7 in one fixture.

  insert into public.bookings (session_id, student_id, studio_id, status, source)
  values (v_sess_future, v_s1, v_studio_a, 'confirmed', 'self');
  update public.credit_grants set credits_remaining = credits_remaining - 1
    where student_id = v_s1;
  insert into public.credit_ledger
    (studio_id, student_id, grant_id, delta, entry_type, booking_id, session_id, created_by)
  select v_studio_a, v_s1, g.id, -1, 'booking',
         (select id from public.bookings where session_id = v_sess_future and student_id = v_s1),
         v_sess_future, v_s1
  from public.credit_grants g where g.student_id = v_s1;

  insert into public.bookings (session_id, student_id, studio_id, status, source)
  values (v_sess_future, v_s2, v_studio_a, 'confirmed', 'self');
  update public.credit_grants set credits_remaining = credits_remaining - 1
    where student_id = v_s2;
  insert into public.credit_ledger
    (studio_id, student_id, grant_id, delta, entry_type, booking_id, session_id, created_by)
  select v_studio_a, v_s2, g.id, -1, 'booking',
         (select id from public.bookings where session_id = v_sess_future and student_id = v_s2),
         v_sess_future, v_s2
  from public.credit_grants g where g.student_id = v_s2;

  -- Waitlist: s5 first (zero balance -> must be skipped), then s3.
  insert into public.waitlist_entries (session_id, student_id, studio_id, status, joined_at)
  values (v_sess_future, v_s5, v_studio_a, 'waiting', now() - interval '2 hours');
  insert into public.waitlist_entries (session_id, student_id, studio_id, status, joined_at)
  values (v_sess_future, v_s3, v_studio_a, 'waiting', now() - interval '1 hour');

  -- A finished class with an unmarked roster, for the attendance flow.
  insert into public.bookings (session_id, student_id, studio_id, status, source)
  values (v_sess_past, v_s1, v_studio_a, 'confirmed', 'self'),
         (v_sess_past, v_s2, v_studio_a, 'confirmed', 'self'),
         (v_sess_past, v_s4, v_studio_a, 'confirmed', 'self');

  raise notice '--------------------------------------------------------------';
  raise notice 'StudioFlow seed complete.';
  raise notice '  Studio A (Flow Studio):  %', v_studio_a;
  raise notice '  Studio B (Other Studio): %', v_studio_b;
  raise notice '  Password for every demo account: password123';
  raise notice '  Full session (cap 2, 48h out): %', v_sess_future;
  raise notice '  Single-seat session (race test): %', v_sess_tiny;
  raise notice '--------------------------------------------------------------';
end
$seed$;

drop function public.__seed_user(text, text, text);
