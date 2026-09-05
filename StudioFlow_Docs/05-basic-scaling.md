# Basic Scaling Document
## StudioFlow — Class Booking & Waitlist Management

**Course:** Internet Technologies — Become a Full-Stack Engineer, RUNI CS 2026
**Document:** Deliverable 7 of 10 — Basic Scaling (מסמך סקייל בסיסי)
**Version:** 1.0
**Status:** Draft for review
**Depends on:** Product Specification v1.0, Technical Architecture v1.0, Detailed Technical Design v1.0, Test Specification v1.0 (all approved)

---

## 0. Purpose and Method

This document answers a specific question: **what happens to this system as usage grows, and what breaks first?**

It is written from measured expectations rather than aspiration. Every claim about query cost is stated as an estimate to be verified with `EXPLAIN ANALYZE` against seeded data, and §7 records which numbers we intend to confirm before submission.

### 0.1 The central observation about this domain

Studio booking traffic is **not uniform — it is spiky, and the spikes land on a single database row.**

Average load is negligible. Two hundred students booking three classes a week is roughly 600 write operations per week, or one every seventeen minutes. No system needs engineering for that.

But the traffic does not arrive that way. It arrives in two bursts:

1. **Schedule release.** The studio publishes next week on Sunday evening. Fifty students open the app within ten minutes.
2. **The popular class.** A 07:00 Vinyasa with fourteen mats and thirty interested students. When the last seat frees, several people act within seconds — on the *same session row*.

The second pattern is the one that matters, and it is why this document's analysis focuses on **contention on hot rows** rather than on data volume. The dataset is small; the concurrency is concentrated.

---

## 1. Load Handling

### 1.1 Modelled scale

| Parameter | Target studio | Stretch |
|---|---|---|
| Active students | 200 | 500 |
| Instructors | 5 | 12 |
| Rooms | 2 | 4 |
| Sessions per week | 40 | 100 |
| Bookings per week | ~400 | ~1,100 |
| Peak concurrent users | ~50 | ~150 |

### 1.2 Resulting data volume

| Table | Year 1 | Year 3 | Assessment |
|---|---|---|---|
| `profiles` | 210 | 400 | Trivial |
| `sessions` | 2,000 | 6,000 | Trivial |
| `bookings` | 20,000 | 60,000 | Small |
| `credit_ledger` | 25,000 | 75,000 | Small |
| `waitlist_entries` | 3,000 | 9,000 | Trivial |
| `notifications` | 8,000 | 24,000 | Small |

**Honest conclusion: data volume is not this system's scaling problem.** The entire three-year dataset is a few tens of megabytes and fits comfortably in Postgres's shared buffers. Any query that is slow here is slow because of its *shape* — a missing index, an N+1 pattern, or an unbounded range — not because of row count.

Stating this plainly matters. It would be easy to write a scaling document full of sharding and caching that addresses problems this product will never have, while ignoring the one it will hit in its first week.

### 1.3 Throughput arithmetic on the hot path

The row lock in `book_session` serialises all bookings for one session. This is deliberate — it is what makes INV-1 hold — and it means the booking transaction's duration is directly a throughput ceiling.

| Transaction duration | Bookings/second on one session | 14 seats filled in |
|---|---|---|
| 5 ms (expected) | ~200 | 0.07 s |
| 50 ms | ~20 | 0.7 s |
| 500 ms | ~2 | 7 s |

At the expected duration, a full fourteen-mat class can be filled from an empty state faster than a user can perceive. The lock is not a bottleneck at this scale.

**But this is conditional on the transaction staying short**, which drives two design constraints already present in the architecture:

- **No external I/O inside the transaction.** An email send inside `cancel_booking` would add 100–300ms of network latency *while holding the session lock*, dropping throughput by two orders of magnitude and blocking every other student trying to book that class. The notification outbox pattern is therefore not only a reliability decision (architecture principle 5) but a throughput one.
- **No unnecessary work under the lock.** The function performs indexed lookups and small writes only. No reporting, no aggregation over history, no cross-table scans.

### 1.4 Connection handling — the problem we avoid by construction

