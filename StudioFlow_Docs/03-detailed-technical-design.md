# Detailed Technical Design Document
## StudioFlow — Class Booking & Waitlist Management

**Course:** Internet Technologies — Become a Full-Stack Engineer, RUNI CS 2026
**Document:** Deliverable 5 of 10 — Detailed Technical Design
**Version:** 1.0
**Status:** Draft for review
**Depends on:** Product Specification v1.0 (approved), Technical Architecture v1.0 (approved)

---

## 0. Purpose

The Architecture document established *what the system is made of and why*. This document establishes *exactly how it is built*, to the level of detail where implementation becomes transcription rather than design.

It is the artifact referred to in the assignment's instruction that you should know what you are building before you begin writing code.

### 0.1 One refinement to the approved architecture

The Architecture document stated that credit balances are derived by summing an append-only ledger, with no cached balance column. Detailed design of BR-13 (per-grant expiry) shows that this is insufficient on its own.

**The problem:** expiring a package requires knowing *how many credits from that specific package* remain unused. A flat signed ledger cannot answer this without reconstructing FIFO allocation across the student's entire history on every read.

**The refinement:** grants become first-class rows in a `credit_grants` table carrying `credits_remaining`, maintained transactionally. The `credit_ledger` remains append-only and remains the audit authority.

**The invariant that keeps both honest:** for any grant *G*, `credits_remaining` must equal the sum of all ledger deltas referencing *G*. `assert_ledger_consistency()` (migration 009) checks this against a live database and is run manually. The ledger is truth; the column is speed.

This is recorded rather than quietly changed, because the discrepancy between an approved architecture and its implementation is exactly the kind of thing that should be visible.

---

## 1. Project Folder Structure

```
studioflow/
├── app/
│   ├── layout.tsx                        # Root layout, fonts, Toaster
│   ├── page.tsx                          # Landing + week preview
│   ├── error.tsx                         # Route-segment error boundary
│   ├── global-error.tsx                  # Root error boundary
│   ├── not-found.tsx
│   │
│   ├── (auth)/
│   │   ├── layout.tsx                    # Centred card layout
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   │
│   ├── (public)/
│   │   ├── layout.tsx                    # Public nav
│   │   └── schedule/
│   │       ├── page.tsx                  # Full schedule
│   │       └── [sessionId]/page.tsx      # Session detail
│   │
│   ├── (student)/
│   │   ├── layout.tsx                    # Requires membership
│   │   └── my/
│   │       ├── bookings/page.tsx
│   │       ├── history/page.tsx
│   │       ├── credits/page.tsx
│   │       ├── notifications/page.tsx
│   │       └── profile/page.tsx
│   │
│   ├── (instructor)/
│   │   ├── layout.tsx                    # Requires instructor role
│   │   └── teach/
│   │       ├── page.tsx
│   │       └── [sessionId]/page.tsx      # Roster + attendance
│   │
│   ├── (admin)/
│   │   ├── layout.tsx                    # Requires admin role
│   │   └── admin/
│   │       ├── page.tsx                  # Dashboard
│   │       ├── schedule/
│   │       │   ├── page.tsx              # Week grid
│   │       │   └── new/page.tsx          # Create single / recurring
│   │       ├── sessions/[id]/page.tsx
│   │       ├── students/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx         # Detail + ledger + grant
│   │       ├── instructors/page.tsx
│   │       ├── class-types/page.tsx
│   │       ├── rooms/page.tsx
│   │       ├── settings/page.tsx
│   │       └── reports/page.tsx
│   │
│   ├── auth/callback/route.ts            # Session establishment
│   └── api/cron/
│       ├── dispatch-notifications/route.ts
│       ├── finalize-attendance/route.ts
│       └── expire-credits/route.ts
│
├── actions/                              # ALL mutations — the trust boundary
│   ├── auth.actions.ts
│   ├── booking.actions.ts
│   ├── waitlist.actions.ts
│   ├── attendance.actions.ts
│   ├── session.actions.ts
│   ├── catalog.actions.ts                # Rooms, class types
│   ├── member.actions.ts                 # Instructors, students
│   ├── credit.actions.ts
│   ├── studio.actions.ts                 # Settings
│   └── notification.actions.ts
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                     # Browser client
│   │   ├── server.ts                     # RSC / Action client (RLS on)
│   │   ├── service.ts                    # Service role — cron only
│   │   └── middleware.ts                 # Session refresh helper
│   ├── domain/                           # PURE functions, no I/O
│   │   ├── policy.ts                     # Window & cutoff calculations
│   │   ├── waitlist.ts                   # Position, eligibility
│   │   ├── credits.ts                    # Balance, expiry projections
│   │   └── schedule.ts                   # Recurrence expansion, conflicts
│   ├── data/                             # READ queries (no writes)
│   │   ├── sessions.queries.ts
│   │   ├── bookings.queries.ts
│   │   ├── credits.queries.ts
│   │   ├── members.queries.ts
│   │   └── reports.queries.ts
│   ├── validation/                       # Zod schemas — shared client+server
│   │   ├── booking.schema.ts
│   │   ├── session.schema.ts
│   │   ├── credit.schema.ts
│   │   ├── member.schema.ts
│   │   └── common.schema.ts
│   ├── auth/
│   │   ├── require.ts                    # requireUser / requireRole
│   │   └── context.ts                    # Cached membership lookup
│   ├── errors/
│   │   ├── codes.ts                      # ErrorCode enum
│   │   ├── messages.ts                   # Code → user-facing text
│   │   └── map.ts                        # Postgres error → ErrorCode
│   ├── time/
│   │   └── tz.ts                         # UTC ↔ studio timezone
│   └── types/
│       ├── database.types.ts             # GENERATED from Supabase
│       └── actions.types.ts              # ActionResult<T>
│
├── components/
│   ├── ui/                               # shadcn primitives
│   ├── schedule/
│   ├── booking/
│   ├── credits/
│   ├── attendance/
│   ├── admin/
│   └── shared/
│
├── supabase/
│   ├── migrations/                       # Ordered, committed to git
│   ├── functions/                        # SQL function sources
│   └── seed.sql                          # Demo data
│
├── tests/
│   ├── unit/                             # Vitest — lib/domain
│   ├── integration/                      # Vitest — actions + DB
│   ├── e2e/                              # Playwright
│   └── fixtures/
│
├── middleware.ts
├── vercel.json                           # Cron definitions
└── [config files]
```

