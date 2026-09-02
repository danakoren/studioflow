-- ============================================================================
-- StudioFlow — one-off: fill seats that were stranded before migration 012
-- ----------------------------------------------------------------------------
-- RUN ONCE, AFTER 20260101000012_capacity_change_waitlist.sql.
--
-- Migration 012 adds a TRIGGER, and a trigger only fires on future writes. Any
-- seat that was opened by a capacity increase BEFORE it was installed is still
-- sitting empty with people queued behind it — the trigger will not go back and
-- find them.
--
-- This is a DATA repair, not schema, which is why it lives outside
-- supabase/migrations/. It is also idempotent: running it twice promotes nobody
-- the second time, because the first pass filled the seats.
--
-- ---------------------------------------------------------------------------
-- THE `FOR UPDATE` IS NOT OPTIONAL
-- ---------------------------------------------------------------------------
-- __fill_open_seats() documents that the caller must already hold a lock on the
-- session row — it reads the confirmed count and inserts bookings against it,
-- so without the lock a concurrent book_session() could take the same seat and
-- overbook the class. A bare
--
--     select public.__fill_open_seats(id) from public.sessions where ...;
--
-- looks equivalent and is not: it takes no row locks at all. Hence the explicit
-- cursor below.
--
-- Only SCHEDULED, FUTURE sessions are touched. A finished class cannot be
-- joined, and BR-3's promotion cutoff inside __promote_from_waitlist() will
-- decline anything starting too soon regardless.
-- ============================================================================

do $$
declare
  v_session record;
  v_filled  int;
  v_total   int := 0;
  v_touched int := 0;
begin
  for v_session in
    select id, starts_at
    from public.sessions
    where status = 'scheduled'
      and starts_at > now()
    order by starts_at
    for update
  loop
    v_filled := public.__fill_open_seats(v_session.id);

    if v_filled > 0 then
      v_touched := v_touched + 1;
      v_total   := v_total + v_filled;
      raise notice 'session % (%): promoted %',
        v_session.id, v_session.starts_at, v_filled;
    end if;
  end loop;

  raise notice '----------------------------------------------------------';
  raise notice 'Backfill complete: % promotion(s) across % session(s).',
    v_total, v_touched;
end
$$;


-- ---------------------------------------------------------------------------
-- Verification — no future scheduled class should still have BOTH a free seat
-- and someone waiting for it. Any row returned here is a remaining gap.
-- ---------------------------------------------------------------------------
select
  v.id,
  v.class_type_name,
  v.starts_at,
  v.capacity,
  v.booked_count,
  v.seats_available,
  v.waiting_count
from public.v_sessions_with_availability v
where v.status = 'scheduled'
  and v.starts_at > now()
  and v.seats_available > 0
  and v.waiting_count > 0
order by v.starts_at;
