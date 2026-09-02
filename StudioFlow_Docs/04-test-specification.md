# Test Specification Document
## StudioFlow — Class Booking & Waitlist Management

**Course:** Internet Technologies — Become a Full-Stack Engineer, RUNI CS 2026
**Document:** Deliverable 6 of 10 — Test Specification (מסמך אפיון בדיקות)
**Version:** 1.1
**Status:** Revised — approved scope
**Depends on:** Product Specification v1.0, Technical Architecture v1.0, Detailed Technical Design v1.0 (all approved)

**Revision history**

| Version | Change |
|---|---|
| 1.0 | Initial specification |
| 1.1 | Negative-control test (former DB-06) withdrawn from scope. Concurrency coverage of INV-1 reduced from four levels to three. Exit criterion 4 restated against DB-01. Traceability tables, suite counts and untested-scope register updated accordingly. Identifier DB-06 retired and not reused. |

---

## 0. Purpose and Testing Philosophy

The assignment states that the goal of this document is to demonstrate that we can define what it means for the product to *work*. That definition is not "the buttons respond." It is: **the seven system invariants from the Detailed Technical Design hold under every condition the product can encounter, including adversarial and concurrent ones.**

### 0.1 What we test, and what we deliberately do not

The assignment is explicit that not every line must be tested, but that core processes must be. We apply a simple filter:

| Test it when | Skip it when |
|---|---|
| A failure costs a student money or a seat | It is a presentational detail with no state |
| A failure lets one user reach another's data | It is already guaranteed by a database constraint *and* that constraint is itself tested |
| The logic encodes a business rule | It is framework behaviour we did not write |
| The behaviour only emerges under concurrency | It is a third-party library's own responsibility |

We do not chase a coverage percentage. A suite at 90% coverage that never runs two bookings simultaneously has not tested the thing most likely to break.

### 0.2 The testing pyramid for this system

```
                 ┌──────────────────┐
                 │   Manual (12)    │  Email rendering, real-device UX,
                 │                  │  screen reader, deployment smoke
                 ├──────────────────┤
                 │  E2E — Playwright│  Full user journeys across pages,
                 │      (18)        │  cross-browser, concurrency at HTTP level
                 ├──────────────────┤
                 │   Integration    │  RPC functions against real Postgres,
                 │  Vitest + local  │  RLS policies, Server Actions,
                 │   Supabase (53)  │  ← THE HEAVIEST LAYER, deliberately
                 ├──────────────────┤
                 │  Unit — Vitest   │  Pure domain functions:
                 │      (31)        │  policy windows, recurrence, balances
                 └──────────────────┘
```

The integration layer is intentionally the largest. This is an inversion of the conventional pyramid, and it is justified: **the correctness of this system lives in Postgres.** The row lock, the exclusion constraints, the partial unique indexes and the RLS policies cannot be tested by mocking a database. A unit test with a stubbed Supabase client would prove that our TypeScript calls a function, not that the function is correct.

### 0.3 Tooling

| Layer | Tool | Environment |
|---|---|---|
| Unit | Vitest | Node, no I/O |
| Integration | Vitest + `supabase start` (local Docker stack) | Real Postgres, real RLS, real functions |
| Raw-connection concurrency | Vitest + `node-postgres` | Two independently controlled transactions |
| E2E | Playwright (Chromium, WebKit) | Built Next.js app + local Supabase |
| Manual | Documented checklist | Preview deployment on Vercel |

**Fallback:** if Docker is unavailable, integration tests run against a dedicated Supabase test project, reset by a teardown script between runs. This is slower and must not be the default, because tests that share a remote database cannot run in parallel safely.

### 0.4 How time is controlled

Time-dependent rules (BR-1, BR-3, BR-8, BR-11, BR-13) need deterministic tests. Two different techniques, applied deliberately:

| Layer | Technique | Reason |
|---|---|---|
| Pure domain functions | `now` is an **explicit parameter**, never read from the ambient clock | Makes boundary cases trivially testable and removes hidden global state |
| Database functions | **Move the session, not the clock** — create a session at `now() + 13 hours` to test a 12-hour window | Postgres `now()` cannot be mocked from the client; faking it would test a fiction |

This is why `lib/domain/policy.ts` takes `now` as an argument. It is a testability decision, recorded here so it is not later "simplified" away.

### 0.5 Test data

`supabase/seed.sql` and `tests/fixtures/` provide a deterministic world:

| Fixture | Purpose |
|---|---|
| **Studio A** — "Flow Studio", 12h window, 2h cutoff, Asia/Jerusalem | Primary subject |
| **Studio B** — "Other Studio" | Exists solely to prove isolation (INV-6) |
| `admin.a@test`, `instructor1.a@test`, `instructor2.a@test` | Studio A staff |
| `student1.a@test` … `student6.a@test` | Varied credit balances, including zero |
| `admin.b@test`, `student1.b@test` | Studio B — every cross-studio test's attacker |
| Rooms: Main (14 mats), Small (6 mats) | Capacity variety |
| Class types: Vinyasa (60m), Reformer (50m) | — |

Sessions are created **relative to `now()`** inside each test, never as fixed dates. A fixture with a hard-coded date passes in March and fails in April.

### 0.6 Identifier scheme

| Prefix | Section | Layer |
|---|---|---|
| `CF-` | Core features | Mixed |
| `IV-` | Invalid input | Unit / Integration |
| `BF-` | Business flows | Integration / E2E |
| `PR-` | Permissions & RLS | Integration |
| `DB-` | Database & edge cases | Integration |
| `UI-` | User interface | E2E / Manual |

---