The classic failure mode for serverless plus Postgres is **connection exhaustion**: each concurrent function invocation opens its own database connection, and a traffic spike opens more connections than Postgres permits.

This architecture does not have that problem, because of a choice made for other reasons. The Supabase JS client does not speak the Postgres wire protocol; it issues HTTP requests to **PostgREST**, which maintains its own bounded connection pool. A hundred simultaneous Vercel invocations produce a hundred HTTP requests against a pool of a few dozen connections — queued, not exhausted.

Raw `node-postgres` connections appear in exactly one place in this project: the deterministic lock test (DB-01), which runs locally and never in production.

### 1.5 What each tier does under burst

| Tier | Behaviour at 150 concurrent | Concern |
|---|---|---|
| Vercel edge / CDN | Static assets served from cache | None |
| Vercel functions | Scale horizontally, automatic | Cold starts add ~200–500ms to the first request |
| PostgREST | Bounded pool, queues excess | Queue depth under sustained burst |
| Postgres | Small dataset, mostly buffer-resident | Lock contention on hot session rows |
| Resend | Not on the request path at all | None — decoupled by the outbox |

**Assessment:** hundreds of users are comfortably within capacity. The system's first real constraint is not throughput but the correctness guarantee under contention — which §5 of the Test Specification is built to prove.

---

## 2. Heavy Database Queries

Six queries carry real risk. Four are N+1 patterns, one is unbounded, and one grows with history.

### 2.1 HQ-1 — Schedule with live availability *(highest risk)*

**The query:** render 40 sessions, each showing remaining seats.

**The naive shape:** fetch sessions, then loop and count bookings per session.

```
1 query  → 40 sessions
40 queries → COUNT(*) per session
= 41 round trips
```

**Why it is the top risk:** it appears on the most-visited page in the product, it is triggered by anonymous traffic, and its cost grows linearly with the number of sessions displayed. Forty round trips at 20ms each is 800ms of latency for a page that should render in under 100ms.

**The fix:** a single query aggregating counts, exposed as a database view `v_sessions_with_availability` that computes confirmed bookings and waiting entries per session in one pass. Rendering the week becomes **one round trip regardless of session count**.

The view is defined with `security_invoker` so RLS still applies to the caller — a view that bypasses RLS would be a security regression dressed as an optimisation.

### 2.2 HQ-2 — Admin student list with balance and last attendance

**The naive shape:** 200 students, then per student a balance sum and a last-attendance lookup → **601 queries.**

**The fix:** one query joining students to aggregated grant remainders and to a lateral last-attendance subquery, with pagination applied *before* the aggregates are computed. Twenty-five students per page means the aggregate work is bounded by the page, not the roster.

### 2.3 HQ-3 — Waitlist positions in a list view

**The naive shape:** for each waitlist entry, count earlier entries → N+1 again.

**The fix:** `ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY joined_at)` computed once. Position is derived, never stored — the design decision from Technical Design §3.9 pays off here, since a stored position would require renumbering every remaining row on each departure.

### 2.4 HQ-4 — Student credit balance

**Cost:** a sum over that student's active grants — typically one to three rows. Individually negligible.

**The risk is contextual:** it becomes HQ-2 when called in a loop. Guarded by the rule that balance is aggregated in the same query as the list it appears in.

### 2.5 HQ-5 — Reports *(the only query that genuinely degrades over time)*

**The query:** aggregate bookings joined to sessions over a date range, grouped by class type, instructor and time slot.

**Cost profile:**

| History | Rows scanned | Estimated |
|---|---|---|
| 1 month | ~1,700 | < 20 ms |
| 1 year | ~20,000 | ~80 ms |
| 3 years, unbounded range | ~60,000 | 300 ms+ |

**Mitigations in v1:**
- The date range is **always bounded**; the UI defaults to 30 days and no "all time" option exists.
- Indexed on `(studio_id, starts_at)` so the range is an index scan, not a sequential scan.
- Admin-only and low-frequency — a few requests per week, not per minute.

This resolves the open question carried from Architecture §8: **reports are computed on demand in v1.** The justification is that a 300ms admin query executed weekly does not warrant a materialised view and its invalidation complexity. §6 records the threshold at which that changes.