### 1.1 Structural rules

| Rule | Reason |
|---|---|
| **Nothing outside `actions/` performs a write** | Makes the security review a review of one directory |
| **`lib/domain/` has zero imports from `lib/supabase/`** | Pure functions are trivially unit-testable with no database |
| **`lib/data/` contains reads only** | Prevents mutation logic leaking into query helpers |
| **`lib/supabase/service.ts` is imported only by `app/api/cron/**`** | Enforced by an ESLint import restriction; the service key bypasses RLS |
| **Zod schemas live in `lib/validation/`, imported by both form and action** | One definition, validated twice, cannot drift |
| **Migrations are numbered files in git** | Schema history is reviewable and reproducible |

---

## 2. Core Components Structure

### 2.1 The Server/Client boundary rule

The default is Server. `"use client"` is added only when a component needs one of: event handlers, hooks, browser APIs, or state.

**The boundary is pushed as low as possible.** A page is a Server Component that fetches data and renders Server Components; only the interactive leaf becomes a Client Component. A session card is server-rendered; the button inside it is the client island.

The anti-pattern to avoid: marking a page `"use client"` because one button needs interactivity, which drags the entire subtree into the browser bundle and forces client-side data fetching.

### 2.2 Component inventory

**Schedule**

| Component | Type | Responsibility |
|---|---|---|
| `ScheduleWeekView` | Server | Fetches sessions for a week, renders day columns |
| `SessionCard` | Server | Renders class type, instructor, time, availability |
| `AvailabilityBadge` | Server | "6 spots left" / "Full · 3 waiting" |
| `WeekNavigator` | Client | Week navigation via URL search params |
| `ScheduleFilters` | Client | Class type / instructor filter → URL params |

**Booking**

| Component | Type | Responsibility |
|---|---|---|
| `BookingPanel` | Server | Resolves viewer state → picks correct action component |
| `BookButton` | Client | Calls `bookSession`, optimistic pending state |
| `WaitlistButton` | Client | Calls `joinWaitlist` |
| `CancelBookingDialog` | Client | **Shows refund consequence before confirming** (Flow 5 step 3) |
| `WaitlistPositionBadge` | Server | Derived position display |
| `InsufficientCreditsNotice` | Server | Balance zero → repurchase prompt (G4) |

`BookingPanel` is a small but important piece of design: it resolves whether the viewer is anonymous, already booked, waitlisted, out of credits, or eligible — on the server — and renders exactly one action component. The client components stay dumb and single-purpose instead of each re-deriving viewer state.

**Credits**

| Component | Type | Responsibility |
|---|---|---|
| `CreditBalanceCard` | Server | Balance, next expiry warning |
| `CreditLedgerTable` | Server | Paginated movement history |
| `GrantCreditsForm` | Client | Admin grant form (react-hook-form + Zod) |

**Attendance**

| Component | Type | Responsibility |
|---|---|---|
| `RosterList` | Server | Confirmed bookings for a session |
| `AttendanceToggle` | Client | Per-student mark; **saves individually** (Flow 7 step 3) |
| `AttendanceSummary` | Server | Counts of marked / unmarked |

**Admin**

| Component | Type | Responsibility |
|---|---|---|
| `SessionForm` | Client | Create/edit, with recurrence toggle |
| `RecurrencePreview` | Client | Shows the dates that will be generated before submit |
| `StudentTable` | Server | Paginated, URL-driven search |
| `ReportChart` | Client | Recharts visualisations |
| `PolicySettingsForm` | Client | Cancellation window, cutoff, timezone |

**Shared**

| Component | Type | Responsibility |
|---|---|---|
| `RoleNav` | Server | Navigation derived from membership role |
| `NotificationBell` | Server | Unread count |
| `SubmitButton` | Client | `useFormStatus` pending state |
| `EmptyState`, `ErrorState` | Server | Consistent empty/error presentation |
| `LocalTime` | Server | Renders UTC in studio timezone |

### 2.3 Data-passing rule

Server Components pass **plain serialisable props** to Client Components. Never a Supabase client, never a function, never a Date object where a string will do. Anything crossing the boundary must survive serialisation.

---

## 3. Database Schema

### 3.1 Enumerated types

| Enum | Values |
|---|---|
| `member_role` | `student`, `instructor`, `admin` |
| `session_status` | `scheduled`, `cancelled` |
| `booking_status` | `confirmed`, `cancelled` |
| `attendance_status` | `attended`, `absent` |
| `booking_source` | `self`, `admin`, `waitlist_promotion` |
| `waitlist_status` | `waiting`, `promoted`, `left` |
| `ledger_entry_type` | `grant`, `booking`, `refund`, `expiry`, `adjustment` |
| `grant_status` | `active`, `exhausted`, `expired` |
| `notification_type` | `waitlist_promoted`, `session_cancelled`, `session_updated`, `credits_granted`, `credits_expiring`, `booking_confirmed` |
| `email_status` | `pending`, `sent`, `failed`, `skipped` |