## 1. Tests for Core Features

### 1.1 Authentication and membership

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-01 | Register with valid details | Account created, `profiles` row exists, `studio_members` row with role `student` | Integration |
| CF-02 | Register with an already-registered email | Rejected, no duplicate profile | Integration |
| CF-03 | Log in with correct credentials | Session established, redirect to schedule | E2E |
| CF-04 | Log in with wrong password | Generic failure message, no session | E2E |
| CF-05 | Log out | Session cleared, protected routes redirect | E2E |
| CF-06 | Admin creates instructor account | Account created, role `instructor`, `must_change_password` true, temporary password returned exactly once | Integration |
| CF-07 | Instructor first login with temporary password | Forced to password-change screen; other routes inaccessible until changed | E2E |
| CF-08 | Instructor changes password | `must_change_password` false, normal navigation available | E2E |
| CF-09 | Deactivated member attempts login | Session may exist but all studio data returns empty; booking blocked | Integration |

### 1.2 Schedule and catalogue

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-10 | Admin creates a room | Row created, capacity stored | Integration |
| CF-11 | Admin creates a class type | Row created with duration | Integration |
| CF-12 | Admin creates a single session | Row created, `ends_at` = `starts_at` + duration, capacity defaulted from room | Integration |
| CF-13 | Session capacity defaults from room but can be overridden lower | Stored value is the override | Integration |
| CF-14 | Admin generates 4 weekly occurrences | 4 sessions created, same `recurrence_group_id`, 7 days apart in **local** time | Integration |
| CF-15 | Admin edits one occurrence of a recurrence group | Only that session changes | Integration |
| CF-16 | Anonymous visitor views schedule | Scheduled future sessions visible without a session cookie | E2E |
| CF-17 | Cancelled sessions absent from public schedule | Not listed | Integration |
| CF-18 | Past sessions absent from upcoming schedule | Not listed | Integration |
| CF-19 | Availability badge reflects live count | 14-capacity session with 8 bookings shows 6 remaining | Integration |

### 1.3 Booking and waitlist

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-20 | Student with credits books an open session | Booking `confirmed`, balance decremented by exactly 1, ledger entry written | Integration |
| CF-21 | Booking consumes the **earliest-expiring** grant | That grant's `credits_remaining` decrements; later grant untouched | Integration |
| CF-22 | Student cancels outside the window | Booking `cancelled`, `credit_refunded` true, credit returned **to the originating grant** | Integration |
| CF-23 | Student cancels inside the window | Booking `cancelled`, `credit_refunded` false, balance unchanged | Integration |
| CF-24 | Student joins waitlist for a full session | Entry created `waiting`, **no credit deducted** | Integration |
| CF-25 | Waitlist position is derived correctly | Three joiners see positions 1, 2, 3 by `joined_at` | Integration |
| CF-26 | Student leaves waitlist | Status `left`, remaining positions shift up | Integration |
| CF-27 | Automatic promotion on cancellation | First waiting student becomes `confirmed`, credit deducted, `source` = `waitlist_promotion`, notification row created | Integration |

### 1.4 Credits

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-28 | Admin grants a 10-credit package | Grant row created, ledger `+10`, balance increased by 10 | Integration |
| CF-29 | Balance equals sum of active grant remainders | Matches across multiple grants | Integration |
| CF-30 | Ledger displays a human-readable history | Entry per movement with type and linked session | Integration |
| CF-31 | Grant reaching zero becomes `exhausted` | Status transitions | Integration |
| CF-32 | Admin adjustment with reason | Ledger `adjustment` entry with note recorded | Integration |

### 1.5 Attendance

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-33 | Instructor views roster for own session | Confirmed bookings listed with student names | Integration |
| CF-34 | Instructor marks a student present | `attendance` = `attended`, `attendance_marked_by` set | Integration |
| CF-35 | Instructor marks a student absent | `attendance` = `absent`, **no credit refunded** (BR-10) | Integration |
| CF-36 | Marks save individually | Marking student 3 does not alter students 1, 2, 4 | Integration |
| CF-37 | Cancelled bookings excluded from roster | Not shown | Integration |

### 1.6 Notifications

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-38 | Promotion creates a notification row | Row with type `waitlist_promoted`, `email_status` `pending` | Integration |
| CF-39 | Dispatch job sends and marks | `email_status` `sent`, `email_sent_at` populated | Integration |
| CF-40 | In-app centre shows unread notifications | Unread count correct | E2E |
| CF-41 | Marking read sets `read_at` | Count decrements | Integration |

### 1.7 Reporting

| ID | Test | Expected | Layer |
|---|---|---|---|
| CF-42 | Fill rate computed correctly | 14-capacity session with 7 attended = 50% | Integration |
| CF-43 | No-show rate excludes cancellations | Only `absent` counted, not `cancelled` | Integration |
| CF-44 | Waitlist conversion counts promotions | Bookings with `source` = `waitlist_promotion` over total entries | Integration |
| CF-45 | Inactive-student list respects the threshold | Student with attendance 40 days ago appears at a 30-day threshold | Integration |

---

## 2. Invalid Input Tests

The premise of this section: **the client is not trusted.** Every case below is executed by calling the Server Action or RPC directly, bypassing the form entirely — because that is what an attacker does with `curl` and a valid session cookie.

### 2.1 Malformed and hostile values

