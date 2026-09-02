-- ============================================================================
-- StudioFlow — Migration 008: Scheduled Job Functions
-- ----------------------------------------------------------------------------
-- Reference: Detailed Technical Design §5.5 – §5.6, §4.7
--
-- These are invoked by cron Route Handlers using the SERVICE ROLE client.
-- Every one is IDEMPOTENT: each selects only rows in a not-yet-processed
-- state and moves them forward, so a duplicate invocation is harmless.  Cron
-- schedulers retry, and Vercel may invoke a function more than once.
--
-- SECURITY: execute permission is revoked from anon and authenticated and
-- granted ONLY to service_role.  Without that revoke, any logged-in student
-- could call finalize_attendance() over RPC and mutate the whole studio's
-- records.  PostgreSQL grants EXECUTE to PUBLIC on new functions by default,
-- so the revoke is required, not decorative.
-- ============================================================================


-- ===========================================================================
-- finalize_attendance — BR-12
-- ===========================================================================
-- Resolves bookings the instructor never marked, once the marking window has
-- closed.  Defaults to the studio's configured value, which is 'attended'.
--
-- Defaulting to 'absent' would be the tempting alternative and is wrong: it
-- would silently take credits from students who DID attend, purely because an
-- instructor forgot to tap a toggle.  Erring in the student's favour is the
-- correct direction for a trust-sensitive product.
--
-- No credit movement occurs here.  A no-show already forfeited its credit at
-- booking time (BR-10); attendance is a record, not a transaction.
create or replace function public.finalize_attendance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolved int := 0;
begin
  with due as (
    select b.id, s.unmarked_attendance_default as default_attendance
    from public.bookings b
    join public.sessions se on se.id = b.session_id
    join public.studios  s  on s.id  = se.studio_id
    where b.status = 'confirmed'
      and b.attendance is null
      and se.status = 'scheduled'
      and now() > se.ends_at + make_interval(hours => s.attendance_window_hours)
    for update of b
  ),
  updated as (
    update public.bookings b
    set attendance = due.default_attendance,
        attendance_auto_resolved = true,
        attendance_marked_at = now()
    from due
    where b.id = due.id
    returning b.id
  )
  select count(*)::int into v_resolved from updated;

  return jsonb_build_object('ok', true, 'resolved_count', v_resolved);
end;
$$;


-- ===========================================================================
-- expire_credits — BR-13
-- ===========================================================================
-- Rather than filtering expired grants at read time (which makes every
-- balance query a complicated expression), a compensating negative ledger
-- entry is written when a grant lapses with credits unused.  The balance
-- stays a plain sum, and the student sees a dated, plain-language line
-- explaining exactly where their credits went.
--
-- Idempotency comes from the status transition: a grant is only processed
-- while status = 'active', and the same statement sets it to 'expired'.
create or replace function public.expire_credits()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant   record;
  v_expired int := 0;
  v_credits int := 0;
begin
  for v_grant in
    select *
    from public.credit_grants
    where status = 'active'
      and expires_at is not null
      and expires_at <= now()
    for update skip locked
  loop
    if v_grant.credits_remaining > 0 then
      perform public.__ledger_append(
        v_grant.studio_id,
        v_grant.student_id,
        v_grant.id,
        -v_grant.credits_remaining,
        'expiry',
        null,
        null,
        'Package expired',
        null                     -- created_by null == written by the system
      );
      v_credits := v_credits + v_grant.credits_remaining;
    end if;

    update public.credit_grants
    set credits_remaining = 0,
        status = 'expired'
    where id = v_grant.id;

    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'grants_expired', v_expired, 'credits_expired', v_credits
  );
end;
$$;


-- ===========================================================================
-- notify_expiring_credits — a courtesy warning before BR-13 bites
-- ===========================================================================
-- Sends one notification per grant expiring within seven days.  The
-- notifications table itself provides idempotency: the payload carries the
-- grant id, and a matching row is not created twice.
create or replace function public.notify_expiring_credits()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant  record;
  v_notified int := 0;