### 2.6 HQ-6 — Notification unread count

**The risk:** it renders in navigation on *every authenticated page*, so it executes on nearly every request.

**The fix:** a partial index on unread rows only. Because most notifications are read, the partial index stays small and hot — typically a few hundred rows even after years of use — making this an index-only scan of a structure that lives permanently in cache.

### 2.7 RLS as a query-cost factor

RLS policies execute per row, so a careless policy is a performance problem as well as a correctness one.

Two decisions from the design mitigate this:

**`studio_id` is denormalised onto `bookings`, `waitlist_entries` and `credit_ledger`.** Without it, every policy evaluation on the highest-traffic table would join to `sessions` to discover the tenant. With it, the check is a comparison against an indexed column on the same row.

**Helper functions are marked `STABLE`.** `current_membership()` returns the same value throughout a statement, so Postgres evaluates it once rather than per row. A `VOLATILE` helper would re-execute the membership lookup for every row examined — turning a 500-row scan into 500 extra subqueries. This is a one-word change with a large effect, and it is easy to omit.

---

## 3. Indexes

### 3.1 Are indexes needed?

Yes — but not because the tables are large. They are needed because **without them Postgres performs sequential scans, and a sequential scan inside a locked transaction extends the lock duration**, which per §1.3 is the system's actual throughput constraint. An unindexed capacity count is not just a slow read; it is a slow read holding a lock that every other student booking that class is waiting behind.

### 3.2 The index set, and what each one is for

| # | Table | Index | Query served | Type |
|---|---|---|---|---|
| IX-1 | `bookings` | `(session_id) WHERE status = 'confirmed'` | **Capacity count inside `book_session`** | Partial |
| IX-2 | `sessions` | `(studio_id, starts_at)` | Public schedule for a week; reports date range | Composite |
| IX-3 | `bookings` | `(student_id, booked_at DESC)` | Student booking history | Composite |
| IX-4 | `waitlist_entries` | `(session_id, joined_at) WHERE status = 'waiting'` | **FIFO promotion selection** | Partial composite |
| IX-5 | `credit_grants` | `(student_id, status, expires_at)` | Earliest-expiring grant; balance | Composite |
| IX-6 | `credit_ledger` | `(student_id, created_at DESC)` | Ledger history, paginated | Composite |
| IX-7 | `studio_members` | `(user_id)` | Membership lookup on nearly every request | Single |
| IX-8 | `sessions` | `(instructor_id, starts_at) WHERE status = 'scheduled'` | Instructor's own schedule | Partial composite |
| IX-9 | `notifications` | `(recipient_id, created_at DESC)` | Notification centre | Composite |
| IX-10 | `notifications` | `(created_at) WHERE email_status = 'pending'` | Dispatch job queue | Partial |
| IX-11 | `bookings` | `(session_id) WHERE status='confirmed' AND attendance IS NULL` | Attendance finalisation job | Partial |
| IX-12 | `sessions` | `(recurrence_group_id) WHERE NOT NULL` | Recurrence group operations | Partial |

Exclusion constraints on `sessions` (room and instructor overlap) create their own GiST indexes, which additionally serve conflict-detection lookups.

### 3.3 Three principles illustrated by this set

**Partial indexes match the query's actual predicate.** IX-1 is the clearest case. A booking row is `confirmed` for its whole life or `cancelled` at the end, and the capacity count only ever asks about confirmed rows. Indexing only those rows produces a smaller structure that stays cached, and — critically — a cancelled booking's row is removed from the index rather than merely marked, so the index does not accumulate dead weight from years of cancellations.

**Composite column order follows the query's shape.** IX-2 is `(studio_id, starts_at)` and not the reverse, because every schedule query filters on an exact studio and then a time range. Postgres can seek directly to the studio and scan the range. Reversed, it would scan every studio's sessions in that range and filter — irrelevant with one studio, wrong the moment there are fifty.