| ID | Input | Expected |
|---|---|---|
| IV-01 | `sessionId` = `"not-a-uuid"` | `VALIDATION_FAILED`, no database call issued |
| IV-02 | `sessionId` = `null` / omitted | `VALIDATION_FAILED` |
| IV-03 | `sessionId` = valid UUID, nonexistent | `SESSION_NOT_FOUND` |
| IV-04 | `full_name` = `""` | `VALIDATION_FAILED`, field-level error |
| IV-05 | `full_name` = 500 characters | `VALIDATION_FAILED` (max 100) |
| IV-06 | `full_name` = `"<script>alert(1)</script>"` | Stored as literal text; **rendered escaped**, never executed |
| IV-07 | `note` containing `'; DROP TABLE bookings; --` | Stored as literal text; parameterised queries make it inert |
| IV-08 | `email` = `"notanemail"` | `VALIDATION_FAILED` |
| IV-09 | `password` = `"12345"` | `VALIDATION_FAILED` (minimum length) |
| IV-10 | Unicode / RTL name (Hebrew) | Accepted, stored and rendered correctly |

### 2.2 Out-of-range numeric values

| ID | Input | Expected |
|---|---|---|
| IV-11 | Room capacity = `0` | `VALIDATION_FAILED`; CHECK constraint as backstop |
| IV-12 | Room capacity = `-5` | `VALIDATION_FAILED` |
| IV-13 | Room capacity = `999999` | `VALIDATION_FAILED` (max 200) |
| IV-14 | Grant credits = `0` | `VALIDATION_FAILED` |
| IV-15 | Grant credits = `-10` | `VALIDATION_FAILED` — negative grants must go through `adjustCredits` with a reason |
| IV-16 | Class duration = `5` minutes | `VALIDATION_FAILED` (min 15) |
| IV-17 | Recurrence weeks = `0` | `VALIDATION_FAILED` |
| IV-18 | Recurrence weeks = `52` | `VALIDATION_FAILED` (max 12) |
| IV-19 | `cancellation_window_hours` = `-1` | `VALIDATION_FAILED` |
| IV-20 | Credits as float `2.5` | `VALIDATION_FAILED` (integer required) |

### 2.3 Temporal and logical invalidity

| ID | Input | Expected |
|---|---|---|
| IV-21 | Session `starts_at` in the past | `VALIDATION_FAILED` |
| IV-22 | Session `ends_at` before `starts_at` | `VALIDATION_FAILED`; CHECK constraint as backstop |
| IV-23 | Grant `expires_at` in the past | `VALIDATION_FAILED` |
| IV-24 | Book a session that has already started | `SESSION_STARTED` (BR-8) |
| IV-25 | Book a cancelled session | `SESSION_CANCELLED` |
| IV-26 | Cancel an already-cancelled booking | `ALREADY_CANCELLED`, idempotent — no second refund |
| IV-27 | Mark attendance before session start | `ATTENDANCE_WINDOW_CLOSED` |
| IV-28 | Mark attendance 25 hours after end | `ATTENDANCE_WINDOW_CLOSED` (BR-11) |
| IV-29 | Join waitlist for a session with space | Rejected — offer booking instead |
| IV-30 | Book while already booked | `ALREADY_BOOKED` (BR-6) |
| IV-31 | Book while already waitlisted | `ALREADY_WAITLISTED` (BR-6) |
| IV-32 | Book with zero balance | `INSUFFICIENT_CREDITS` (BR-4) |
| IV-33 | Book using only an expired grant | `INSUFFICIENT_CREDITS` |

### 2.4 Error presentation

| ID | Test | Expected |
|---|---|---|
| IV-34 | Any Postgres constraint violation surfaces to the user | Mapped `ErrorCode` and friendly text — **never** SQLSTATE, constraint name, or SQL fragment |
| IV-35 | Unmapped exception | `INTERNAL_ERROR` to the user; full detail in server logs only |
| IV-36 | Validation failure returns field-level errors | `fieldErrors` keyed by field name, rendered inline |

---

## 3. Core Business Flow Tests

These follow the flows in Product Specification §7 end to end, and are the tests that prove the product delivers its stated business goals.

### 3.1 BF-01 — Registration to first booking (Flow 1)

| Step | Action | Expected |
|---|---|---|
| 1 | Anonymous visitor opens `/schedule` | Sessions visible, no login wall |
| 2 | Selects a session, clicks Book | Redirected to login/register |
| 3 | Registers | Account created, returned to session |
| 4 | Attempts booking with zero balance | `INSUFFICIENT_CREDITS`, prompt to contact studio |
| 5 | Admin grants 10 credits | Balance = 10 |
| 6 | Student books | Confirmed, balance = 9 |

**Business goal proven:** G4 — the credit mechanism gates and enables service sale.

### 3.2 BF-02 — Cancellation outside the window with promotion (Flow 5, the core loop)

| Step | Setup / Action | Expected |
|---|---|---|
| 1 | Session capacity 2, starts in 48h, students S1 and S2 booked | 2 confirmed |
| 2 | S3 joins waitlist, then S4 joins | Positions 1 and 2, no credits deducted |
| 3 | S1 cancels | S1 `cancelled`, credit refunded to originating grant |
| 4 | *(same transaction)* | S3 promoted to `confirmed`, `source` = `waitlist_promotion`, credit deducted |
| 5 | — | S4 remains waiting, now position 1 |
| 6 | — | Notification row for S3, `email_status` `pending` |
| 7 | Dispatch job runs | Email marked sent |
| 8 | — | Confirmed count still exactly 2 (INV-1) |

**Business goal proven:** G1 — the seat is refilled with zero administrative action. This is the single most important test in the suite.

### 3.3 BF-03 — Cancellation inside the window