begin
  for v_grant in
    select g.*
    from public.credit_grants g
    where g.status = 'active'
      and g.credits_remaining > 0
      and g.expires_at is not null
      and g.expires_at between now() and now() + interval '7 days'
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = g.student_id
          and n.type = 'credits_expiring'
          and n.payload ->> 'grant_id' = g.id::text
      )
  loop
    perform public.__notify(
      v_grant.studio_id,
      v_grant.student_id,
      'credits_expiring',
      'Your credits expire soon',
      format('You have %s credit(s) expiring on %s.',
             v_grant.credits_remaining,
             to_char(v_grant.expires_at, 'DD Mon YYYY')),
      null,
      jsonb_build_object('grant_id', v_grant.id,
                         'credits', v_grant.credits_remaining,
                         'expires_at', v_grant.expires_at)
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object('ok', true, 'notified_count', v_notified);
end;
$$;


-- ===========================================================================
-- claim_pending_notifications — the email dispatch queue
-- ===========================================================================
-- Claims a batch atomically with FOR UPDATE SKIP LOCKED so two overlapping
-- cron invocations cannot send the same email twice.  The Route Handler sends
-- via Resend and then calls mark_notification_email_result() per row.
create or replace function public.claim_pending_notifications(p_limit int default 50)
returns table (
  id             uuid,
  recipient_id   uuid,
  recipient_name text,
  recipient_email text,
  type           public.notification_type,
  title          text,
  body           text,
  payload        jsonb,
  email_attempts int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select n.id
    from public.notifications n
    where n.email_status = 'pending'
      and n.email_attempts < 3
    order by n.created_at asc
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  )
  select n.id, n.recipient_id, p.full_name, p.email,
         n.type, n.title, n.body, n.payload, n.email_attempts
  from public.notifications n
  join claimed c on c.id = n.id
  join public.profiles p on p.id = n.recipient_id;
end;
$$;


-- ===========================================================================
-- mark_notification_email_result
-- ===========================================================================
-- Three consecutive failures abandon the email.  The IN-APP notification
-- remains visible regardless — it is the guaranteed channel (assumption A4),
-- and a mail provider outage degrades delivery without losing the message.
create or replace function public.mark_notification_email_result(
  p_notification_id uuid,
  p_success         boolean,
  p_error           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  select email_attempts + 1 into v_attempts
  from public.notifications where id = p_notification_id;

  if v_attempts is null then
    return jsonb_build_object('ok', false, 'error_code', 'NOT_FOUND');
  end if;

  update public.notifications
  set email_attempts = v_attempts,
      email_status = case
                       when p_success then 'sent'::public.email_status
                       when v_attempts >= 3 then 'failed'::public.email_status
                       else 'pending'::public.email_status
                     end,
      email_sent_at = case when p_success then now() else email_sent_at end,
      last_error    = case when p_success then null else p_error end
  where id = p_notification_id;

  return jsonb_build_object('ok', true, 'attempts', v_attempts);
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants — SERVICE ROLE ONLY
-- ---------------------------------------------------------------------------
revoke all on function public.finalize_attendance()                            from public, anon, authenticated;
revoke all on function public.expire_credits()                                 from public, anon, authenticated;
revoke all on function public.notify_expiring_credits()                        from public, anon, authenticated;
revoke all on function public.claim_pending_notifications(int)                 from public, anon, authenticated;
revoke all on function public.mark_notification_email_result(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.finalize_attendance()                            to service_role;
grant execute on function public.expire_credits()                                 to service_role;
grant execute on function public.notify_expiring_credits()                        to service_role;
grant execute on function public.claim_pending_notifications(int)                 to service_role;
grant execute on function public.mark_notification_email_result(uuid, boolean, text) to service_role;