**Restraint is part of the design.** `bookings` is the highest-write table in the system, and every index adds cost to every insert and update. Four indexes on `bookings` is deliberate; a fifth would need to justify itself against a measured query. We do not index `booking_source`, `credit_refunded` or `attendance` on their own, because no query filters by them alone.

### 3.4 Verification method

Index effectiveness is asserted rather than assumed. Before submission we will:

1. Seed a database at Year-3 volume (~60,000 bookings) using the fixture generator.
2. Run `EXPLAIN ANALYZE` on each of HQ-1 through HQ-6.
3. Confirm **Index Scan** or **Index Only Scan**, and the absence of **Seq Scan** on `bookings`, `sessions` and `credit_ledger`.
4. Record before/after timings for IX-1 specifically, by dropping and recreating it.

Step 4 produces the most useful single number for the presentation: the measured cost of the capacity count with and without its index. That is a concrete demonstration that the index is doing work, rather than an assertion that it should be.

---

## 4. Data Loading and Pagination

### 4.1 Rule one: every query is bounded

No query in the application fetches an unbounded set. Concretely:

| View | Bound |
|---|---|
| Public schedule | One week, via date range |
| Student bookings | Upcoming unbounded (small by nature); history paginated |
| Credit ledger | 25 per page |
| Admin students | 25 per page |
| Admin sessions | Date-range window |
| Notifications | 20 per page |
| Reports | Bounded date range, default 30 days |
| Roster | Naturally bounded by capacity (≤ 200) |

### 4.2 Rule two: select columns, not rows

`select('*')` is prohibited in `lib/data/`. The schedule needs a session's time, class type name, instructor name and counts — not its `cancellation_reason`, `created_by` or `recurrence_group_id`. This matters more than it appears: over-selected columns inflate the payload serialised from Server Component to Client Component, and they can turn an index-only scan into a heap fetch.

### 4.3 Rule three: the right pagination strategy per case

Two strategies, chosen deliberately rather than uniformly.

**Offset pagination** — used for the admin student list and the session list.

- Mechanism: `.range(offset, offset + 24)`
- Advantage: jump to any page; total count available
- Weakness: `OFFSET 10000` makes Postgres scan and discard 10,000 rows
- **Why acceptable here:** these lists are hundreds of rows, and offsets stay small. The weakness never materialises at this scale.

**Keyset (cursor) pagination** — used for the credit ledger, booking history and notifications.

- Mechanism: `WHERE (created_at, id) < (last_created_at, last_id) ORDER BY created_at DESC LIMIT 25`
- Advantage: **constant cost regardless of depth** — page 400 costs the same as page 1
- Advantage: stable under concurrent inserts; offset pagination can show a row twice or skip one when a new row arrives mid-browse
- Weakness: no page jumping
- **Why correct here:** these are append-heavy, time-ordered, and browsed by scrolling. The tiebreaker on `id` matters — two ledger entries can share a timestamp to the microsecond, and ordering by `created_at` alone would make the cursor ambiguous.

### 4.4 Rule four: aggregate, never loop

The N+1 elimination from §2 is stated as an enforceable rule: **any count, sum or derived rank displayed in a list is computed by the same query that fetches the list.** Code review rejects a `.map()` containing an `await` on a data function.

### 4.5 Rule five: revalidate narrowly

`revalidatePath` is called with the specific routes a mutation affects — `bookSession` revalidates `/schedule`, `/my/bookings` and `/my/credits`, and nothing else. A broad `revalidatePath('/', 'layout')` would discard the entire route cache on every booking, converting one student's action into a cache miss for everyone.

### 4.6 Caching posture in v1

| Route | Strategy | Reason |
|---|---|---|
| `/` landing | Static, revalidated hourly | Rarely changes |
| `/schedule` | Dynamic | Availability must be current; a cached "3 seats left" that is actually 0 is worse than a slower page |
| `/my/*` | Dynamic, per user | Personal data |
| `/admin/*` | Dynamic | Operational data |

Availability counts are deliberately **not** cached. Showing a stale seat count sends students into a booking that fails, which is a worse experience than the ~30ms the cache would have saved. §6 revisits this if traffic changes the calculus.

---

## 5. Client / Server Separation

### 5.1 Where the separation sits