| Step | Action | Expected |
|---|---|---|
| 1 | Session starts in 6h (window is 12h), S1 booked | — |
| 2 | S1 opens cancel dialog | Dialog states the credit will **not** be returned |
| 3 | S1 confirms | `cancelled`, `credit_refunded` false, balance unchanged (BR-2) |
| 4 | — | Waitlisted S2 still promoted if outside the 2h cutoff — the seat is refilled even though S1 forfeited |

**Business goal proven:** G3 — the policy is enforced impersonally, and forfeiting a credit does not prevent refilling the seat.

### 3.4 BF-04 — Promotion suppressed inside the cutoff

| Step | Action | Expected |
|---|---|---|
| 1 | Session starts in 90 minutes (cutoff is 2h), full, S2 waiting | — |
| 2 | S1 cancels | `cancelled`, no refund (inside window) |
| 3 | — | **No promotion.** S2 remains `waiting`, no credit deducted, no notification |
| 4 | — | Seat is open for direct booking by anyone |

**Rule proven:** BR-3. Notifying someone 90 minutes before a 07:00 class is not a service.

### 3.5 BF-05 — FIFO with insufficient-credit skip

| Step | Setup | Expected |
|---|---|---|
| 1 | Full session; waitlist order S2 (balance 0), S3 (balance 5), S4 (balance 2) | — |
| 2 | S1 cancels | — |
| 3 | — | **S3 promoted**, not S2 |
| 4 | — | S2 remains `waiting` with position 1, unpenalised |
| 5 | — | S4 remains `waiting` |

**Rule proven:** BR-7. The queue is not blocked by someone who cannot pay; the seat is filled.

### 3.6 BF-06 — Studio cancels a session (Flow 8)

| Step | Action | Expected |
|---|---|---|
| 1 | Session in 3h (inside cancellation window), 5 booked, 2 waiting | — |
| 2 | Admin cancels with reason | `status` = `cancelled`, reason stored |
| 3 | — | **All 5 refunded regardless of the window** (BR-9) |
| 4 | — | Each refund returns to its originating grant |
| 5 | — | 7 notifications created (5 booked + 2 waiting) |
| 6 | — | Session absent from public schedule |
| 7 | Instructor cancels own session | Same outcome; instructor may cancel only sessions they teach |

### 3.7 BF-07 — Attendance to reporting (Flow 7 → Flow 9)

| Step | Action | Expected |
|---|---|---|
| 1 | Session ends; 10 booked | — |
| 2 | Instructor marks 8 present, 1 absent, leaves 1 unmarked | Marks stored individually |
| 3 | Finalisation job runs after the window | Unmarked → `attended`, `attendance_auto_resolved` true (BR-12) |
| 4 | Admin opens reports | Attendance 9/10, no-show rate 10% |
| 5 | — | No credit movement occurred in steps 2–3 |

### 3.8 BF-08 — Grant expiry (BR-13)

| Step | Action | Expected |
|---|---|---|
| 1 | Student holds a grant of 10, 4 used, expiring yesterday | `credits_remaining` = 6 |
| 2 | Expiry job runs | Ledger entry `-6` type `expiry`; `credits_remaining` = 0; status `expired` |
| 3 | — | Balance excludes the expired grant |
| 4 | — | Student's ledger shows a dated, plain-language expiry line |
| 5 | Job runs again | **Idempotent** — no second expiry entry |

### 3.9 BF-09 — Recurring schedule generation with conflict (Flow 2)

| Step | Action | Expected |
|---|---|---|
| 1 | Existing session Tuesday 07:00 in Main room, week 3 | — |
| 2 | Admin generates 12 weekly Tuesday 07:00 sessions in Main | — |
| 3 | — | 11 created; week 3 rejected by the exclusion constraint |
| 4 | — | Result reports the specific conflicting date and reason |
| 5 | — | Weeks 1–2 and 4–12 exist and are bookable |

---

## 4. Permissions and Roles Tests (Auth / RLS)

### 4.1 Test methodology — this section's most important paragraph

**Every test in this section bypasses the application entirely.**

Each test constructs a Supabase client using the **public anon key** and the target user's **own JWT**, then issues PostgREST queries directly against tables. No Server Action, no page, no middleware is involved.

This is deliberate and it is the only methodology that proves anything. Testing permissions through the UI proves that the UI hides a button. It does not prove that a user who opens the browser console — where the anon key and their own JWT are both plainly available — cannot read the entire students table. RLS is the only real boundary, so RLS is what we test.

### 4.2 Unauthenticated access

| ID | Attempt | Expected |
|---|---|---|
| PR-01 | Read `sessions` with no JWT | Only `scheduled` future sessions (public schedule is intentional) |
| PR-02 | Read `bookings` with no JWT | **0 rows** |
| PR-03 | Read `profiles` with no JWT | **0 rows** |
| PR-04 | Read `credit_ledger` with no JWT | **0 rows** |
| PR-05 | Read `credit_grants` with no JWT | **0 rows** |
| PR-06 | Insert into `bookings` with no JWT | Rejected |
| PR-07 | Call `book_session` RPC with no JWT | `NOT_AUTHENTICATED` |
| PR-08 | Request `/admin` unauthenticated | Redirect to login |

### 4.3 Student boundaries

