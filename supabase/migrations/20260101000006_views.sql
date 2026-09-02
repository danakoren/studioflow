-- ============================================================================
-- StudioFlow — Migration 006: Views
-- ----------------------------------------------------------------------------
-- Reference: Basic Scaling §2.1 – §2.3, Basic Security §2.6
--
-- CRITICAL: every view here is declared WITH (security_invoker = true).
--
-- A PostgreSQL view runs with the DEFINER's rights by default.  A view over
-- bookings created to fix an N+1 query would therefore expose every booking
-- row to every caller, regardless of the policies in migration 005 — a
-- performance fix silently becoming a security hole.  security_invoker makes
-- the view evaluate RLS as the CALLING user, which is what we want.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- v_sessions_with_availability  (solves HQ-1)
-- ---------------------------------------------------------------------------
-- The naive schedule render is 1 query for 40 sessions plus 40 COUNT queries
-- — 41 round trips on the most-visited page in the product.  This aggregates
-- in a single pass, so rendering a week is ONE round trip regardless of how
-- many sessions it contains.
create view public.v_sessions_with_availability
with (security_invoker = true)
as
select
  s.id,
  s.studio_id,
  s.class_type_id,
  s.room_id,
  s.instructor_id,
  s.starts_at,
  s.ends_at,
  s.capacity,
  s.status,
  s.cancellation_reason,
  s.recurrence_group_id,
  ct.name             as class_type_name,
  ct.description      as class_type_description,
  ct.color            as class_type_color,
  ct.duration_minutes,
  r.name              as room_name,
  p.full_name         as instructor_name,
  coalesce(b.confirmed_count, 0)::int              as booked_count,
  greatest(s.capacity - coalesce(b.confirmed_count, 0), 0)::int as seats_available,
  coalesce(w.waiting_count, 0)::int                as waiting_count,
  (coalesce(b.confirmed_count, 0) >= s.capacity)   as is_full
from public.sessions s
join public.class_types ct on ct.id = s.class_type_id
join public.rooms       r  on r.id  = s.room_id
join public.profiles    p  on p.id  = s.instructor_id
left join lateral (
  select count(*) as confirmed_count
  from public.bookings b2
  where b2.session_id = s.id
    and b2.status = 'confirmed'
) b on true
left join lateral (
  select count(*) as waiting_count
  from public.waitlist_entries w2
  where w2.session_id = s.id
    and w2.status = 'waiting'
) w on true;

comment on view public.v_sessions_with_availability is
  'Schedule with live seat counts in one query. security_invoker=true so RLS applies to the caller.';


-- ---------------------------------------------------------------------------
-- v_waitlist_positions  (solves HQ-3)
-- ---------------------------------------------------------------------------
-- Position is DERIVED here, never stored.  A stored position would have to be
-- renumbered on every departure, which is both write amplification and a
-- source of gaps and duplicates under concurrency.
create view public.v_waitlist_positions
with (security_invoker = true)
as
select
  w.id,
  w.session_id,
  w.student_id,
  w.studio_id,
  w.status,
  w.joined_at,
  row_number() over (
    partition by w.session_id
    order by w.joined_at, w.id
  )::int as position
from public.waitlist_entries w
where w.status = 'waiting';


-- ---------------------------------------------------------------------------
-- v_student_balances  (solves HQ-2 / HQ-4)
-- ---------------------------------------------------------------------------
-- Aggregating here means the admin student list is ONE query for 25 students
-- rather than 1 + 25 balance lookups.
create view public.v_student_balances
with (security_invoker = true)
as
select
  g.studio_id,
  g.student_id,
  sum(g.credits_remaining)::int as balance,
  min(g.expires_at) filter (
    where g.expires_at is not null and g.credits_remaining > 0
  ) as next_expiry_at
from public.credit_grants g
where g.status = 'active'
  and (g.expires_at is null or g.expires_at > now())
group by g.studio_id, g.student_id;


-- ---------------------------------------------------------------------------
-- v_grant_ledger_reconciliation  — the INV-2 guard
-- ---------------------------------------------------------------------------
-- The Detailed Technical Design (§0.1) amended the credit model to add a
-- maintained credits_remaining column, on the condition that a test proves it
-- never drifts from the append-only ledger.  This view is that test's data
-- source: for every grant, credits_remaining must equal the sum of all ledger
-- deltas referencing it.  Any row where is_consistent is false is a defect.
create view public.v_grant_ledger_reconciliation
with (security_invoker = true)
as
select
  g.id                                        as grant_id,
  g.studio_id,
  g.student_id,
  g.credits_total,
  g.credits_remaining,
  coalesce(sum(l.delta), 0)::int              as ledger_sum,
  (g.credits_remaining = coalesce(sum(l.delta), 0)) as is_consistent
from public.credit_grants g
left join public.credit_ledger l on l.grant_id = g.id
group by g.id, g.studio_id, g.student_id, g.credits_total, g.credits_remaining;


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on public.v_sessions_with_availability     to anon, authenticated;
grant select on public.v_waitlist_positions             to authenticated;
grant select on public.v_student_balances               to authenticated;
grant select on public.v_grant_ledger_reconciliation    to authenticated, service_role;
