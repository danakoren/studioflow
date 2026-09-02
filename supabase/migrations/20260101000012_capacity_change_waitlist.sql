-- ============================================================================
-- StudioFlow — Migration 012: capacity changes and the waitlist
-- ----------------------------------------------------------------------------
-- Fixes a gap in the promotion model.
--
-- ---------------------------------------------------------------------------
-- THE BUG
-- ---------------------------------------------------------------------------
-- __promote_from_waitlist() was only ever reached from the paths that FREE a
-- seat — cancel_booking() and admin_remove_booking(). But a seat can also
-- appear because the studio DECIDED there was one: an admin moving a class from
-- 12 mats to 14 creates two bookable places, and until now those places sat
-- empty with people waiting in the queue for them.
--
-- That is precisely the failure business goal G1 exists to prevent. The
-- marginal cost of the fourteenth student in a fourteen-mat room is zero, so an
-- unfilled seat with someone waiting is pure lost margin — and worse, the
-- waitlisted student watches the class stay "full" while the studio has already
-- made room for them.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER RATHER THAN THE SERVER ACTION
-- ---------------------------------------------------------------------------
-- updateSession() writes capacity with a plain PostgREST UPDATE — no lock, no
-- transaction, no promotion. Adding a promotion loop in TypeScript beside it
-- would repeat the mistake the whole booking model was designed to avoid: the
-- read-then-write would race with concurrent bookers, and it would only protect
-- callers that happen to use that action.
--
-- A trigger protects EVERY caller — the admin form, a future bulk import, a
-- cron job, an owner running UPDATE in the Supabase SQL editor. It is the same
-- argument the codebase already makes for keeping capacity checks inside
-- book_session() instead of in the client.
--
-- Serialisation: an AFTER UPDATE trigger runs holding an exclusive row lock on
-- the session (our own UPDATE took it), and book_session() / cancel_booking()
-- both take `SELECT ... FOR UPDATE` on that same row. So a concurrent booker
-- either waits for us or we wait for it — the capacity check and the promotion
-- can never interleave, and INV-1 (no overbooking) holds.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- __fill_open_seats — promote until the class is full or the queue is spent
-- ---------------------------------------------------------------------------
-- __promote_from_waitlist() promotes AT MOST ONE person per call and does NOT
-- check capacity itself — it trusts the caller to only ask when a seat is free.
-- That contract is fine for a cancellation, which frees exactly one seat, but a
-- capacity increase can open several. This wraps it in the bounded loop that
-- contract requires.
--
-- Assumes the session row is ALREADY LOCKED by the caller, exactly as
-- __promote_from_waitlist does.
--
-- Termination: every iteration either exits or inserts one confirmed booking,
-- so v_confirmed strictly increases toward v_capacity. The count is re-read
-- each pass rather than incremented locally, because __promote_from_waitlist
-- is the thing that knows whether it actually booked anyone.
create or replace function public.__fill_open_seats(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity  int;
  v_status    public.session_status;
  v_confirmed int;
  v_promoted  uuid;
  v_filled    int := 0;
begin
  select capacity, status into v_capacity, v_status
  from public.sessions
  where id = p_session_id;

  if v_capacity is null then
    return 0;
  end if;

  -- A cancelled class has no seats to fill, whatever its capacity says.
  if v_status <> 'scheduled' then
    return 0;
  end if;

  loop
    select count(*) into v_confirmed
    from public.bookings
    where session_id = p_session_id
      and status = 'confirmed';

    -- Full. This is the guard that makes calling the single-promotion helper
    -- in a loop safe.
    exit when v_confirmed >= v_capacity;

    v_promoted := public.__promote_from_waitlist(p_session_id);

    -- NULL means "nothing more to do", and covers three distinct cases that
    -- all end the loop: nobody is waiting, everyone waiting is out of credit,
    -- or BR-3's promotion cutoff has passed. Retrying would spin forever.
    exit when v_promoted is null;

    v_filled := v_filled + 1;
  end loop;

  return v_filled;
end;
$$;

comment on function public.__fill_open_seats(uuid) is
  'Promote waitlisted students until the session is full or the queue is exhausted. Caller must hold a lock on the session row.';


-- ---------------------------------------------------------------------------
-- Trigger: capacity went UP -> fill the new seats
-- ---------------------------------------------------------------------------
create or replace function public.__sessions_fill_on_capacity_increase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The WHEN clause on the trigger already filters this, but the condition is
  -- repeated so the function is still correct if it is ever attached to
  -- another trigger or called directly.
  if new.status = 'scheduled' and new.capacity > old.capacity then
    perform public.__fill_open_seats(new.id);
  end if;

  return null;  -- AFTER trigger: the return value is ignored.
end;
$$;

create trigger sessions_fill_on_capacity_increase
  after update of capacity on public.sessions
  for each row
  when (new.capacity > old.capacity and new.status = 'scheduled')
  execute function public.__sessions_fill_on_capacity_increase();


-- ---------------------------------------------------------------------------
-- Trigger: capacity must not drop BELOW the seats already taken
-- ---------------------------------------------------------------------------
-- The mirror of the bug above, and it was equally unguarded: nothing stopped
-- an admin setting capacity to 5 on a class with 8 confirmed bookings. That
-- does not un-book anyone — it silently produces an OVERBOOKED session, which
-- assert_no_overbooking() reports as a defect (INV-1) and which the schedule
-- then renders as "-3 seats available".
--
-- Refused rather than auto-cancelling the excess: choosing which three
-- students lose their place is a judgement the database must not make on the
-- studio's behalf. The admin removes bookings first, deliberately, through
-- admin_remove_booking() — where the refund decision is theirs.
create or replace function public.__sessions_guard_capacity_decrease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmed int;
begin
  if new.capacity < old.capacity then
    select count(*) into v_confirmed
    from public.bookings
    where session_id = new.id
      and status = 'confirmed';

    if new.capacity < v_confirmed then
      raise exception
        'Capacity % is below the % confirmed booking(s) already held for this session.',
        new.capacity, v_confirmed
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger sessions_guard_capacity_decrease
  before update of capacity on public.sessions
  for each row
  when (new.capacity < old.capacity)
  execute function public.__sessions_guard_capacity_decrease();


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- __fill_open_seats is INTERNAL. Postgres grants EXECUTE to PUBLIC on new
-- functions by default, so the revoke is required before granting deliberately.
-- No application role may call it directly: it promotes people and spends their
-- credits, and its safety depends on the caller already holding a row lock —
-- a precondition no client can be trusted to honour.
revoke all on function public.__fill_open_seats(uuid) from public;
grant execute on function public.__fill_open_seats(uuid) to service_role;

revoke all on function public.__sessions_fill_on_capacity_increase() from public;
revoke all on function public.__sessions_guard_capacity_decrease() from public;


-- ---------------------------------------------------------------------------
-- Verification — run after applying.
-- ---------------------------------------------------------------------------
-- Both triggers should be listed as enabled ('O') on public.sessions.
select
  t.tgname                as trigger_name,
  c.relname               as on_table,
  t.tgenabled             as enabled,
  p.proname               as calls
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_proc  p on p.oid = t.tgfoid
where c.relname = 'sessions'
  and not t.tgisinternal
order by t.tgname;