| ID | Attempt (as S1) | Expected |
|---|---|---|
| PR-09 | Read own bookings | Own rows only |
| PR-10 | Read S2's bookings | **0 rows** |
| PR-11 | Read own ledger | Own rows only |
| PR-12 | Read S2's ledger | **0 rows** |
| PR-13 | Read S2's `credit_grants` | **0 rows** |
| PR-14 | **Insert into `credit_ledger` directly** | **Rejected — no insert policy exists for students** |
| PR-15 | **Update own `credit_grants.credits_remaining`** | **Rejected** |
| PR-16 | Update own booking `attendance` to `attended` | Rejected |
| PR-17 | Cancel S2's booking via RPC | `FORBIDDEN` |
| PR-18 | Insert into `sessions` | Rejected |
| PR-19 | Update `studios` policy settings | Rejected |
| PR-20 | Read all `profiles` in studio | Only own, plus instructor names on the public schedule |
| PR-21 | Update own `studio_members.role` to `admin` | **Rejected — privilege escalation blocked** |
| PR-22 | Read `notifications` addressed to S2 | **0 rows** |

PR-14, PR-15 and PR-21 are the highest-severity tests in the suite. They are the difference between a credit system and a suggestion.

### 4.4 Instructor boundaries

| ID | Attempt (as Instructor 1) | Expected |
|---|---|---|
| PR-23 | Read roster for own taught session | Booked students' names visible |
| PR-24 | Read roster for **Instructor 2's** session | **0 rows** |
| PR-25 | Mark attendance on own session | Succeeds |
| PR-26 | Mark attendance on Instructor 2's session | `FORBIDDEN` |
| PR-27 | Read any student's `credit_ledger` | **0 rows** |
| PR-28 | Read any student's `credit_grants` | **0 rows** |
| PR-29 | Read students' email or phone | **Not exposed** — roster shows names only |
| PR-30 | Enumerate all `studio_members` | Only own row |
| PR-31 | Create a session | Rejected |
| PR-32 | Cancel own taught session | Succeeds |
| PR-33 | Cancel Instructor 2's session | `FORBIDDEN` |
| PR-34 | Grant credits | Rejected |
| PR-35 | Access `/admin/reports` | Redirected; direct query returns nothing |

### 4.5 Admin scope

| ID | Attempt (as Admin A) | Expected |
|---|---|---|
| PR-36 | Read all bookings in Studio A | All rows |
| PR-37 | Read all ledgers in Studio A | All rows |
| PR-38 | Grant credits | Succeeds, `created_by` recorded |
| PR-39 | Manually book a student | Succeeds, `source` = `admin` |
| PR-40 | **Update a `credit_ledger` row** | **Rejected — append-only for every role, including admin** (INV-4) |
| PR-41 | **Delete a `credit_ledger` row** | **Rejected** |
| PR-42 | Delete a `booking` row | Rejected — cancellation only |
| PR-43 | Update studio policy | Succeeds |

PR-40 through PR-42 verify that the append-only and no-hard-delete guarantees are structural, not conventional. An admin who can silently edit the ledger destroys its value as an audit record.

### 4.6 Cross-studio isolation (INV-6)

Executed as `admin.b@test` — an administrator of a *different* studio, i.e. the most privileged plausible attacker.

| ID | Attempt (as Admin B) | Expected |
|---|---|---|
| PR-44 | Read Studio A `sessions` beyond the public schedule | Public rows only, no management fields |
| PR-45 | Read Studio A `bookings` | **0 rows** |
| PR-46 | Read Studio A `profiles` | **0 rows** |
| PR-47 | Read Studio A `credit_ledger` | **0 rows** |
| PR-48 | Read Studio A `credit_grants` | **0 rows** |
| PR-49 | Read Studio A `studio_members` | **0 rows** |
| PR-50 | Insert a session into Studio A | Rejected |
| PR-51 | Grant credits to a Studio A student | Rejected |
| PR-52 | `book_session` on a Studio A session | `FORBIDDEN` |
| PR-53 | `cancel_session` on a Studio A session | `FORBIDDEN` |
| PR-54 | Read Studio A `notifications` | **0 rows** |

### 4.7 Cron endpoint protection

| ID | Attempt | Expected |
|---|---|---|
| PR-55 | `GET /api/cron/finalize-attendance` with no secret | 401, no mutation |
| PR-56 | Same with an incorrect secret | 401 |
| PR-57 | Same with the correct secret | 200, job executes |
| PR-58 | `SUPABASE_SERVICE_ROLE_KEY` present in the client bundle | **Absent** — asserted by grepping the built output |

PR-58 is a build-artifact test rather than a runtime test. It runs `next build` and searches `.next/static` for the secret. A single accidental `NEXT_PUBLIC_` prefix would publish a key that bypasses every policy in §4, so this is checked mechanically rather than by review.

---

## 5. Database and Edge Case Tests

### 5.1 The concurrency invariant (INV-1) — the centrepiece

**The bug we are testing for.** A naive implementation reads the booking count, compares it to capacity, and inserts. Two requests for the final seat both read 13-of-14, both pass the check, and both insert. Fifteen bookings exist for fourteen mats.

This must be tested at three levels, because each proves something the others cannot.

---

#### 5.1.1 Level 1 — Deterministic lock proof (`DB-01`)

The probabilistic tests below can pass by luck. This one cannot. It uses two **raw Postgres connections** via `node-postgres`, with manually controlled transaction boundaries.

| Step | Connection A | Connection B | Assertion |
|---|---|---|---|
| 1 | `BEGIN` | — | — |
| 2 | `SELECT … FROM sessions WHERE id = X FOR UPDATE` | — | A holds the row lock |
| 3 | — | `BEGIN` | — |
| 4 | — | Call `book_session(X)` — **does not return** | **B is blocked**, verified by asserting the promise is unresolved after 500ms |
| 5 | Insert the final booking; `COMMIT` | — | Session now at capacity |
| 6 | — | B unblocks, re-reads count | — |
| 7 | — | Returns `SESSION_FULL` | **B does not overbook** |
| 8 | — | — | `COUNT(*) WHERE confirmed` = `capacity`, exactly |