### 3.2 `profiles`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `full_name` | `text` | NOT NULL, length 2–100 |
| `email` | `text` | NOT NULL |
| `phone` | `text` | NULL |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |
| `updated_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

Populated by a trigger on `auth.users` insert, so a profile always exists for an authenticated user.

### 3.3 `studios`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK DEFAULT `gen_random_uuid()` |
| `name` | `text` | NOT NULL |
| `slug` | `text` | NOT NULL UNIQUE |
| `timezone` | `text` | NOT NULL DEFAULT `'Asia/Jerusalem'` |
| `cancellation_window_hours` | `int` | NOT NULL DEFAULT 12, CHECK 0–168 |
| `promotion_cutoff_hours` | `int` | NOT NULL DEFAULT 2, CHECK 0–48 |
| `unmarked_attendance_default` | `attendance_status` | NOT NULL DEFAULT `'attended'` |
| `attendance_window_hours` | `int` | NOT NULL DEFAULT 24, CHECK 1–168 |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

Every business-rule parameter from the specification is a column here. No policy constant is hard-coded in application code.

### 3.4 `studio_members`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` | `uuid` | FK → `studios`, NOT NULL |
| `user_id` | `uuid` | FK → `profiles`, NOT NULL |
| `role` | `member_role` | NOT NULL DEFAULT `'student'` |
| `is_active` | `boolean` | NOT NULL DEFAULT `true` |
| `must_change_password` | `boolean` | NOT NULL DEFAULT `false` |
| `joined_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

**Unique:** `(studio_id, user_id)`
**Index:** `(user_id)` — read on nearly every request

`must_change_password` supports the approved instructor onboarding decision: admin creates the account with a temporary password, and the instructor is forced through a password change on first login.

### 3.5 `rooms`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` | `uuid` | FK, NOT NULL |
| `name` | `text` | NOT NULL |
| `capacity` | `int` | NOT NULL, CHECK 1–200 |
| `is_active` | `boolean` | NOT NULL DEFAULT `true` |

**Unique:** `(studio_id, name)`

### 3.6 `class_types`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` | `uuid` | FK, NOT NULL |
| `name` | `text` | NOT NULL |
| `description` | `text` | NULL |
| `duration_minutes` | `int` | NOT NULL, CHECK 15–240 |
| `color` | `text` | NOT NULL DEFAULT `'#6366f1'` |
| `is_active` | `boolean` | NOT NULL DEFAULT `true` |

**Unique:** `(studio_id, name)`

### 3.7 `sessions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` | `uuid` | FK, NOT NULL |
| `class_type_id` | `uuid` | FK, NOT NULL |
| `room_id` | `uuid` | FK, NOT NULL |
| `instructor_id` | `uuid` | FK → `profiles`, NOT NULL |
| `starts_at` | `timestamptz` | NOT NULL — **always UTC** |
| `ends_at` | `timestamptz` | NOT NULL, CHECK `ends_at > starts_at` |
| `capacity` | `int` | NOT NULL, CHECK 1–200 |
| `status` | `session_status` | NOT NULL DEFAULT `'scheduled'` |
| `cancellation_reason` | `text` | NULL |
| `cancelled_at` / `cancelled_by` | `timestamptz` / `uuid` | NULL |
| `recurrence_group_id` | `uuid` | NULL — links sessions generated together |
| `created_at` / `created_by` | `timestamptz` / `uuid` | NOT NULL / NOT NULL |

**Indexes**
- `(studio_id, starts_at)` — the primary schedule query
- `(instructor_id, starts_at) WHERE status = 'scheduled'` — instructor view
- `(recurrence_group_id) WHERE recurrence_group_id IS NOT NULL`

**Exclusion constraints** (require the `btree_gist` extension)
- Room: no two `scheduled` sessions in the same room with overlapping time ranges
- Instructor: no two `scheduled` sessions for the same instructor with overlapping time ranges

These implement Flow 2 step 4 as a **database guarantee** rather than an application check. A double-booked room becomes structurally impossible, including for a concurrent pair of admins and for the recurrence generator inserting twelve rows at once.

`capacity` is copied from the room at creation, not read through it, so changing a room's capacity later cannot resize sessions that already hold bookings.

### 3.8 `bookings`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `session_id` | `uuid` | FK, NOT NULL |
| `student_id` | `uuid` | FK → `profiles`, NOT NULL |
| `studio_id` | `uuid` | FK, NOT NULL — denormalised for RLS |
| `status` | `booking_status` | NOT NULL DEFAULT `'confirmed'` |
| `attendance` | `attendance_status` | NULL |
| `source` | `booking_source` | NOT NULL DEFAULT `'self'` |
| `booked_at` | `timestamptz` | NOT NULL DEFAULT `now()` |
| `cancelled_at` / `cancelled_by` | `timestamptz` / `uuid` | NULL |
| `credit_refunded` | `boolean` | NOT NULL DEFAULT `false` |
| `attendance_marked_at` / `_by` | `timestamptz` / `uuid` | NULL |
| `attendance_auto_resolved` | `boolean` | NOT NULL DEFAULT `false` |

**Unique (partial):** `(session_id, student_id) WHERE status = 'confirmed'` — enforces BR-6 structurally

**Indexes**
- `(session_id) WHERE status = 'confirmed'` — the capacity count
- `(student_id, booked_at DESC)` — student history
- `(session_id) WHERE status = 'confirmed' AND attendance IS NULL` — attendance finalisation job

`studio_id` is denormalised so RLS policies filter without joining to `sessions` on every row check. This is a deliberate, documented denormalisation with a measurable justification.

`attendance_auto_resolved` distinguishes an instructor's explicit mark from BR-12's default, which keeps the no-show report honest.

