# StudioFlow — Grading Guide

A short orientation document for the reviewer. It covers two things: what the
project is and how to try it, and an honest account of which parts were hard
and which were straightforward.

---

## 1. What we built, and how to use it

### What it is

**StudioFlow** is a full-stack class-booking and credit-management application
for a small boutique fitness studio. Students browse a weekly schedule, book
classes against pre-purchased credit packages, join a waitlist when a class is
full, and are promoted automatically when a seat opens. Instructors mark
attendance; administrators manage the schedule, students, credits and studio
policy.

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router, React Server Components), TypeScript, Tailwind CSS v4 |
| **Backend** | Supabase — PostgreSQL, Row Level Security, Auth |
| **Hosting** | Vercel, with three scheduled cron jobs |
| **Scale** | 23 routes · 12 SQL migrations · 105 automated tests |

The central architectural decision is that **business rules live in PostgreSQL
functions running under row locks, not in application code**. Booking a class,
cancelling, promoting from a waitlist and spending a credit are all single
transactional database calls. Row Level Security is the actual security
boundary — the application cannot read another studio's data even if the code
asks it to. This is documented in `StudioFlow_Docs/02-technical-architecture.md`.

### Live application

> ### 🔗 https://studioflow-rust.vercel.app

### Sign-in credentials — all three roles

The system has three roles. Every seeded account uses the same password,
`password123`, and none is forced to change it on first login.

| Role | Email | Password | Signed in as | Navigation this role receives |
|---|---|---|---|---|
| **Administrator** | `admin.a@test` | `password123` | Dana Cohen | Dashboard · Schedule · Students · Reports · Settings |
| **Instructor** | `instructor2.a@test` | `password123` | Omer Levi | Schedule · Teaching · My classes · Credits |
| **Student** | `student1.a@test` | `password123` | Noa Shapira | Schedule · My classes · Credits |

*Also available, same password:* `instructor1.a@test` (Yael Bar), who teaches
the full-and-waitlisted class about 48 hours out, and `student2.a@test` through
`student6.a@test`.

### Three steps to evaluate it

1. **Log in.** Open the live URL and sign in with the administrator credentials
   above. You will land on the schedule.

2. **View the weekly schedule.** Click **Schedule** in the navigation bar. As an
   administrator this shows the full week as a seven-column grid, with each
   class colour-coded by type and labelled with its instructor and its
   **booked / capacity** count. Today's column is highlighted; past classes are
   dimmed; cancelled ones are struck through.

3. **Open a class to see its bookings.** Click any class block. The session page
   lists the enrolled students and the waitlist in position order. The most
   informative one to open is the class **roughly 48 hours from now**: it is
   seeded deliberately full, with two students already waiting, so both the
   roster and the waitlist are populated.

**Two short detours, if useful:**

- *The member's view:* sign in as the student account above (Noa Shapira), who
  holds a 10-class credit package and an existing booking. The **Credits** page
  shows the running ledger — every credit spent, refunded or expired, with a
  reason.
- *The instructor's view:* sign in as an instructor account and open
  **Teaching**. Attendance marking lives there rather than in the admin pages.

### Testing role separation

Three checks demonstrate the access control end to end:

1. **The navigation bar changes with the role.** Compare the three accounts
   above. Note that it is *role-primary*, not cumulative: an administrator gets
   the admin set only, and reaches their own bookings from the tile grid at the
   foot of the Dashboard rather than from the header.

2. **A forbidden route is refused, not merely hidden.** Signed in as
   `student1.a@test`, type `/admin` directly into the address bar. You are
   redirected to the schedule rather than shown the dashboard. The same applies
   to `/teach`. (Administrators *can* reach `/teach` — that is deliberate, so an
   owner who also teaches can mark their own class.)