| Concern | Location | Never in |
|---|---|---|
| Data fetching | Server Components, `lib/data/` | Client |
| Mutations | Server Actions | Client |
| Business rule enforcement | Postgres functions | Client or server TS |
| Authorisation | RLS + `lib/auth/` | Client |
| Secrets | Server env vars | Client bundle |
| Filtering, sorting, pagination | SQL | Client |
| Form state, dialogs, optimistic UI | Client | Server |

### 5.2 The separation as a scaling property

This is usually framed as a security concern. It is equally a scaling one.

**Filtering happens in SQL, not JavaScript.** The admin student search sends the search term to the server, which returns 25 matching rows. The alternative — fetch 200 students and filter in the browser — transfers eight times the data, and at 2,000 students transfers eighty times the data while the server does identical work. The pattern fails silently at small scale and catastrophically later.

**Page data never becomes JSON.** Server Components stream HTML. There is no API response to serialise, no client-side parse, and no hydration of a data layer. The browser receives markup, not a dataset plus the code to render it.

**The client bundle contains no data-access code.** No Supabase query builders for tables, no service key, no aggregation logic. The bundle is UI plus a handful of interactive islands, which keeps parse and execution cost low on the mid-range phones that dominate this audience.

### 5.3 Verification

Separation is asserted mechanically, not by convention:

| Check | Mechanism |
|---|---|
| No secret carries a `NEXT_PUBLIC_` prefix | `npm run audit:security` |
| `lib/supabase/service.ts` imported only by cron routes | ESLint `no-restricted-imports` |
| No writes outside `actions/` | Directory convention + review |
| Client bundle size | `@next/bundle-analyzer`, budget of 200KB gzipped for the student journey |

---

## 6. Current Limitations and Future Improvements

Stated honestly. Each entry gives the limitation, the scale at which it becomes a problem, and the intended remedy.

### 6.1 Limitations of v1

| # | Limitation | Becomes a problem at | Consequence today |
|---|---|---|---|
| L1 | **No caching layer.** Every schedule render queries Postgres. | ~50 requests/second sustained | None — well within capacity |
| L2 | **Reports computed on demand.** | ~100,000 bookings, or daily use | Admin waits ~300ms weekly |
| L3 | **No rate limiting.** A script could call `book_session` repeatedly. | Any deliberate abuse | Not exploitable for gain (credits still required) but wasteful |
| L4 | **Promotion email delayed up to 5 minutes** by cron granularity. | Immediately noticeable pre-class | In-app notification is instant; email lags |
| L5 | **No realtime UI updates.** Availability is stale until refresh. | High-contention popular classes | A student may click Book on a seat just taken and receive `SESSION_FULL` |
| L6 | **Single region.** One Supabase project, one location. | Geographically distributed users | ~100ms extra latency for distant users; irrelevant for one city |
| L7 | **Tables grow indefinitely.** No archival or partitioning. | Millions of rows | None for years |
| L8 | **Email dispatch capped** at 50 per 5-minute run. | ~600 notifications/hour | Sufficient; a mass cancellation of a 100-person event would queue briefly |
| L9 | **Hot-row lock serialises** bookings for one session. | Thousands of simultaneous bookings on one session | None at studio scale (§1.3) |
| L10 | **Single database, no read replica.** Reports and bookings share resources. | Heavy concurrent reporting | None at current volumes |
| L11 | **No visual regression or load testing.** | — | Regressions caught manually |

### 6.2 Improvements, in priority order

**Tier 1 — first things to add if usage grows**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| I1 | **Realtime availability** | L5 | Supabase Realtime subscription on the sessions view; seat counts update live without polling. Highest user-visible value — it removes the "I clicked and it was gone" moment on exactly the classes people care most about. |
| I2 | **Rate limiting** | L3 | Per-user, per-action limits at middleware (Upstash or Supabase edge). Cheap to add, closes an obvious gap. |
| I3 | **Faster notification dispatch** | L4 | Replace 5-minute polling with a Postgres `NOTIFY`/webhook triggered on insert, keeping cron as the retry sweeper. |