**What this proves that nothing else does:** that the second transaction genuinely *waited*, and that when it resumed it observed the first transaction's write. Step 4's assertion — that the call is still pending — is the direct evidence that `FOR UPDATE` is doing its job. If the lock were removed, step 4 would return immediately and the test would fail for the right reason.

---

#### 5.1.2 Level 2 — Concurrent load at the RPC layer (`DB-02` … `DB-05`)

| ID | Setup | Concurrency | Expected |
|---|---|---|---|
| DB-02 | Capacity 1, 0 booked, 10 students each with credits | 10 simultaneous `book_session` via `Promise.all` | Exactly **1** `ok`, **9** `SESSION_FULL`; `COUNT` = 1 |
| DB-03 | Capacity 5, 0 booked, 20 students | 20 simultaneous | Exactly **5** succeed; `COUNT` = 5 |
| DB-04 | Capacity 14, 13 booked, 8 students | 8 simultaneous for the last seat | Exactly **1** succeeds; `COUNT` = 14 |
| DB-05 | DB-02 repeated **30 times** with a fresh session each iteration | — | Every iteration yields exactly 1 success — a single overbook across 30 trials is a failure |

DB-05 exists because a race condition that manifests one time in twenty will pass a single-run test and then fail in the demo.

---

#### 5.1.3 Level 3 — End-to-end concurrency (`DB-07`)

| ID | Test | Expected |
|---|---|---|
| DB-07 | 4 Playwright workers, 4 authenticated browser contexts, all click Book on the last seat within the same moment | 1 sees confirmation; 3 see "This class is full — join the waitlist?"; database holds exactly `capacity` |

This proves the guarantee survives the full stack — middleware, Server Action, RPC — and not merely the database in isolation.

### 5.2 Other concurrency scenarios

| ID | Scenario | Expected |
|---|---|---|
| DB-08 | Two students cancel simultaneously from a session with 2 waiting | **Two distinct** students promoted — never the same person twice |
| DB-09 | One student double-clicks Cancel | One cancellation, one refund; second returns `ALREADY_CANCELLED` |
| DB-10 | One student double-clicks Book | One booking, one deduction (partial unique index, INV-3) |
| DB-11 | Student books while admin cancels the session concurrently | Either booking then refund, or `SESSION_CANCELLED` — never a confirmed booking on a cancelled session |
| DB-12 | Student joins waitlist while another student cancels | Either booked directly or waitlisted then promoted — never both |
| DB-13 | Two admins create overlapping sessions in the same room simultaneously | One succeeds, one `ROOM_CONFLICT` (INV-7) |
| DB-14 | Concurrent bookings by one student against two different grants | Exactly one credit consumed per booking; no grant goes negative |

### 5.3 Constraint and invariant verification

| ID | Test | Invariant |
|---|---|---|
| DB-15 | Direct insert of a booking exceeding capacity, bypassing the RPC | Structurally prevented or detected | INV-1 |
| DB-16 | For every grant: `credits_remaining` = sum of ledger deltas with that `grant_id` | **INV-2** |
| DB-17 | No student holds both a `confirmed` booking and a `waiting` entry for one session | **INV-3** |
| DB-18 | `UPDATE`/`DELETE` on `credit_ledger` rejected for all roles | **INV-4** |
| DB-19 | Promotion order is non-decreasing in `joined_at` across a long sequence | **INV-5** |
| DB-20 | Cross-studio read returns zero rows (see §4.6) | **INV-6** |
| DB-21 | No two scheduled sessions overlap in one room; same for one instructor | **INV-7** |
| DB-22 | Second insert of a duplicate confirmed booking | Partial unique index violation |
| DB-23 | Negative `credits_remaining` | CHECK constraint violation |
| DB-24 | Session with `ends_at` <= `starts_at` | CHECK constraint violation |

**INV-2 (DB-16) is written as a property test**: run a randomised sequence of grants, bookings, cancellations, refunds and expiries against a student, then assert the ledger and the projection agree. This is the test that guards the design amendment recorded in Detailed Technical Design §0.1 — the reason we were willing to introduce a maintained column at all.

### 5.4 Boundary conditions

Every rule with a threshold is tested exactly at the threshold, one unit inside, and one unit outside.

| ID | Scenario | Expected |
|---|---|---|
| DB-25 | Cancel at exactly 12h 00m 00s before start (window = 12h) | **Refunded** — the rule is "at or before" (BR-1) |
| DB-26 | Cancel at 11h 59m before start | Not refunded |
| DB-27 | Cancel at 12h 01m before start | Refunded |
| DB-28 | Cancellation at exactly the 2h promotion cutoff | Promotion **suppressed** (BR-3) |
| DB-29 | Cancellation at 2h 01m | Promotion occurs |
| DB-30 | Book 1 second before `starts_at` | Succeeds |
| DB-31 | Book 1 second after `starts_at` | `SESSION_STARTED` |
| DB-32 | Mark attendance at exactly `ends_at` + window | Boundary defined and tested consistently |
| DB-33 | Grant expiring at exactly `now()` | Treated as expired |
| DB-34 | Last credit in the last active grant | Booking succeeds, balance 0, grant `exhausted` |
| DB-35 | Session capacity exactly 1 | Books, fills, waitlists correctly |
| DB-36 | Waitlist of exactly 1 with sufficient credit | Promoted on cancellation |
| DB-37 | Waitlist of exactly 1 with zero credit | Not promoted; seat left open; entry remains `waiting` |

### 5.5 Timezone and daylight saving

The highest-risk non-concurrency area in the system.