3. **The redirect is not the security.** It is a user-experience affordance that
   produces a clear outcome instead of an empty screen. The actual boundary is
   PostgreSQL Row Level Security: every table carries policies that scope rows
   to the signed-in user's studio and role, so a request that bypasses the
   interface entirely still returns nothing. Read queries carry no ownership
   filters in application code at all — the database supplies them, so there is
   no `where user_id = …` for a developer to forget. See
   `StudioFlow_Docs/06-basic-security.md`.

> **One note so nothing looks broken:** in-app notifications work normally, but
> transactional *email* is not configured on this deployment (no mail provider
> key), so no messages are delivered to a real inbox. The scheduled jobs run
> once daily rather than every few minutes — a Vercel Hobby-plan constraint
> explained in section 2 below.

---

## 2. What was hard, and what was easy

### Harder than expected

**Timezones and daylight saving.** This was the single most defect-prone area.
All times are stored in UTC and displayed in the studio's local timezone
(`Asia/Jerusalem`), which observes daylight saving. The trap is in generating
recurring classes: a class scheduled for 07:00 local must *stay* at 07:00 local
after a DST transition, which means its UTC instant shifts by an hour. The
naive implementation — adding seven days to a UTC timestamp twelve times —
silently produces a class at 06:00 for half the term. Expansion therefore
iterates in the studio's local timezone and converts each occurrence to UTC
individually. Every policy comparison (is this cancellation inside the
twelve-hour window? is this waitlist promotion inside the two-hour cutoff?)
crosses that same boundary, so the conversion had to be explicit everywhere
rather than relying on the host's local clock — which is UTC on Vercel and
something else on a laptop, a mismatch that produces bugs visible only in
production.

**Vercel Hobby-plan cron limits, discovered late.** The specification called for
notification dispatch every five minutes and hourly attendance finalisation. The
Hobby tier permits **at most one cron run per day**, and — importantly — it
*rejects* a more frequent expression at deploy time rather than quietly
throttling it, which would have failed the build outright. The architecture
document had flagged this as a risk before deployment, so the response was
prepared rather than improvised: all three jobs were already written to be
**idempotent**, each selecting only rows in a not-yet-processed state. That
makes them sensitive to *whether* they run, not *when*, so moving to daily
schedules cost promptness and nothing else. No business rule changed, and
in-app notifications were not delayed at all — they are written synchronously
inside the transaction that triggers them.

**Database permissions.** An early and genuinely confusing failure: every query
returned an opaque empty error. The cause was that Row Level Security had been
enabled and privileges granted on *views*, but never on the underlying *base
tables*, so Postgres refused each query before any policy was evaluated. Fixed
in migrations `010` and `011`, which also keep the credit ledger append-only.

### What went smoothly

**Building the UI.** Once the design system was established in `globals.css` —
colour palette, spacing, shadows, motion tokens — individual components came
together quickly and consistently. The weekly schedule grid, the booking
controls and the admin tables were largely mechanical to assemble on top of it.
Server Components helped here: most pages fetch their own data directly, with no
client-side state management library anywhere in the project.

**Automated testing.** Setting up the first Vitest test took some effort; every
test after that was cheap. The suite reached **105 tests** covering colour
assignment, redirect sanitisation, date and policy calculations, and the shared
rule table that proves the TypeScript display logic and the PostgreSQL
authoritative logic agree with each other. All 105 pass, alongside a clean
TypeScript compile, a clean lint, and a scripted security audit.

---

## Where to look in the repository

| Path | Contents |
|---|---|
| `studio-flow/` | The Next.js application |
| `studio-flow/app/` | Routes — `/schedule`, `/my/*`, `/teach/*`, `/admin/*`, `/api/cron/*` |
| `supabase/migrations/` | 12 migrations: schema, RLS policies, business-rule functions |
| `StudioFlow_Docs/` | Six specification documents (product, architecture, design, test, scaling, security) |

Running it locally requires only `npm install` and `npm run dev` inside
`studio-flow/`, with Supabase credentials in `.env.local` (see `.env.example`).
`npm run verify` runs the type check, the test suite and the security audit.