### 3.9 `waitlist_entries`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `session_id` / `student_id` / `studio_id` | `uuid` | FK, NOT NULL |
| `status` | `waitlist_status` | NOT NULL DEFAULT `'waiting'` |
| `joined_at` | `timestamptz` | NOT NULL DEFAULT `now()` |
| `promoted_at` | `timestamptz` | NULL |
| `promoted_booking_id` | `uuid` | FK → `bookings`, NULL |
| `left_at` | `timestamptz` | NULL |

**Unique (partial):** `(session_id, student_id) WHERE status = 'waiting'`
**Index:** `(session_id, joined_at) WHERE status = 'waiting'` — the FIFO selection query

Position is never stored; it is `ROW_NUMBER()` over `joined_at`.

### 3.10 `credit_grants`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` / `student_id` | `uuid` | FK, NOT NULL |
| `credits_total` | `int` | NOT NULL, CHECK 1–500 |
| `credits_remaining` | `int` | NOT NULL, CHECK `0 <= credits_remaining <= credits_total` |
| `expires_at` | `timestamptz` | NULL |
| `status` | `grant_status` | NOT NULL DEFAULT `'active'` |
| `note` | `text` | NULL — payment reference |
| `created_by` | `uuid` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

**Index:** `(student_id, status, expires_at)` — FIFO consumption and balance

The CHECK constraint makes over-consumption impossible at the storage layer, independent of function logic.

### 3.11 `credit_ledger`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` / `student_id` | `uuid` | FK, NOT NULL |
| `grant_id` | `uuid` | FK → `credit_grants`, NULL |
| `delta` | `int` | NOT NULL, CHECK `delta <> 0` |
| `entry_type` | `ledger_entry_type` | NOT NULL |
| `booking_id` / `session_id` | `uuid` | NULL |
| `note` | `text` | NULL |
| `created_by` | `uuid` | NULL — NULL means system |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

**Index:** `(student_id, created_at DESC)`

**Append-only.** No UPDATE or DELETE policy exists for any role. A correction is a new `adjustment` entry, never an edit.

### 3.12 `notifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `studio_id` / `recipient_id` | `uuid` | FK, NOT NULL |
| `type` | `notification_type` | NOT NULL |
| `title` / `body` | `text` | NOT NULL |
| `payload` | `jsonb` | NOT NULL DEFAULT `'{}'` |
| `related_session_id` | `uuid` | NULL |
| `read_at` | `timestamptz` | NULL |
| `email_status` | `email_status` | NOT NULL DEFAULT `'pending'` |
| `email_attempts` | `int` | NOT NULL DEFAULT 0 |
| `email_sent_at` | `timestamptz` | NULL |
| `last_error` | `text` | NULL |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

**Indexes**
- `(recipient_id, created_at DESC)` — the notification centre
- `(email_status, created_at) WHERE email_status = 'pending'` — the dispatch job

**Open question resolved:** notification retry policy is 3 attempts; on the third failure `email_status` becomes `failed` and the row is abandoned. The in-app notification remains visible regardless (assumption A4).

### 3.13 Core CRUD operations by entity

| Entity | CREATE | READ | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Trigger on signup | Own; roster names (instructor); all in studio (admin) | Own name/phone | Never — deactivate membership instead |
| `studios` | Seed / onboarding | All members | Admin: policy settings | Never |
| `studio_members` | Register (student); admin invite (instructor) | Own; all (admin) | Admin: role, `is_active` | Never — soft-delete via `is_active` |
| `rooms` | Admin | All members | Admin | Soft — `is_active = false` |
| `class_types` | Admin | All members | Admin | Soft — `is_active = false` |
| `sessions` | Admin (single or recurring) | Public read of scheduled | Admin: all fields; instructor: cancel own | Never — `status = 'cancelled'` |
| `bookings` | `book_session()` / admin | Own (student); roster (instructor); all (admin) | Attendance; cancellation | Never — `status = 'cancelled'` |
| `waitlist_entries` | `join_waitlist()` | Own; session queue (instructor/admin) | Status transitions only | Never — `status = 'left'` |
| `credit_grants` | Admin via `grant_credits()` | Own (student); all (admin) | `credits_remaining` by functions only | Never |
| `credit_ledger` | Functions only | Own (student); all (admin) | **Never** | **Never** |
| `notifications` | Functions | Own | Own: `read_at`; job: email fields | Never |

**Nothing in this system is hard-deleted.** Every entity uses soft deletion or a terminal status. The reason is auditability: a studio owner investigating "why was I charged for a class I cancelled" needs the cancelled booking to still exist. Hard deletion also breaks the foreign keys the ledger depends on.

### 3.14 Postgres functions

All are `SECURITY DEFINER` with an explicit internal permission check, and all return a JSON result rather than raising, so error codes map cleanly to UI messages.

| Function | Parameters | Returns | Job |
|---|---|---|---|
| `book_session` | `p_session_id` | `{ ok, error_code, booking_id }` | The atomic booking transaction (§5.2) |
| `join_waitlist` | `p_session_id` | `{ ok, error_code, entry_id, position }` | Queue for a full session |
| `leave_waitlist` | `p_entry_id` | `{ ok, error_code }` | Withdraw |
| `cancel_booking` | `p_booking_id` | `{ ok, error_code, refunded, promoted_student_id }` | Cancel + refund + promote (§5.3) |
| `promote_from_waitlist` | `p_session_id` | `{ promoted_booking_id }` | Internal; called within `cancel_booking` |
| `cancel_session` | `p_session_id, p_reason` | `{ ok, refunded_count, notified_count }` | Studio-side cancellation (Flow 8) |
| `grant_credits` | `p_student_id, p_credits, p_expires_at, p_note` | `{ ok, grant_id, new_balance }` | Admin package grant |
| `mark_attendance` | `p_booking_id, p_attendance` | `{ ok, error_code }` | Instructor marking |
| `create_recurring_sessions` | `p_template, p_weeks` | `{ created_ids[], conflicts[] }` | Weekly generation |
| `student_balance` | `p_student_id` | `int` | Sum of active grant remainders |
| `current_membership` | — | `{ studio_id, role }` | Cached membership for RLS helpers |
| `is_studio_admin` | `p_studio_id` | `boolean` | RLS helper |
| `teaches_session` | `p_session_id` | `boolean` | RLS helper |