| ID | Scenario | Expected |
|---|---|---|
| DB-38 | 12 weekly occurrences of a 07:00 class spanning a DST transition | **All 12 at 07:00 local time**; UTC instant shifts by one hour across the boundary |
| DB-39 | Session stored as UTC displayed to a browser in a different timezone | Rendered in **studio** timezone, not browser timezone |
| DB-40 | Cancellation window calculated across a DST boundary | Correct elapsed hours, not a naive local-clock subtraction |
| DB-41 | Session created at 23:30 local, duration 60m | `ends_at` correctly crosses midnight and the date boundary |
| DB-42 | Schedule grouped by local day, not UTC day | A 01:00 local class appears on the correct local date |

DB-38 is the test that catches the naive recurrence implementation: adding seven days to a UTC timestamp twelve times produces a class at 06:00 for half the term.

### 5.6 Job idempotency and resilience

| ID | Scenario | Expected |
|---|---|---|
| DB-43 | Attendance finalisation runs twice | Second run changes nothing; no duplicate resolution |
| DB-44 | Expiry job runs twice | No duplicate expiry ledger entries |
| DB-45 | Dispatch job runs twice on the same pending row | Email sent once |
| DB-46 | Email provider returns an error | `email_attempts` increments, `last_error` stored, row retried |
| DB-47 | Third consecutive failure | `email_status` = `failed`; **in-app notification still visible** (assumption A4) |
| DB-48 | Provider fails entirely during a promotion | **Booking and promotion are unaffected** — proves external I/O is outside the transaction |

DB-48 is the direct test of architectural principle 5. It is executed by pointing the dispatcher at an unreachable endpoint and confirming the booking state is untouched.

### 5.7 Data integrity edge cases

| ID | Scenario | Expected |
|---|---|---|
| DB-49 | Admin reduces session capacity below current bookings | Rejected, or accepted with existing bookings preserved — behaviour defined, never silently dropping a student |
| DB-50 | Room capacity changed after sessions exist | Existing session capacities unchanged |
| DB-51 | Instructor deactivated with future sessions assigned | Sessions flagged for reassignment; not silently orphaned |
| DB-52 | Class type deactivated with future sessions | Existing sessions unaffected; unavailable for new creation |
| DB-53 | Student deactivated holding future bookings | Behaviour defined and tested |
| DB-54 | Session with zero bookings cancelled | Succeeds, no refunds, no notifications |
| DB-55 | Ledger sum for every seeded student matches displayed balance | Global consistency sweep after the full suite runs |

DB-55 runs last and acts as a whole-system audit: after roughly 150 tests have moved credits in every possible way, no student's books are out of balance.

---

## 6. Basic UI Tests

### 6.1 Automated — Playwright

| ID | Test | Expected |
|---|---|---|
| UI-01 | Anonymous user reaches the schedule | Sessions render, no login wall |
| UI-02 | Availability badge states | Green with count / amber under 3 / grey "Full · N waiting" |
| UI-03 | Booking success feedback | Button resolves to booked state, toast shown, balance in nav decrements |
| UI-04 | Booking failure feedback | Specific message shown; **waitlist offered on `SESSION_FULL`** |
| UI-05 | **Cancel dialog states the refund consequence before confirmation** | Correct one of the two messages, matching the actual outcome |
| UI-06 | Cancel dialog destructive styling | Applied only in the no-refund case |
| UI-07 | Waitlist position renders and updates | Position shown; decrements when someone ahead leaves |
| UI-08 | Credit balance persistently visible in student navigation | Present on every student page |
| UI-09 | Ledger renders plain-language descriptions | Each row human-readable |
| UI-10 | Role-appropriate navigation | Student, instructor and admin each see only their own sections |
| UI-11 | Attendance toggle saves individually | Marking one student leaves others untouched; UI reflects each |
| UI-12 | Recurrence preview lists dates before submission | Exact dates shown; conflicts flagged pre-submit |
| UI-13 | Form validation errors render inline | Attached to the correct field |
| UI-14 | Empty states are instructive | New studio shows how to create a class, not a blank page |
| UI-15 | Error boundary renders on a thrown error | Friendly message, navigation preserved, no stack trace |
| UI-16 | 404 page for an unknown session id | Link back to schedule |
| UI-17 | Mobile viewport 375px — full student booking journey | Completable; no horizontal scroll; targets ≥44px |
| UI-18 | Keyboard-only booking and cancellation | Reachable, operable, visible focus, dialog focus trapped |

### 6.2 Component tests — React Testing Library

| ID | Component | Test |
|---|---|---|
| UI-19 | `AvailabilityBadge` | Correct text and variant for full / low / open |
| UI-20 | `BookingPanel` | Renders exactly one action for each viewer state |
| UI-21 | `CancelBookingDialog` | Message matches the `refundEligible` prop |
| UI-22 | `CreditBalanceCard` | Expiry warning appears only within 30 days |
| UI-23 | `WaitlistPositionBadge` | Ordinal rendering correct |
| UI-24 | `LocalTime` | UTC input renders in studio timezone |

### 6.3 Manual tests

Documented in `tests/manual/checklist.md`, executed against the Vercel preview before submission, with results and screenshots recorded — as the assignment permits for cases where manual testing is appropriate.