**Tier 2 — at roughly 10× current scale**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| I4 | **Materialised report rollups** | L2, L10 | Nightly-refreshed daily aggregates per session; reports read the rollup, not raw bookings. Turns an O(history) query into O(days in range). |
| I5 | **Cached public schedule** | L1 | `unstable_cache` with tag-based invalidation on booking change — retaining accuracy while absorbing anonymous read traffic. Only worthwhile once I1 exists to keep counts live. |
| I6 | **Read replica for reporting** | L10 | Route analytics reads to a replica so reporting cannot contend with booking. |

**Tier 3 — architectural, at 100×**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| I7 | **Partition `bookings` and `credit_ledger` by month** | L7 | Old partitions become cheap to archive; hot partition stays small |
| I8 | **Multi-region read replicas + edge rendering** | L6 | Only if the customer base becomes geographically distributed |
| I9 | **Optimistic-concurrency alternative to the row lock** | L9 | Version column with retry, or capacity as a maintained counter with a CHECK constraint. Would raise per-session throughput at the cost of a more complex correctness argument — deliberately *not* done in v1, because the current design's correctness is easy to prove and its ceiling is far above the need. |
| I10 | **Load testing in CI** | L11 | k6 or Artillery run against a preview deployment |

### 6.3 What we would *not* do, and why

Recording rejected optimisations, consistent with the assignment's emphasis on justified decisions:

| Rejected | Reason |
|---|---|
| Redis cache in v1 | Adds an invalidation surface and a failure mode to solve a problem we do not have. Cache correctness bugs are harder to find than slow queries. |
| Denormalised `seats_taken` counter on `sessions` | Would remove the count query, but introduces a value that can drift from reality. We already accept one maintained projection (`credits_remaining`) and defend it with a property test; a second one on the highest-contention row is a poor trade for a query that an index makes trivial. |
| Sharding or microservices | The entire dataset fits in memory. This would be complexity with negative return. |
| Client-side caching library | Would create a second source of truth for data the server already caches, reintroducing the staleness bugs described in Technical Design §6.2. |

### 6.4 What breaks first — the honest ordering

If this product grew far beyond its target, the failures would arrive in this order:

1. **Perceived staleness (L5)** — before any technical limit is reached, users notice availability counts lagging on contended classes. A user-experience failure, not a capacity one, and the first thing worth fixing.
2. **Report latency (L2)** — the first genuinely slow query, at roughly 100,000 bookings.
3. **Notification throughput (L8)** — if a studio ever cancels a very large event.
4. **PostgREST pool saturation** — under sustained traffic far beyond a single studio.
5. **Hot-row lock contention (L9)** — last, and only at a scale this product is not for.

That the first two failures are experiential rather than structural is the intended outcome of this design. The system is built so that its correctness guarantees hold long past the point where its convenience features would need attention.

---

## 7. Measurements to Confirm Before Submission

| # | Measurement | Method | Target |
|---|---|---|---|
| M1 | HQ-1 with and without IX-1, at Year-3 volume | `EXPLAIN ANALYZE` | Index scan; order-of-magnitude improvement demonstrated |
| M2 | Schedule page: query count | Query log | **Exactly 1** for 40 sessions |
| M3 | Admin student list: query count | Query log | **Exactly 1** for 25 students |
| M4 | `book_session` transaction duration | Function timing | < 10 ms |
| M5 | 20 concurrent bookings for the last seat | DB-04 harness | 1 success, correct final count, no timeouts |
| M6 | Reports over 12 months at Year-3 volume | `EXPLAIN ANALYZE` | < 200 ms |
| M7 | Client bundle, student journey | `@next/bundle-analyzer` | < 200 KB gzipped |
| M8 | No `Seq Scan` on `bookings`, `sessions`, `credit_ledger` | `EXPLAIN` on HQ-1…HQ-6 | Zero occurrences |

M2 and M4 are the two most valuable numbers for the presentation. M2 demonstrates that the N+1 was identified and eliminated; M4 demonstrates that the locking strategy has an ample throughput margin at the modelled scale.

---

*End of document — awaiting review before proceeding to the Basic Security document.*