---

## 4. Server Actions

### 4.1 Shared result type

Every action returns the same discriminated union:

```
ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; code: ErrorCode; message: string;
      fieldErrors?: Record<string, string[]> }
```

Actions **never throw** for expected failures. A full class, an insufficient balance, and a closed attendance window are all normal outcomes that a user must be told about clearly. Exceptions are reserved for genuine defects, which reach `error.tsx`.

### 4.2 Mandatory action skeleton

Every action executes these five stages in this order:

| # | Stage | Mechanism | Failure code |
|---|---|---|---|
| 1 | Authenticate | `requireUser()` | `NOT_AUTHENTICATED` |
| 2 | Validate | Zod `safeParse` | `VALIDATION_FAILED` + `fieldErrors` |
| 3 | Authorize | `requireRole()` / ownership | `FORBIDDEN` |
| 4 | Execute | `rpc()` or scoped write | Domain-specific |
| 5 | Revalidate | `revalidatePath()` | — |

### 4.3 Booking and waitlist actions

| Action | Signature | Role | Revalidates |
|---|---|---|---|
| `bookSession` | `(sessionId: string) → ActionResult<{ bookingId, newBalance }>` | Student | `/schedule`, `/my/bookings`, `/my/credits` |
| `cancelBooking` | `(bookingId: string) → ActionResult<{ refunded: boolean }>` | Booking owner | `/schedule`, `/my/bookings`, `/my/credits` |
| `joinWaitlist` | `(sessionId: string) → ActionResult<{ position: number }>` | Student | `/schedule`, `/my/bookings` |
| `leaveWaitlist` | `(entryId: string) → ActionResult<void>` | Entry owner | `/schedule`, `/my/bookings` |

### 4.4 Attendance actions

| Action | Signature | Role |
|---|---|---|
| `markAttendance` | `(bookingId, status: 'attended' \| 'absent') → ActionResult<void>` | Session instructor or admin |
| `markAllPresent` | `(sessionId) → ActionResult<{ marked: number }>` | Session instructor or admin |

`markAttendance` saves one student at a time. Roster-level batch saving would mean a lost connection discards the instructor's whole pass through the room.

### 4.5 Session management actions

| Action | Signature | Role |
|---|---|---|
| `createSession` | `(input: SessionInput) → ActionResult<{ sessionId }>` | Admin |
| `createRecurringSessions` | `(input: SessionInput, weeks: number) → ActionResult<{ created, conflicts }>` | Admin |
| `updateSession` | `(sessionId, input: Partial<SessionInput>) → ActionResult<void>` | Admin |
| `cancelSession` | `(sessionId, reason: string) → ActionResult<{ refunded, notified }>` | Admin or session instructor |
| `adminBookStudent` | `(sessionId, studentId) → ActionResult<{ bookingId }>` | Admin |
| `adminRemoveBooking` | `(bookingId, refund: boolean) → ActionResult<void>` | Admin |

`createRecurringSessions` returns conflicts rather than failing wholesale. If week 5 collides with an existing booking-holding session, weeks 1–4 and 6–12 are still created and the admin is shown precisely which date failed and why. **Open question resolved:** the maximum is 12 weeks per operation, bounding transaction size.

`adminRemoveBooking` takes an explicit `refund` flag because the admin is making a judgement the system cannot make — a student who called in sick versus one who simply did not appear.

### 4.6 Member, credit, and studio actions

| Action | Signature | Role |
|---|---|---|
| `registerStudent` | `(input: RegisterInput) → ActionResult<void>` | Public |
| `createInstructor` | `(input: InstructorInput) → ActionResult<{ tempPassword }>` | Admin |
| `changePassword` | `(input: PasswordInput) → ActionResult<void>` | Self |
| `setMemberActive` | `(memberId, active: boolean) → ActionResult<void>` | Admin |
| `grantCredits` | `(input: GrantInput) → ActionResult<{ newBalance }>` | Admin |
| `adjustCredits` | `(studentId, delta, reason) → ActionResult<{ newBalance }>` | Admin |
| `updateStudioSettings` | `(input: StudioSettingsInput) → ActionResult<void>` | Admin |
| `markNotificationRead` | `(notificationId) → ActionResult<void>` | Recipient |

`createInstructor` returns the temporary password **once**, for the admin to hand over directly. It is never stored in plain text and never emailed, and `must_change_password` forces rotation at first login. This implements the approved onboarding decision without any dependency on email deliverability during the demo.

`adjustCredits` requires a non-empty reason, recorded in the ledger note. Any manual movement of value must carry an explanation.

### 4.7 Cron Route Handlers

| Route | Schedule (UTC) | Job | Auth |
|---|---|---|---|
| `/api/cron/finalize-attendance` | `0 2 * * *` | Apply BR-12 to bookings past the attendance window | `CRON_SECRET` header |
| `/api/cron/expire-credits` | `0 3 * * *` | Expire lapsed grants, write compensating ledger entries | `CRON_SECRET` header |
| `/api/cron/dispatch-notifications` | `0 4 * * *` | Send up to 50 pending emails, increment attempts, mark sent/failed | `CRON_SECRET` header |

All three use the service-role client and are idempotent: each selects only rows in a not-yet-processed state and moves them forward, so a duplicate invocation is harmless.