| ID | Test | Why manual |
|---|---|---|
| UI-M01 | Promotion email renders correctly in Gmail and Outlook | Client rendering cannot be asserted in CI |
| UI-M02 | Email links resolve to the correct deployed URL | Depends on production environment variables |
| UI-M03 | Real iOS Safari — full booking journey | Mobile Safari behaviours differ from emulation |
| UI-M04 | Real Android Chrome — full booking journey | Same |
| UI-M05 | VoiceOver announces booking result | Screen-reader output needs human judgement |
| UI-M06 | Hebrew text renders correctly, no RTL breakage | Visual judgement |
| UI-M07 | Studio setup from empty account under 30 minutes | Success criterion 1 — timed by a person |
| UI-M08 | Registration to confirmed booking under 2 minutes on a phone | Success criterion 2 — timed by a person |
| UI-M09 | Colour contrast meets WCAG AA | Tooling plus visual check |
| UI-M10 | Production deployment smoke test | Real Vercel + Supabase, real cron execution |
| UI-M11 | Cron jobs fire on the deployed schedule | Requires waiting on wall-clock time |
| UI-M12 | Instructor temporary-password handover | Involves out-of-band communication |

---

## 7. Traceability

### 7.1 Business rules to tests

| Rule | Tests |
|---|---|
| BR-1 / BR-2 cancellation window | CF-22, CF-23, BF-03, DB-25, DB-26, DB-27, UI-05 |
| BR-3 promotion cutoff | BF-04, DB-28, DB-29 |
| BR-4 credit required | CF-20, IV-32, IV-33, BF-01 |
| BR-5 capacity | **DB-01 – DB-05, DB-07**, DB-15 |
| BR-6 no double booking or dual state | IV-30, IV-31, DB-10, DB-17 |
| BR-7 FIFO with skip | BF-05, DB-19, DB-37 |
| BR-8 no booking after start | IV-24, DB-30, DB-31 |
| BR-9 studio cancellation refunds all | BF-06 |
| BR-10 no-show forfeits credit | CF-35 |
| BR-11 attendance window | IV-27, IV-28, DB-32 |
| BR-12 unmarked default | BF-07, DB-43 |
| BR-13 grant expiry | BF-08, DB-33, DB-44 |
| BR-14 UTC storage | DB-38 – DB-42 |

### 7.2 Invariants to tests

| Invariant | Primary tests |
|---|---|
| INV-1 Capacity never exceeded | **DB-01, DB-02–05, DB-07** |
| INV-2 Grant remainder equals ledger sum | DB-16 (property), DB-55 |
| INV-3 Never both booked and waiting | DB-17, IV-30, IV-31 |
| INV-4 Ledger never mutated | DB-18, PR-14, PR-40, PR-41 |
| INV-5 Promotion order FIFO | DB-19, BF-05 |
| INV-6 No cross-studio access | PR-44 – PR-54, DB-20 |
| INV-7 No room or instructor overlap | DB-13, DB-21, BF-09 |

### 7.3 Success criteria to tests

| Criterion | Tests |
|---|---|
| 1. Studio setup under 30 minutes | UI-M07 |
| 2. Register to booking under 2 minutes on mobile | UI-M08, UI-17 |
| 3. No overbooking under concurrent load | **DB-01 – DB-05, DB-07** |
| 4. Refund exactly correct on each side of the window | DB-25 – DB-27 |
| 5. Promotion without admin action | BF-02 |
| 6. Ledger balances | DB-16, DB-55 |
| 7. No cross-studio or cross-student access | PR-09 – PR-54 |

---

## 8. Execution and Exit Criteria

### 8.1 Suite composition

| Layer | Approx. count | Runtime | Runs on |
|---|---|---|---|
| Unit | 31 | < 5s | Every save, every commit |
| Integration | 53 | ~90s | Every commit |
| E2E | 18 | ~3min | Pre-push, pre-deploy |
| Manual | 12 | ~45min | Before submission |

### 8.2 Coverage targets

| Area | Target | Rationale |
|---|---|---|
| `lib/domain/` | ≥ 95% | Pure logic, no excuse for gaps |
| Postgres functions | **100% of branches** | Every guard in §5.2/§5.3 of the design has a test |
| `actions/` | ≥ 80% | The trust boundary |
| Components | ≥ 60% | Presentational code has diminishing returns |
| Overall | ≥ 75% | Reported, not optimised for |

### 8.3 Definition of done

The suite is complete when all of the following hold:

1. All seven invariants have at least one passing test, and INV-1 is covered at all three levels: deterministic lock proof, concurrent RPC load, and end-to-end.
2. Every business rule BR-1 to BR-14 appears in §7.1 with a passing test.
3. Every RLS policy has at least one positive and one **negative** test — proving both that authorised access works and that unauthorised access returns zero rows.
4. DB-01 fails, and fails for the correct reason, if the `FOR UPDATE` clause is removed from `book_session` — verified once manually during implementation.
5. The manual checklist is executed against the deployed preview with results recorded.
6. The suite passes on a clean database from `supabase db reset` with no leftover state and no ordering dependency between tests.

### 8.4 What we accept as untested

Recorded honestly, as the assignment's emphasis on quality of thinking invites:

| Not tested | Reason |
|---|---|
| Supabase Auth internals | Third-party responsibility |
| Resend delivery infrastructure | Third-party; our contract ends at the API call, which is tested via DB-46 |
| Vercel cron trigger reliability | Platform; verified once manually as UI-M11 |
| Load beyond ~30 concurrent requests | Out of scope at the specified studio size; discussed in the Scaling document |
| Negative control against a deliberately unsafe booking function | Withdrawn from scope. The lock mechanism is instead evidenced by DB-01, whose blocking assertion fails if the lock is removed. |
| Visual regression | No baseline tooling in v1 |
| Browsers beyond Chromium and WebKit | Target audience is overwhelmingly mobile Safari and Chrome |

---

*End of document — awaiting review before proceeding to the Basic Scaling document.*
