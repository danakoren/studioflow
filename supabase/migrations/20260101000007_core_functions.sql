-- ============================================================================
-- StudioFlow — Migration 007: Core Business Logic
-- ----------------------------------------------------------------------------
-- Reference: Detailed Technical Design §5.2 – §5.4
--
-- These functions hold the operations that MUST be atomic.  They live in
-- PostgreSQL rather than TypeScript for a reason that is worth restating,
-- because it is the decision most likely to be questioned:
--
--   The natural TypeScript implementation reads the booking count, compares
--   it to capacity, and inserts if there is room.  Between the read and the
--   insert, another request completes the identical sequence.  Both observe
--   13 of 14 seats taken.  Both insert.  The room now holds 15 bookings for
--   14 mats.
--
--   This is not a rare theoretical case.  It is the EXPECTED case at exactly
--   the moment it matters most — the last seat of a popular class, when
--   several students tap simultaneously and Vercel runs their requests as
--   genuinely parallel serverless invocations.
--
--   SELECT ... FOR UPDATE on the session row serialises the contenders.  The
--   second transaction waits at the lock; when it proceeds it observes the
--   first transaction's insert and correctly fails the capacity check.
--
-- A secondary benefit follows from the placement: because the rule lives in
-- the database, it holds for EVERY caller — a Server Action, a cron job, or
-- an administrator running SQL in the Supabase console.  A rule enforced only
-- in application code protects only the paths that remember to call it.
--
-- CONVENTION: these functions return jsonb { ok, error_code, ... } rather than
-- raising.  A full class and an insufficient balance are normal outcomes a
-- user must be told about clearly, not exceptions.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Internal: append a ledger row.  Never called directly by clients.
-- ---------------------------------------------------------------------------
create or replace function public.__ledger_append(
  p_studio_id  uuid,
  p_student_id uuid,
  p_grant_id   uuid,
  p_delta      int,
  p_type       public.ledger_entry_type,
  p_booking_id uuid default null,
  p_session_id uuid default null,
  p_note       text default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.credit_ledger (
    studio_id, student_id, grant_id, delta, entry_type,
    booking_id, session_id, note, created_by
  )
  values (
    p_studio_id, p_student_id, p_grant_id, p_delta, p_type,
    p_booking_id, p_session_id, p_note, p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Internal: consume one credit from the earliest-expiring eligible grant.
-- ---------------------------------------------------------------------------
-- Returns the grant id, or null if the student has no available credit.
-- The caller is responsible for having locked the session row first.
create or replace function public.__consume_credit(p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.credit_grants%rowtype;
begin
  -- Earliest-expiring first (NULLs — non-expiring packages — last), then
  -- oldest.  FOR UPDATE prevents two concurrent bookings by the same student
  -- from both drawing the final credit of one grant.
  select * into v_grant
  from public.credit_grants g
  where g.student_id = p_student_id
    and g.status = 'active'
    and g.credits_remaining > 0
    and (g.expires_at is null or g.expires_at > now())
  order by g.expires_at asc nulls last, g.created_at asc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  update public.credit_grants
  set credits_remaining = credits_remaining - 1,
      status = case when credits_remaining - 1 = 0 then 'exhausted'::public.grant_status
                    else status end
  where id = v_grant.id;

  return v_grant.id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Internal: return one credit to the grant it originally came from.
-- ---------------------------------------------------------------------------
-- Refunding to the ORIGINATING grant rather than as a floating credit
-- preserves that package's expiry date.  A generic credit would silently
-- extend the value of an expiring package.
create or replace function public.__refund_credit(p_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.credit_grants%rowtype;
begin
  if p_grant_id is null then
    return false;
  end if;

  select * into v_grant
  from public.credit_grants
  where id = p_grant_id
  for update;

  if not found or v_grant.credits_remaining >= v_grant.credits_total then
    return false;
  end if;

  update public.credit_grants
  set credits_remaining = credits_remaining + 1,
      status = case
                 when status = 'exhausted' then 'active'::public.grant_status
                 else status
               end
  where id = p_grant_id;

  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- Internal: queue a notification (outbox row).
-- ---------------------------------------------------------------------------
-- This writes a ROW.  It does not send an email.  External I/O never happens
-- inside a transaction: an email send inside cancel_booking would add
-- 100–300ms of network latency WHILE HOLDING THE SESSION LOCK, and a provider
-- outage would roll back a legitimate cancellation.
create or replace function public.__notify(
  p_studio_id    uuid,
  p_recipient_id uuid,
  p_type         public.notification_type,
  p_title        text,
  p_body         text,
  p_session_id   uuid default null,
  p_payload      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (
    studio_id, recipient_id, type, title, body, related_session_id, payload
  )
  values (
    p_studio_id, p_recipient_id, p_type, p_title, p_body, p_session_id, p_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ===========================================================================
-- book_session — the atomic booking transaction
-- ===========================================================================
create or replace function public.book_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_session    public.sessions%rowtype;
  v_confirmed  int;
  v_grant_id   uuid;
  v_booking_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  -- STEP 1 — Lock the session row.  This is the entire correctness argument.
  -- A second caller for the final seat blocks here until the first commits,
  -- then observes the new count at step 4 and correctly receives SESSION_FULL.
  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  end if;

  -- STEP 2 — Session must be bookable.
  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_CANCELLED');
  end if;

  -- BR-8
  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_STARTED');
  end if;

  -- STEP 3 — Caller must be an active member of this studio.
  if not public.is_studio_member(v_session.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  -- STEP 4 — Capacity (BR-5).  Read under the lock taken in step 1.
  select count(*) into v_confirmed
  from public.bookings
  where session_id = p_session_id
    and status = 'confirmed';

  if v_confirmed >= v_session.capacity then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_FULL');
  end if;

  -- STEP 5 — No duplicate booking or waitlist entry (BR-6).
  -- The partial unique index bookings_one_confirmed_per_student_idx is a
  -- second, independent guarantee behind this check.
  if exists (
    select 1 from public.bookings
    where session_id = p_session_id
      and student_id = v_user
      and status = 'confirmed'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_BOOKED');
  end if;

  if exists (
    select 1 from public.waitlist_entries
    where session_id = p_session_id
      and student_id = v_user
      and status = 'waiting'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_WAITLISTED');
  end if;

  -- STEP 6 — Consume a credit (BR-4).
  v_grant_id := public.__consume_credit(v_user);
  if v_grant_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'INSUFFICIENT_CREDITS');
  end if;

  -- STEP 7 — Create the booking and its ledger entry together.
  insert into public.bookings (session_id, student_id, studio_id, status, source)
  values (p_session_id, v_user, v_session.studio_id, 'confirmed', 'self')
  returning id into v_booking_id;

  perform public.__ledger_append(
    v_session.studio_id, v_user, v_grant_id, -1, 'booking',
    v_booking_id, p_session_id, null, v_user
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'new_balance', public.student_balance(v_user)
  );
end;
$$;


-- ===========================================================================
-- join_waitlist
-- ===========================================================================
create or replace function public.join_waitlist(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_session   public.sessions%rowtype;
  v_confirmed int;
  v_entry_id  uuid;
  v_position  int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_CANCELLED');
  end if;

  if v_session.starts_at <= now() then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_STARTED');
  end if;

  if not public.is_studio_member(v_session.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  -- A waitlist only makes sense for a full session; otherwise offer booking.
  select count(*) into v_confirmed
  from public.bookings
  where session_id = p_session_id and status = 'confirmed';

  if v_confirmed < v_session.capacity then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FULL');
  end if;

  -- BR-6
  if exists (
    select 1 from public.bookings
    where session_id = p_session_id and student_id = v_user and status = 'confirmed'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_BOOKED');
  end if;

  if exists (
    select 1 from public.waitlist_entries
    where session_id = p_session_id and student_id = v_user and status = 'waiting'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_WAITLISTED');
  end if;

  -- NO CREDIT IS DEDUCTED.  A waitlist entry is a claim, not a booking.
  insert into public.waitlist_entries (session_id, student_id, studio_id, status)
  values (p_session_id, v_user, v_session.studio_id, 'waiting')
  returning id into v_entry_id;

  select count(*)::int into v_position
  from public.waitlist_entries
  where session_id = p_session_id and status = 'waiting';

  return jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'position', v_position);
end;
$$;


-- ===========================================================================
-- leave_waitlist
-- ===========================================================================
create or replace function public.leave_waitlist(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_entry public.waitlist_entries%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_entry
  from public.waitlist_entries
  where id = p_entry_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'ENTRY_NOT_FOUND');
  end if;

  if v_entry.student_id <> v_user and not public.is_studio_admin(v_entry.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if v_entry.status <> 'waiting' then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_LEFT');
  end if;

  update public.waitlist_entries
  set status = 'left', left_at = now()
  where id = p_entry_id;

  return jsonb_build_object('ok', true);
end;
$$;


-- ===========================================================================
-- __promote_from_waitlist — internal, assumes the session row is ALREADY
-- locked by the caller.
-- ===========================================================================
create or replace function public.__promote_from_waitlist(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session    public.sessions%rowtype;
  v_candidate  public.waitlist_entries%rowtype;
  v_grant_id   uuid;
  v_booking_id uuid;
  v_class_name text;
begin
  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  -- BR-3: inside the promotion cutoff, do nothing.  Notifying someone ninety
  -- minutes before a 07:00 class is not a service; the seat simply stays open
  -- for direct booking.
  if v_session.starts_at - now()
     < make_interval(hours =>
         (select promotion_cutoff_hours from public.studios where id = v_session.studio_id))
  then
    return null;
  end if;

  -- BR-7: strict FIFO by join time, SKIPPING candidates without credit.
  -- Skipping rather than stalling matters: a waitlisted student who has run
  -- out of credits must not block the queue, or the seat stays empty and the
  -- entire business goal of the waitlist is defeated.
  for v_candidate in
    select *
    from public.waitlist_entries
    where session_id = p_session_id
      and status = 'waiting'
    order by joined_at asc, id asc
    for update
  loop
    v_grant_id := public.__consume_credit(v_candidate.student_id);

    if v_grant_id is not null then
      insert into public.bookings (session_id, student_id, studio_id, status, source)
      values (p_session_id, v_candidate.student_id, v_session.studio_id,
              'confirmed', 'waitlist_promotion')
      returning id into v_booking_id;

      update public.waitlist_entries
      set status = 'promoted',
          promoted_at = now(),
          promoted_booking_id = v_booking_id
      where id = v_candidate.id;

      perform public.__ledger_append(
        v_session.studio_id, v_candidate.student_id, v_grant_id, -1, 'booking',
        v_booking_id, p_session_id, 'Waitlist promotion', null
      );

      select ct.name into v_class_name
      from public.class_types ct where ct.id = v_session.class_type_id;

      -- Outbox row only.  The email is sent later by the dispatch job.
      perform public.__notify(
        v_session.studio_id,
        v_candidate.student_id,
        'waitlist_promoted',
        'You got a spot!',
        format('A place opened in %s and you have been moved off the waitlist. Your seat is confirmed.',
               coalesce(v_class_name, 'your class')),
        p_session_id,
        jsonb_build_object('booking_id', v_booking_id, 'starts_at', v_session.starts_at)
      );

      return v_booking_id;
    end if;
    -- No credit: skip this candidate, leave the entry 'waiting', try the next.
  end loop;

  return null;
end;
$$;


-- ===========================================================================
-- cancel_booking — cancel, refund per policy, then refill the seat
-- ===========================================================================
create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user        uuid := auth.uid();
  v_booking     public.bookings%rowtype;
  v_session     public.sessions%rowtype;
  v_window      int;
  v_refundable  boolean := false;
  v_grant_id    uuid;
  v_promoted    uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_NOT_FOUND');
  end if;

  -- Lock the SESSION, not the booking: promotion below inserts a new booking
  -- for this session, and every contender must serialise on the same row.
  select * into v_session
  from public.sessions
  where id = v_booking.session_id
  for update;

  if v_booking.student_id <> v_user and not public.is_studio_admin(v_booking.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  -- Idempotent: a double-click must not produce a second refund.
  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_CANCELLED');
  end if;

  -- BR-1 / BR-2: refund eligibility is "at or before" the window.
  select cancellation_window_hours into v_window
  from public.studios where id = v_booking.studio_id;

  v_refundable := (v_session.starts_at - now()) >= make_interval(hours => v_window);

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_user,
      credit_refunded = v_refundable
  where id = p_booking_id;

  if v_refundable then
    -- Find the grant this booking originally drew from.
    select grant_id into v_grant_id
    from public.credit_ledger
    where booking_id = p_booking_id
      and entry_type = 'booking'
    order by created_at asc
    limit 1;

    if public.__refund_credit(v_grant_id) then
      perform public.__ledger_append(
        v_booking.studio_id, v_booking.student_id, v_grant_id, 1, 'refund',
        p_booking_id, v_booking.session_id, 'Cancelled outside policy window', v_user
      );
    end if;
  end if;

  -- Refill the seat.  Note this happens even when the credit was forfeited:
  -- a late cancellation still frees a mat, and G1 says fill it.
  v_promoted := public.__promote_from_waitlist(v_booking.session_id);

  return jsonb_build_object(
    'ok', true,
    'refunded', v_refundable,
    'promoted_booking_id', v_promoted,
    'new_balance', public.student_balance(v_booking.student_id)
  );
end;
$$;


-- ===========================================================================
-- cancel_session — studio-side cancellation (Flow 8)
-- ===========================================================================
create or replace function public.cancel_session(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_session    public.sessions%rowtype;
  v_booking    record;
  v_entry      record;
  v_grant_id   uuid;
  v_refunded   int := 0;
  v_notified   int := 0;
  v_class_name text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  end if;

  -- An admin of the studio, or the instructor who teaches this session.
  if not (public.is_studio_admin(v_session.studio_id)
          or v_session.instructor_id = v_user) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_CANCELLED');
  end if;

  select ct.name into v_class_name
  from public.class_types ct where ct.id = v_session.class_type_id;

  update public.sessions
  set status = 'cancelled',
      cancellation_reason = p_reason,
      cancelled_at = now(),
      cancelled_by = v_user
  where id = p_session_id;

  -- BR-9: ALL booked students are refunded regardless of the cancellation
  -- window.  The studio's cancellation is not the student's fault.
  for v_booking in
    select * from public.bookings
    where session_id = p_session_id and status = 'confirmed'
    for update
  loop
    select grant_id into v_grant_id
    from public.credit_ledger
    where booking_id = v_booking.id and entry_type = 'booking'
    order by created_at asc limit 1;

    update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_user,
        credit_refunded = true
    where id = v_booking.id;

    if public.__refund_credit(v_grant_id) then
      perform public.__ledger_append(
        v_session.studio_id, v_booking.student_id, v_grant_id, 1, 'refund',
        v_booking.id, p_session_id, 'Studio cancelled the class', v_user
      );
      v_refunded := v_refunded + 1;
    end if;

    perform public.__notify(
      v_session.studio_id, v_booking.student_id, 'session_cancelled',
      'Class cancelled',
      format('%s has been cancelled. Your credit has been returned.',
             coalesce(v_class_name, 'Your class')),
      p_session_id,
      jsonb_build_object('reason', p_reason)
    );
    v_notified := v_notified + 1;
  end loop;

  -- Waitlisted students are told too — they were waiting for a class that is
  -- no longer happening.
  for v_entry in
    select * from public.waitlist_entries
    where session_id = p_session_id and status = 'waiting'
    for update
  loop
    update public.waitlist_entries
    set status = 'left', left_at = now()
    where id = v_entry.id;

    perform public.__notify(
      v_session.studio_id, v_entry.student_id, 'session_cancelled',
      'Class cancelled',
      format('%s has been cancelled. You were on the waitlist and no credit was charged.',
             coalesce(v_class_name, 'The class')),
      p_session_id,
      jsonb_build_object('reason', p_reason)
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'refunded_count', v_refunded, 'notified_count', v_notified
  );
end;
$$;


-- ===========================================================================
-- mark_attendance
-- ===========================================================================
create or replace function public.mark_attendance(
  p_booking_id uuid,
  p_attendance public.attendance_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_session public.sessions%rowtype;
  v_window  int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_NOT_FOUND');
  end if;

  select * into v_session from public.sessions where id = v_booking.session_id;

  if not (public.teaches_session(v_session.id)
          or public.is_studio_admin(v_session.studio_id)) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_CANCELLED');
  end if;

  -- BR-11: from session start until the studio's window after it ends.
  select attendance_window_hours into v_window
  from public.studios where id = v_session.studio_id;

  if now() < v_session.starts_at
     or now() > v_session.ends_at + make_interval(hours => v_window) then
    return jsonb_build_object('ok', false, 'error_code', 'ATTENDANCE_WINDOW_CLOSED');
  end if;

  -- BR-10: a no-show forfeits the credit.  There is deliberately no refund
  -- path here — attendance is a record, not a transaction.
  update public.bookings
  set attendance = p_attendance,
      attendance_marked_at = now(),
      attendance_marked_by = v_user,
      attendance_auto_resolved = false
  where id = p_booking_id;

  return jsonb_build_object('ok', true);
end;
$$;


-- ===========================================================================
-- grant_credits — admin issues a package
-- ===========================================================================
create or replace function public.grant_credits(
  p_student_id uuid,
  p_studio_id  uuid,
  p_credits    int,
  p_expires_at timestamptz default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_grant_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_studio_admin(p_studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if p_credits is null or p_credits < 1 or p_credits > 500 then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED');
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED');
  end if;

  if not exists (
    select 1 from public.studio_members
    where studio_id = p_studio_id and user_id = p_student_id and is_active
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'MEMBER_NOT_FOUND');
  end if;

  insert into public.credit_grants (
    studio_id, student_id, credits_total, credits_remaining,
    expires_at, note, created_by
  )
  values (p_studio_id, p_student_id, p_credits, p_credits,
          p_expires_at, p_note, v_user)
  returning id into v_grant_id;

  perform public.__ledger_append(
    p_studio_id, p_student_id, v_grant_id, p_credits, 'grant',
    null, null, p_note, v_user
  );

  perform public.__notify(
    p_studio_id, p_student_id, 'credits_granted',
    'Credits added',
    format('%s class credits have been added to your account.', p_credits),
    null,
    jsonb_build_object('credits', p_credits, 'expires_at', p_expires_at)
  );

  return jsonb_build_object(
    'ok', true,
    'grant_id', v_grant_id,
    'new_balance', public.student_balance(p_student_id)
  );
end;
$$;


-- ===========================================================================
-- adjust_credits — manual correction, reason REQUIRED
-- ===========================================================================
-- Any manual movement of value must carry an explanation.  Because the ledger
-- is append-only, a correction is a new row and the original remains visible.
create or replace function public.adjust_credits(
  p_student_id uuid,
  p_studio_id  uuid,
  p_delta      int,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_grant_id uuid;
  v_grant    public.credit_grants%rowtype;
  v_left     int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_studio_admin(p_studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if p_delta = 0 or p_reason is null or char_length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED');
  end if;

  if p_delta > 0 then
    -- A positive adjustment is a non-expiring grant carrying the reason.
    insert into public.credit_grants (
      studio_id, student_id, credits_total, credits_remaining, note, created_by
    )
    values (p_studio_id, p_student_id, p_delta, p_delta,
            'Adjustment: ' || p_reason, v_user)
    returning id into v_grant_id;

    perform public.__ledger_append(
      p_studio_id, p_student_id, v_grant_id, p_delta, 'adjustment',
      null, null, p_reason, v_user
    );
  else
    -- A negative adjustment draws down grants, latest-expiring first.
    v_left := abs(p_delta);

    for v_grant in
      select * from public.credit_grants
      where student_id = p_student_id
        and studio_id = p_studio_id
        and status = 'active'
        and credits_remaining > 0
      order by expires_at desc nulls first
      for update
    loop
      exit when v_left <= 0;

      declare
        v_take int := least(v_left, v_grant.credits_remaining);
      begin
        update public.credit_grants
        set credits_remaining = credits_remaining - v_take,
            status = case when credits_remaining - v_take = 0
                          then 'exhausted'::public.grant_status else status end
        where id = v_grant.id;

        perform public.__ledger_append(
          p_studio_id, p_student_id, v_grant.id, -v_take, 'adjustment',
          null, null, p_reason, v_user
        );

        v_left := v_left - v_take;
      end;
    end loop;

    if v_left > 0 then
      return jsonb_build_object('ok', false, 'error_code', 'INSUFFICIENT_CREDITS');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'new_balance', public.student_balance(p_student_id)
  );
end;
$$;


-- ===========================================================================
-- admin_book_student / admin_remove_booking
-- ===========================================================================
create or replace function public.admin_book_student(
  p_session_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_session    public.sessions%rowtype;
  v_confirmed  int;
  v_grant_id   uuid;
  v_booking_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_studio_admin(v_session.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_CANCELLED');
  end if;

  select count(*) into v_confirmed
  from public.bookings
  where session_id = p_session_id and status = 'confirmed';

  -- Capacity binds admins too.  The room holds what the room holds.
  if v_confirmed >= v_session.capacity then
    return jsonb_build_object('ok', false, 'error_code', 'SESSION_FULL');
  end if;

  if exists (
    select 1 from public.bookings
    where session_id = p_session_id and student_id = p_student_id and status = 'confirmed'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_BOOKED');
  end if;

  v_grant_id := public.__consume_credit(p_student_id);
  if v_grant_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'INSUFFICIENT_CREDITS');
  end if;

  insert into public.bookings (session_id, student_id, studio_id, status, source)
  values (p_session_id, p_student_id, v_session.studio_id, 'confirmed', 'admin')
  returning id into v_booking_id;

  perform public.__ledger_append(
    v_session.studio_id, p_student_id, v_grant_id, -1, 'booking',
    v_booking_id, p_session_id, 'Booked by studio', v_user
  );

  -- Any waiting entry is superseded by the confirmed booking.
  update public.waitlist_entries
  set status = 'left', left_at = now()
  where session_id = p_session_id and student_id = p_student_id and status = 'waiting';

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;


-- The refund flag is explicit because the admin is making a judgement the
-- system cannot make: a student who phoned in sick versus one who simply
-- did not appear.
create or replace function public.admin_remove_booking(
  p_booking_id uuid,
  p_refund     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_booking  public.bookings%rowtype;
  v_grant_id uuid;
  v_promoted uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'BOOKING_NOT_FOUND');
  end if;

  if not public.is_studio_admin(v_booking.studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error_code', 'ALREADY_CANCELLED');
  end if;

  perform 1 from public.sessions where id = v_booking.session_id for update;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_user,
      credit_refunded = p_refund
  where id = p_booking_id;

  if p_refund then
    select grant_id into v_grant_id
    from public.credit_ledger
    where booking_id = p_booking_id and entry_type = 'booking'
    order by created_at asc limit 1;

    if public.__refund_credit(v_grant_id) then
      perform public.__ledger_append(
        v_booking.studio_id, v_booking.student_id, v_grant_id, 1, 'refund',
        p_booking_id, v_booking.session_id, 'Removed by studio', v_user
      );
    end if;
  end if;

  v_promoted := public.__promote_from_waitlist(v_booking.session_id);

  return jsonb_build_object('ok', true, 'promoted_booking_id', v_promoted);
end;
$$;


-- ===========================================================================
-- create_recurring_sessions — DST-correct weekly generation
-- ===========================================================================
-- THE CRITICAL DETAIL: iteration happens in the studio's LOCAL time, then each
-- occurrence is converted to UTC individually.  Adding seven days to a UTC
-- timestamp twelve times is the naive approach and produces a class at 06:00
-- for half the term once daylight saving shifts.
--
-- Conflicting occurrences are collected and reported rather than aborting the
-- batch: if week 5 collides, weeks 1-4 and 6-12 are still created.
create or replace function public.create_recurring_sessions(
  p_studio_id     uuid,
  p_class_type_id uuid,
  p_room_id       uuid,
  p_instructor_id uuid,
  p_first_start   timestamptz,
  p_weeks         int,
  p_capacity      int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_tz         text;
  v_duration   int;
  v_capacity   int;
  v_group_id   uuid := gen_random_uuid();
  v_local      timestamp;
  v_occurrence timestamptz;
  v_created    uuid[] := '{}';
  v_conflicts  jsonb  := '[]'::jsonb;
  v_new_id     uuid;
  i            int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_studio_admin(p_studio_id) then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  -- Bounded to keep the transaction small (Design §4.5).
  if p_weeks is null or p_weeks < 1 or p_weeks > 12 then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED');
  end if;

  if p_first_start <= now() then
    return jsonb_build_object('ok', false, 'error_code', 'VALIDATION_FAILED');
  end if;

  select timezone into v_tz from public.studios where id = p_studio_id;

  select duration_minutes into v_duration
  from public.class_types
  where id = p_class_type_id and studio_id = p_studio_id;

  if v_duration is null then
    return jsonb_build_object('ok', false, 'error_code', 'CLASS_TYPE_NOT_FOUND');
  end if;

  select coalesce(p_capacity, capacity) into v_capacity
  from public.rooms
  where id = p_room_id and studio_id = p_studio_id;

  if v_capacity is null then
    return jsonb_build_object('ok', false, 'error_code', 'ROOM_NOT_FOUND');
  end if;

  -- Convert once to local wall-clock time...
  v_local := p_first_start at time zone v_tz;

  for i in 0 .. p_weeks - 1 loop
    -- ...advance in LOCAL days...
    -- ...then convert each occurrence back to an absolute instant.
    v_occurrence := (v_local + make_interval(days => i * 7)) at time zone v_tz;

    begin
      insert into public.sessions (
        studio_id, class_type_id, room_id, instructor_id,
        starts_at, ends_at, capacity, recurrence_group_id, created_by
      )
      values (
        p_studio_id, p_class_type_id, p_room_id, p_instructor_id,
        v_occurrence,
        v_occurrence + make_interval(mins => v_duration),
        v_capacity, v_group_id, v_user
      )
      returning id into v_new_id;

      v_created := array_append(v_created, v_new_id);

    exception
      -- 23P01 is exclusion_violation: the room or instructor is already busy.
      when exclusion_violation then
        v_conflicts := v_conflicts || jsonb_build_object(
          'starts_at', v_occurrence,
          'reason', 'ROOM_OR_INSTRUCTOR_CONFLICT'
        );
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'recurrence_group_id', v_group_id,
    'created_ids', to_jsonb(v_created),
    'created_count', coalesce(array_length(v_created, 1), 0),
    'conflicts', v_conflicts
  );
end;
$$;


-- ===========================================================================
-- complete_password_rotation — clears must_change_password
-- ===========================================================================
-- studio_members has NO self-update policy (that omission is what blocks
-- privilege escalation).  This narrowly scoped function lets a user clear
-- exactly one flag on exactly their own row, and nothing else.
create or replace function public.complete_password_rotation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_AUTHENTICATED');
  end if;

  update public.studio_members
  set must_change_password = false
  where user_id = v_user;

  return jsonb_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Internal helpers (double-underscore prefix) are callable by NOBODY through
-- the API.  They are reachable only from the SECURITY DEFINER functions above,
-- which run as the owner.  Exposing __consume_credit or __ledger_append over
-- RPC would let any authenticated user mint or destroy credits directly.
revoke all on function public.__ledger_append(uuid, uuid, uuid, int, public.ledger_entry_type, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.__consume_credit(uuid)                     from public, anon, authenticated;
revoke all on function public.__refund_credit(uuid)                      from public, anon, authenticated;
revoke all on function public.__notify(uuid, uuid, public.notification_type, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.__promote_from_waitlist(uuid)              from public, anon, authenticated;

-- Client-callable RPCs.
revoke all on function public.book_session(uuid)                                   from public;
revoke all on function public.join_waitlist(uuid)                                  from public;
revoke all on function public.leave_waitlist(uuid)                                 from public;
revoke all on function public.cancel_booking(uuid)                                 from public;
revoke all on function public.cancel_session(uuid, text)                           from public;
revoke all on function public.mark_attendance(uuid, public.attendance_status)      from public;
revoke all on function public.grant_credits(uuid, uuid, int, timestamptz, text)    from public;
revoke all on function public.adjust_credits(uuid, uuid, int, text)                from public;
revoke all on function public.admin_book_student(uuid, uuid)                       from public;
revoke all on function public.admin_remove_booking(uuid, boolean)                  from public;
revoke all on function public.create_recurring_sessions(uuid, uuid, uuid, uuid, timestamptz, int, int) from public;
revoke all on function public.complete_password_rotation()                         from public;

grant execute on function public.book_session(uuid)                                to authenticated;
grant execute on function public.join_waitlist(uuid)                               to authenticated;
grant execute on function public.leave_waitlist(uuid)                              to authenticated;
grant execute on function public.cancel_booking(uuid)                              to authenticated;
grant execute on function public.cancel_session(uuid, text)                        to authenticated;
grant execute on function public.mark_attendance(uuid, public.attendance_status)   to authenticated;
grant execute on function public.grant_credits(uuid, uuid, int, timestamptz, text) to authenticated;
grant execute on function public.adjust_credits(uuid, uuid, int, text)             to authenticated;
grant execute on function public.admin_book_student(uuid, uuid)                    to authenticated;
grant execute on function public.admin_remove_booking(uuid, boolean)               to authenticated;
grant execute on function public.create_recurring_sessions(uuid, uuid, uuid, uuid, timestamptz, int, int) to authenticated;
grant execute on function public.complete_password_rotation()                      to authenticated;