**On the daily frequency.** These are the schedules deployed, and they are daily because the Vercel Hobby tier permits at most one cron run per day — rejecting a more frequent expression at deploy time rather than throttling it. Architecture §1.5 identified this risk before deployment and it duly materialised; the resolution and its consequences are recorded there. Idempotency is what makes the constraint tolerable: no job is sensitive to *when* it runs, only to *whether* it eventually runs. Restoring the originally specified frequencies — `*/5 * * * *` for dispatch and `0 * * * *` for finalisation — requires only an edited `crons` array in `studio-flow/vercel.json` on a Pro account, with no change to any route handler or job function.

Schedules are staggered rather than coincident so the three invocations do not contend for the same connection pool, and are interpreted in **UTC**: `0 3 * * *` fires at 05:00 or 06:00 in the studio's `Asia/Jerusalem` timezone depending on daylight saving.

Authorisation is a constant-time comparison of the `Authorization: Bearer` header against `CRON_SECRET`, implemented once in `lib/cron/authorize.ts` and called as the first statement of every handler. It **fails closed**: an unset or placeholder secret returns 503 and runs no job, so a forgotten environment variable cannot leave an endpoint open that mutates every record in the studio.

---

## 5. Core Business Logic

### 5.1 Where each rule lives

The system has two audiences for every policy rule: the **user**, who must be told the consequence before acting, and the **database**, which must enforce it. This creates a duplication risk.

The resolution:

| Layer | Contains | Authority |
|---|---|---|
| `lib/domain/*.ts` | Pure functions computing the same rules | **Display only** |
| Postgres functions | The same rules, transactionally | **Authoritative** |
| `tests/unit/policy-contract.test.ts` | A shared table of cases run against both | Proves agreement |

The pure TypeScript functions exist so `CancelBookingDialog` can say "you will lose this credit" *before* the user confirms. They never decide anything. The database decides. `tests/unit/policy.test.ts` covers the TypeScript side against a fixture table. Agreement with the Postgres implementation is maintained by keeping the two in step by hand; nothing asserts it automatically.

### 5.2 Booking logic — `book_session`

```
BEGIN
  1. Resolve caller → student_id (auth.uid())
  2. SELECT session FOR UPDATE          ← serialises concurrent callers
  3. Guard: session exists              → SESSION_NOT_FOUND
  4. Guard: status = 'scheduled'        → SESSION_CANCELLED
  5. Guard: starts_at > now()           → SESSION_STARTED          (BR-8)
  6. Guard: caller is active member     → FORBIDDEN
  7. COUNT confirmed bookings
     Guard: count < capacity            → SESSION_FULL             (BR-5)
  8. Guard: no confirmed booking        → ALREADY_BOOKED           (BR-6)
     Guard: no waiting entry            → ALREADY_WAITLISTED       (BR-6)
  9. SELECT earliest-expiring active grant with remaining > 0
     Guard: found                       → INSUFFICIENT_CREDITS     (BR-4)
 10. UPDATE grant: remaining -= 1; status → 'exhausted' if now 0
 11. INSERT booking (confirmed, source='self')
 12. INSERT ledger (delta -1, type 'booking', grant_id, booking_id)
COMMIT
```

Step 2 is the entire correctness argument. The row lock means a second caller for the final seat blocks until the first commits, then observes the new count at step 7 and correctly receives `SESSION_FULL`. The partial unique index from §3.8 is a second, independent guarantee behind step 8.

### 5.3 Cancellation logic — `cancel_booking`

```
BEGIN
  1. SELECT booking JOIN session FOR UPDATE (session row)
  2. Guard: booking exists, status = 'confirmed'  → ALREADY_CANCELLED
  3. Guard: caller owns booking OR is admin       → FORBIDDEN
  4. Read studio.cancellation_window_hours
     refund_eligible := starts_at - now() >= window                (BR-1/BR-2)
  5. UPDATE booking: status='cancelled', cancelled_at, credit_refunded
  6. IF refund_eligible:
       UPDATE grant: remaining += 1; status → 'active'
       INSERT ledger (+1, type 'refund')
  7. Read studio.promotion_cutoff_hours
     IF starts_at - now() < cutoff → COMMIT, no promotion          (BR-3)
  8. LOOP over waiting entries ORDER BY joined_at ASC:             (BR-7)
       IF candidate has an available grant:
          UPDATE entry: status='promoted'
          UPDATE grant: remaining -= 1
          INSERT booking (confirmed, source='waitlist_promotion')
          INSERT ledger (-1, type 'booking')
          INSERT notification (type='waitlist_promoted', email pending)
          EXIT LOOP
       ELSE continue to next candidate                             (skip)
COMMIT
-- email sent later by cron, never inside this transaction
```

Two details worth defending in the presentation:

**Step 6 refunds to the original grant**, not as a floating credit. Refunding to the grant preserves that package's expiry date. A generic credit would silently extend the value of an expired package.

**Step 8 skips rather than stalls.** A waitlisted student who has run out of credits does not block the queue; the next eligible person is promoted. The alternative leaves a seat empty because the person at the front cannot pay for it, defeating G1.

### 5.4 Recurrence expansion — `create_recurring_sessions`

Pure date arithmetic lives in `lib/domain/schedule.ts` and is unit-tested independently of the database.

The critical detail is **daylight saving**. A class scheduled for 07:00 local time must remain at 07:00 local after a DST transition, which means the UTC instant shifts by an hour. Expansion therefore iterates in the studio's local timezone and converts each occurrence to UTC individually. Adding seven days to a UTC timestamp twelve times is the naive approach and produces a class at 06:00 for half the term.

Each generated occurrence is inserted independently. The exclusion constraints from §3.7 reject any that conflicts; the rejected date is collected and reported rather than aborting the batch.

### 5.5 Attendance finalisation — BR-12

Daily, the job selects confirmed bookings whose session ended more than `attendance_window_hours` ago and whose `attendance` is still null, then sets `attendance` to the studio's `unmarked_attendance_default` with `attendance_auto_resolved = true`.

No credit movement occurs. A no-show already forfeited its credit at booking time (BR-10) and an attended class likewise; attendance is a record, not a transaction.

### 5.6 Credit expiry — BR-13

Nightly, the job selects grants where `expires_at <= now()` and `status = 'active'`, and for each with `credits_remaining > 0` inserts a ledger entry of `-credits_remaining` typed `expiry`, then sets `credits_remaining = 0` and `status = 'expired'`.

This keeps the balance a simple sum over active grants while leaving the student a visible, dated ledger line explaining exactly where their credits went.

---

## 6. State Management

### 6.1 State taxonomy

| Kind | Example | Held by | Why |
|---|---|---|---|
| **Server data** | Schedule, bookings, balance | RSC + `revalidatePath` | The server is the source; caching it clientside creates a second truth |
| **URL state** | Selected week, filters, page | `searchParams` | Shareable, bookmarkable, survives refresh, needs no state library |
| **Form state** | Field values, field errors | `react-hook-form` | Uncontrolled inputs avoid re-render per keystroke |
| **Action state** | Pending, result, error | `useActionState`, `useFormStatus` | Built into the Server Action lifecycle |
| **Optimistic state** | "Booking…" before confirm | `useOptimistic` | Immediate feedback, automatic rollback on failure |
| **Ephemeral UI** | Dialog open, accordion | `useState` | Local, disposable |
| **Transient feedback** | Toasts | `sonner` | Fire-and-forget |

### 6.2 No global client store

There is deliberately no Redux, Zustand, Jotai, or TanStack Query.

The reasoning: a client store's purpose is caching server data and coordinating fetches. In this architecture the server holds the data and `revalidatePath` invalidates it. Introducing a store would create a parallel copy of state that must be manually synchronised after every mutation — which is the exact class of bug (stale balance after booking, seat count not updating after cancellation) that the store would ostensibly prevent.

**Concrete flow:** a student books. The action commits, then revalidates `/schedule`, `/my/bookings` and `/my/credits`. Next render of any of those routes reflects the new truth. No cache to invalidate, no store to update, no stale balance.

### 6.3 Optimistic updates and their limits

`BookButton` shows a pending state immediately. It does **not** optimistically show "Booked", because booking can legitimately fail — the seat may have been taken microseconds earlier, which is precisely the scenario §5.2 exists to handle. Optimistically claiming success and then retracting it is worse than a brief spinner.

`AttendanceToggle` *does* update optimistically, because marking attendance has no contended failure mode.

The rule: optimistic display is appropriate when failure is exceptional, and inappropriate when failure is an expected outcome of the domain.

---

## 7. Error Handling and Validation

### 7.1 The five validation layers

| # | Layer | Catches | Trusted? |
|---|---|---|---|
| 1 | HTML attributes | Empty fields, wrong type | No — UX only |
| 2 | Zod, client (`zodResolver`) | Format, ranges, cross-field | No — UX only |
| 3 | **Zod, server (Action stage 2)** | Everything from an untrusted network | **Yes** |
| 4 | Postgres CHECK / UNIQUE / EXCLUDE | Structural violations | **Yes** |
| 5 | RLS policies | Unauthorised access | **Yes** |

Layers 1 and 2 exist purely so users see errors immediately. **Every guarantee rests on 3, 4 and 5.** A request forged with `curl` and a valid session cookie skips 1 and 2 entirely, which is exactly why the same Zod schema is imported and re-run on the server.

### 7.2 Error code catalogue

| Code | Cause | User-facing message |
|---|---|---|
| `NOT_AUTHENTICATED` | No session | "Please sign in to continue." |
| `FORBIDDEN` | Role or ownership failure | "You don't have permission to do that." |
| `VALIDATION_FAILED` | Zod rejection | Field-level messages |
| `SESSION_NOT_FOUND` | Bad or deleted id | "This class is no longer available." |
| `SESSION_CANCELLED` | Session cancelled | "This class has been cancelled." |
| `SESSION_STARTED` | Past start time | "This class has already started." |
| `SESSION_FULL` | Capacity reached | "This class is full — join the waitlist?" |
| `ALREADY_BOOKED` | Duplicate booking | "You're already booked into this class." |
| `ALREADY_WAITLISTED` | Duplicate entry | "You're already on the waitlist." |
| `INSUFFICIENT_CREDITS` | No available grant | "You have no classes left. Contact the studio." |
| `BOOKING_NOT_FOUND` | Bad id | "Booking not found." |
| `ALREADY_CANCELLED` | Repeat cancel | "This booking was already cancelled." |
| `ROOM_CONFLICT` | Exclusion constraint | "That room is already booked at this time." |
| `INSTRUCTOR_CONFLICT` | Exclusion constraint | "That instructor is already teaching then." |
| `ATTENDANCE_WINDOW_CLOSED` | Past marking window | "Attendance can no longer be changed." |
| `INTERNAL_ERROR` | Unexpected | "Something went wrong. Please try again." |

Two of these carry product intent rather than merely reporting a fault. `SESSION_FULL` offers the waitlist, converting a dead end into the mechanism behind G1. `INSUFFICIENT_CREDITS` prompts repurchase, which is the sales mechanism described in G4.

### 7.3 Error boundaries

| File | Scope | Behaviour |
|---|---|---|
| `app/error.tsx` | Route segment | Friendly message + retry, navigation preserved |
| `app/global-error.tsx` | Root layout failure | Standalone full-page fallback |
| `app/not-found.tsx` | 404 | Link back to schedule |
| Per-segment `error.tsx` | Admin, instructor areas | Context-appropriate recovery |

### 7.4 What is never exposed

Raw Postgres errors, constraint names, SQL text, stack traces, and internal identifiers never reach the browser. `lib/errors/map.ts` translates Postgres SQLSTATE values — `23505` unique violation, `23P01` exclusion violation, `23514` check violation — into the codes above. Unmapped errors become `INTERNAL_ERROR`, with the full detail logged server-side only.

The reason is not merely tidiness: constraint names and SQL fragments describe the schema to an attacker.

---

## 8. Core UX Design

### 8.1 Design principles

1. **Phone first.** Students book on a phone, usually in a hurry. Every student flow is designed at 375px and enhanced upward.
2. **Consequences before confirmation.** No irreversible or costly action proceeds without stating its effect — the credit-loss warning is the canonical case.
3. **The balance is always visible.** Persistent in student navigation. Visibility drives repurchase (G4).
4. **Empty states teach.** A studio with no classes yet shows the admin how to create one, not a blank page.

### 8.2 Key screens

**Public schedule** — day-grouped list, sticky week navigator. Each card carries class type, instructor, time in studio-local, room, and an availability badge that is green with a count, amber below three seats, or grey reading "Full · 3 waiting". Tapping opens detail. Nothing requires an account.

**Session detail** — full information plus the `BookingPanel`, which renders exactly one of: Book, Join waitlist, "You're booked" with cancel, "You're #2 on the waitlist" with leave, or an out-of-credits notice with the studio's contact.

**Cancel dialog** — the most carefully designed screen in the product. It states the class, the time, and then one of two clear messages: *"Cancelling now returns 1 credit to your account"* or *"This is a late cancellation. Your credit will not be returned."* The destructive styling appears only in the second case. The user must never discover a forfeited credit after the fact.

**My bookings** — upcoming first, waitlist entries with live position inline, past below with attendance outcome.

**My credits** — large balance figure, next expiry date if within 30 days, and the full ledger with a plain-language description per row: *"Booked Vinyasa Flow, Tue 07:00 — 1 credit"*, *"Package expired — 3 credits"*.

**Instructor roster** — the only screen designed for use while standing up. Large tap targets, student name and a two-state toggle, an unmarked counter at top, and per-row save so a dropped connection loses one mark rather than the class.

**Admin schedule** — week grid with class-type colour coding and a fill indicator per session, so the owner can see at a glance which slots are underperforming (G5). Creating a session opens a side sheet; enabling recurrence shows `RecurrencePreview` listing the exact dates that will be generated, with conflicts flagged before submission rather than reported after.

**Admin student detail** — profile, balance, grant form, ledger, and attendance history on one page, because the owner's most common task is answering "how many classes do I have left" while the student is standing in front of them.

**Reports** — date-range selector driving fill rate by class type and time slot, attendance and no-show rates, waitlist conversion, and the inactive-student list. Each chart answers one question from G5.

### 8.3 Accessibility baseline

Radix primitives supply keyboard navigation and focus management. Beyond that: colour is never the sole carrier of meaning — the availability badge always includes text; all interactive elements reach 44px minimum touch targets; form errors are associated with inputs via `aria-describedby`; and action results are announced through a live region so a screen-reader user learns that a booking succeeded.

---

## 9. Traceability

### 9.1 Business rules to implementation

| Rule | Enforced by |
|---|---|
| BR-1 / BR-2 cancellation window | `cancel_booking` step 4; displayed by `lib/domain/policy.ts` |
| BR-3 promotion cutoff | `cancel_booking` step 7 |
| BR-4 credit required | `book_session` step 9 |
| BR-5 capacity | `book_session` steps 2 + 7 (row lock) |
| BR-6 no double booking | `book_session` step 8 + partial unique index |
| BR-7 FIFO with skip | `cancel_booking` step 8 |
| BR-8 no booking after start | `book_session` step 5 |
| BR-9 studio cancellation refunds all | `cancel_session` |
| BR-10 no-show forfeits | No refund path in `mark_attendance` |
| BR-11 marking window | `mark_attendance` guard |
| BR-12 unmarked default | `finalize-attendance` cron |
| BR-13 grant expiry | `expire-credits` cron |
| BR-14 UTC storage | `timestamptz` throughout; `lib/time/tz.ts` at display |

### 9.2 Resolved open questions from the Architecture document

| Question | Resolution |
|---|---|
| Recurrence limit | 12 weeks per operation |
| Notification retry | 3 attempts, then `failed`; in-app unaffected |
| Instructor onboarding | Admin-created with temporary password + forced rotation |
| Report strategy | Computed on demand in v1; revisited in the Scaling document |

### 9.3 New decisions introduced here

| Decision | Rationale |
|---|---|
| `credit_grants` table added | BR-13 per-grant expiry is not derivable from a flat ledger (§0.1) |
| Exclusion constraints on `sessions` | Makes room and instructor double-booking structurally impossible |
| `studio_id` denormalised onto `bookings` | Avoids a join in RLS evaluation on the highest-traffic table |
| Nothing is hard-deleted | Auditability; ledger foreign keys must remain valid |
| Refund returns to the originating grant | Preserves the package's expiry date |

### 9.4 Invariants for the Test Specification

1. Confirmed bookings for any session never exceed `capacity`.
2. For any grant, `credits_remaining` equals the sum of ledger deltas referencing it.
3. A student never holds both a confirmed booking and a waiting entry for one session.
4. No `credit_ledger` row is ever updated or deleted.
5. Waitlist promotion order is non-decreasing in `joined_at`.
6. No user reads a row belonging to another studio.
7. Every session's room and instructor are free for its full duration.

These become the property-based and permission tests in Deliverable 6.

---

*End of document — awaiting review before proceeding to implementation.*
