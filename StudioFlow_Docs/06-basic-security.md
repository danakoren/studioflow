# Basic Security Document
## StudioFlow — Class Booking & Waitlist Management

**Course:** Internet Technologies — Become a Full-Stack Engineer, RUNI CS 2026
**Document:** Deliverable 8 of 10 — Basic Security (מסמך אבטחה בסיסית)
**Version:** 1.0
**Status:** Draft for review
**Depends on:** Product Specification v1.0, Technical Architecture v1.0, Detailed Technical Design v1.0, Test Specification v1.1, Basic Scaling v1.0 (all approved)

---

## 0. Threat Model

Security claims are meaningless without stating who the attacker is and what they already have. This document assumes the following, and every control below is designed against it.

### 0.1 What the attacker possesses

| Asset | Why they have it |
|---|---|
| **The Supabase URL and anon key** | Both are embedded in the client bundle by design. Any visitor can read them from the browser's network tab in ten seconds. |
| **A valid account and JWT of their own** | Registration is open. An attacker registers as a student in thirty seconds. |
| **The ability to issue arbitrary HTTP requests** | `curl`, Postman, or the browser console. They are not confined to our user interface. |
| **Knowledge of the schema** | Table and column names are visible in PostgREST error responses and inferable from the client. Assume no obscurity. |
| **The ability to invoke any Server Action** | Server Action endpoint identifiers are present in the client bundle. |

### 0.2 The attacker profiles we defend against

| # | Profile | Goal |
|---|---|---|
| T1 | **Anonymous internet user** | Read student personal data, enumerate the membership list |
| T2 | **Authenticated student** | Grant themselves credits, read other students' data, escalate to admin |
| T3 | **Authenticated instructor** | Access financial data or other instructors' rosters |
| T4 | **Admin of a different studio** | Read or modify a competing studio's data |
| T5 | **Malicious insider (own studio's admin)** | Silently alter historical records to conceal an action |

T5 deserves note: we do not attempt to prevent a studio owner from managing their own studio — that is their role. We do ensure their actions are **recorded and immutable**, so a dispute over credits has an answer.

### 0.3 The single governing principle

> **The user interface is not a security boundary. Row Level Security is.**

Every control in §1, §3 and §4 improves usability, gives clear errors, and reduces attack surface. If all of them were removed, an attacker with an anon key and their own JWT would still be unable to read or modify another user's data — because Postgres would refuse. That is the property this document is built to establish.

---

## 1. Authentication

### 1.1 Mechanism

Authentication is delegated entirely to **Supabase Auth (GoTrue)**. The application never sees, hashes, compares or stores a password.

| Aspect | Implementation |
|---|---|
| Method | Email + password |
| Password storage | bcrypt, managed by GoTrue — never in our schema |
| Token format | JWT, signed by the project's secret |
| Access token lifetime | 1 hour |
| Refresh token | Long-lived, rotated on each use |
| Identity anchor | `auth.uid()` — the JWT `sub` claim, read directly by Postgres |

The reason for delegating is not convenience. Password handling has a long list of ways to be subtly wrong — timing-unsafe comparison, weak hashing parameters, unsalted digests, reset tokens that do not expire. GoTrue is a maintained implementation that has already solved them.

### 1.2 Token storage — cookies, never `localStorage`

Sessions are stored in **httpOnly cookies** via `@supabase/ssr`.

| Attribute | Value | Purpose |
|---|---|---|
| `httpOnly` | true | **JavaScript cannot read the token** — an XSS payload cannot exfiltrate the session |
| `Secure` | true | HTTPS only |
| `SameSite` | `Lax` | Blocks the token from being attached to cross-site POST requests (CSRF defence) |
| `Path` | `/` | Available to middleware and all routes |

The alternative — the browser-default `localStorage` — is readable by any script running on the page. A single XSS vulnerability would then hand an attacker a full session token that outlives the page visit. With httpOnly cookies, the same XSS is limited to acting within the current page. This is a meaningful reduction in blast radius and the reason `@supabase/ssr` is a dependency rather than the plain browser client.

Because JWTs can exceed a single cookie's size limit, `@supabase/ssr` chunks them across numbered cookies transparently.

### 1.3 Middleware session refresh

React Server Components can read cookies but **cannot write them**. An access token expiring mid-session would therefore leave a user silently logged out with no opportunity to refresh.

`middleware.ts` solves this. On every matched request it:

1. Reads the session cookies
2. Refreshes the access token if it is near expiry
3. Writes the updated cookies onto the response
4. Passes the request onward

It also performs **coarse route gating** — an unauthenticated request to `/admin/*` is redirected without a database round trip.

**Middleware is explicitly not an authorisation boundary.** It runs before the request reaches a route, but PostgREST requests from a browser console never pass through it at all. It is an optimisation and a user-experience improvement. §2 holds the actual boundary.

### 1.4 `getUser()` and not `getSession()` — a required rule

This is the most consequential single line of guidance in this document.

| Call | Behaviour | Safe for authorisation? |
|---|---|---|
| `getSession()` | Reads and decodes the cookie **locally**, without contacting the Auth server | **No** |
| `getUser()` | Sends the token to the Auth server, which **verifies the signature** | **Yes** |

A cookie is client-controlled data. `getSession()` returns what the cookie claims, which means a forged or tampered cookie yields a user object that looks entirely legitimate to application code.

**The rule, enforced in review and by lint configuration:** every server-side authentication decision — in `lib/auth/require.ts`, in every Server Action, in every protected layout — uses `getUser()`. `getSession()` is permitted only for non-security display concerns, and in practice is not used at all.

This is a widely-encountered mistake precisely because both calls appear to work identically during development. Recording it here means it does not get "simplified" during implementation.

### 1.5 Registration and password policy

| Control | Value | Reason |
|---|---|---|
| Minimum password length | 10 characters | Above the common 8-character default; length outperforms composition rules |
| Leaked-password check | Enabled (HaveIBeenPwned integration) | Blocks credentials already known to be compromised |
| Email confirmation | **Required** | Prevents registering with an address one does not control |
| Confirmation delivery | **Custom SMTP via Resend** | Supabase's built-in mail service is rate-limited to a handful of messages per hour and will fail during a live demonstration |
| Login failure message | Generic — "Invalid email or password" | Distinct messages would confirm which addresses are registered (user enumeration) |

The custom SMTP decision is operational rather than theoretical: enabling email confirmation without it produces a system that works in development and fails when several accounts are created in the same hour.

### 1.6 Instructor onboarding — the temporary password flow

Per the approved design, admins create instructor accounts directly.

| Step | Control |
|---|---|
| 1 | Admin submits name and email |
| 2 | Server generates a cryptographically random temporary password |
| 3 | Account created via the Admin API; `studio_members.must_change_password` set true |
| 4 | Temporary password returned to the admin **once, in the action response** |
| 5 | It is **never stored in our schema, never logged, never emailed** |
| 6 | Admin conveys it in person or by a channel of their choosing |
| 7 | On first login the instructor is forced to a password-change screen; all other routes redirect there |
| 8 | On change, `must_change_password` becomes false |

Step 5 is the important one. A temporary password written to a table, a log line, or an email inbox is a durable credential sitting somewhere it can be read later. Returning it once and discarding it means the only lasting copy is in the admin's memory or handwriting.

The residual weakness is the human handover in step 6, recorded as risk R4 in §6.

### 1.7 Session termination

| Event | Behaviour |
|---|---|
| Logout | Refresh token revoked server-side; cookies cleared |
| Password change | All other sessions invalidated |
| Member deactivation | `is_active` false — RLS policies then return zero rows, so an existing session becomes inert without needing to expire |

The third row matters: revoking access does not depend on the session ending. A deactivated member holding a valid, unexpired JWT can still authenticate, and still sees nothing.

---

## 2. Authorization and Row Level Security

### 2.1 The four layers, and which one is load-bearing

| Layer | Mechanism | Purpose | Load-bearing? |
|---|---|---|---|
| Middleware | Cookie check, redirect | Avoid rendering pages that will fail | No |
| Server Component | Role read from membership | Render correct navigation and controls | No |
| Server Action | Explicit role assertion | Fail fast with a comprehensible error | No |
| **Postgres RLS** | **Row-level policies** | **Actually prevent access** | **Yes** |

Only the fourth layer defends against T1–T4 from §0.2, because only the fourth layer is in the path of a request the attacker constructs themselves. The first three exist because a user who is shown a button they cannot use has a worse experience than one who never sees it — and because a clear `FORBIDDEN` message is better than an empty result set.

### 2.2 Deny by default — and the footgun that undermines it

RLS in Postgres is a two-part mechanism, and getting one part right while omitting the other produces a table that appears protected and is not.

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — without this, **policies are not consulted at all** and the table is fully readable by anyone holding the anon key.
2. Explicit policies — with RLS enabled and no policy, access is denied to everyone.

The failure mode is a new table added late in development where step 1 is forgotten. It works perfectly through the application, because the application only ever queries it as an authorised user. It is also world-readable via a single PostgREST request.

**Controls against this:**

| Control | Mechanism |
|---|---|
| Migration checklist | Every migration adding a table must enable RLS in the same migration |
| Database assertion | `assert_rls_coverage()` (migration 009) asserts `rowsecurity = true` for **every** table in the `public` schema. It is executed manually against the database. |
| Supabase advisor | The project's security linter is reviewed before deployment |

The automated assertion is the one that actually holds, because it does not depend on anyone remembering.

### 2.3 Where roles live

`studio_members` is the single source of truth: `(studio_id, user_id, role, is_active)`.

A role is a property of **a person within a studio**, not a global attribute. Roles are never read from the client, never passed as a parameter to an action, and never trusted from a JWT custom claim in v1 — they are looked up server-side from the table on every authorisation decision.

### 2.4 Helper functions — three required properties

Policies call small helper functions rather than repeating subqueries. Each helper is defined with three specific attributes, and each attribute prevents a distinct problem.

| Attribute | Prevents |
|---|---|
| `SECURITY DEFINER` | **Infinite recursion.** A policy on `studio_members` that queries `studio_members` recurses and fails at runtime. Running the helper with the definer's rights breaks the cycle. |
| `STABLE` | **Per-row re-evaluation.** Postgres evaluates a `STABLE` function once per statement rather than once per row — a correctness-neutral change with a large performance effect (Scaling §2.7). |
| `SET search_path = ''` | **Search-path hijacking.** A `SECURITY DEFINER` function with a mutable search path can be induced to call an attacker-created function or table shadowing a real one, executing with elevated privileges. All object references are schema-qualified. |

The third is the least obvious and the most serious. A `SECURITY DEFINER` function without a pinned `search_path` is a privilege-escalation primitive, and Supabase's own linter flags it for that reason.

### 2.5 Policy matrix

Every table has RLS enabled with no permissive default.

| Table | Anonymous | Student | Instructor | Admin |
|---|---|---|---|---|
| `sessions` | Read scheduled future only | Read studio's | Read studio's; update own taught | Full within studio |
| `bookings` | **None** | Read/write **own only** | Read for own taught sessions; update attendance | Full within studio |
| `waitlist_entries` | **None** | Read/write own only | Read for own taught sessions | Full within studio |
| `credit_grants` | **None** | **Read own only — no write** | **None** | Read studio's; insert |
| `credit_ledger` | **None** | **Read own only — no write, no update, no delete** | **None** | Read studio's; **no update, no delete** |
| `profiles` | **None** | Read own; instructor names on schedule | Read own; names on own rosters | Read studio's |
| `studios` | Read public fields | Read own studio | Read own studio | Read + update own studio |
| `studio_members` | **None** | **Read own row only — no update** | Read own row only | Full within studio |
| `notifications` | **None** | Read own; update own `read_at` | Read own | Read own |
| `rooms`, `class_types` | Read active | Read | Read | Full within studio |

Four cells carry the system's value and are worth stating explicitly:

**No role — including admin — may `UPDATE` or `DELETE` `credit_ledger`.** The ledger is append-only at the policy level, not by convention. A correction is a new `adjustment` entry. This is the control against T5: a studio owner cannot retroactively edit history to conceal a credit adjustment.

**Students cannot write to `credit_grants` or `credit_ledger` under any policy.** Credits are the product's unit of value. A student can *cause* a deduction by booking — via a `SECURITY DEFINER` function they may invoke but cannot circumvent — and can never author a row directly. Without this, the balance is forgeable and the credit system is decorative.

**Students cannot update their own `studio_members` row.** Otherwise the entire authorisation model collapses to one `UPDATE` setting `role = 'admin'`.

**Instructors have no access to `credit_ledger` or `credit_grants` at all.** The specification states instructors have no financial visibility; this is where that is enforced rather than merely stated.

### 2.6 Views and functions must not become bypasses

Two constructs can silently defeat RLS if declared carelessly:

| Construct | Risk | Control |
|---|---|---|
| Database views | A view runs with the **definer's** rights by default, so a view over `bookings` would expose every row regardless of policy | All views declared `WITH (security_invoker = true)` — including `v_sessions_with_availability` from Scaling §2.1 |
| `SECURITY DEFINER` functions | By design they bypass RLS | Each performs an **explicit internal permission check** as its first action, and each is granted only to the `authenticated` role |

The view case is easy to get wrong precisely because a view created to solve a performance problem does not look like a security change.

---

## 3. Protected Operations and Multi-Tenant Isolation

### 3.1 Operation classification

| Operation | Anonymous | Authenticated | Role required |
|---|---|---|---|
| View public schedule | Yes | Yes | — |
| View session detail | Yes | Yes | — |
| Register / log in | Yes | — | — |
| Book a seat | **No** | Yes | Active member |
| Join / leave waitlist | **No** | Yes | Active member |
| Cancel a booking | **No** | Yes | **Booking owner** or admin |
| View own bookings / credits | **No** | Yes | Self |
| View a roster | **No** | Yes | **Session's instructor** or admin |
| Mark attendance | **No** | Yes | **Session's instructor** or admin |
| Cancel a session | **No** | Yes | **Session's instructor** or admin |
| Create / edit sessions | **No** | Yes | Admin |
| Grant / adjust credits | **No** | Yes | Admin |
| Manage members, rooms, class types | **No** | Yes | Admin |
| Change studio policy | **No** | Yes | Admin |
| View reports | **No** | Yes | Admin |
| Cron jobs | **No** | — | Shared secret |

Note the ownership qualifiers. "Authenticated" is never sufficient for a mutation touching a specific record — cancelling a booking requires being *that booking's* owner, and marking attendance requires teaching *that session*. Role alone does not grant access to arbitrary rows.

### 3.2 Cross-user isolation (T2, T3)

An authenticated student holds a valid JWT and the public anon key. They can issue any PostgREST request they wish. What stops them reading another student's data is that the policy on `bookings` restricts rows to `student_id = auth.uid()`, evaluated by Postgres on every row.

The application contains **no ownership filter** in its queries. A Server Component asking for "bookings" receives only permitted rows. This removes an entire class of vulnerability: the forgotten `WHERE user_id = ?`, which is the most common cause of insecure direct object reference in conventional architectures.

### 3.3 Cross-studio isolation (T4)

Every studio-scoped table carries `studio_id`, and every policy constrains it to studios where the requester holds an active membership.

The isolation is designed against the **most privileged plausible attacker**: `admin.b@test`, a full administrator of a different studio, who is seeded for that purpose. Reads of Studio A's bookings, profiles, ledgers, grants and members, and writes of sessions and credits into it, must return zero rows or be rejected.

Choosing an admin rather than a student as the attacker matters. A student failing to read across studios could be an accident of a student-scoped policy; an admin failing proves the tenant boundary is independent of the role hierarchy.

This is built now, with one studio in production, because retrofitting tenant isolation is a rewrite rather than an addition — and because it is testable now.

### 3.4 Identifier design

All primary keys are UUIDs, not sequential integers.

A sequential key allows enumeration: request booking 1, 2, 3, and discover the shape of the dataset even when individual reads are denied — response timing and error differences leak existence. UUIDs make enumeration infeasible.

This is defence in depth rather than a primary control. RLS already denies the read. UUIDs mean the attacker cannot even establish what exists to attempt.

### 3.5 Server Actions are public endpoints

A Server Action compiles to a POST endpoint whose identifier is present in the client bundle. **Anyone can invoke it directly, with any arguments, in any order, at any time.**

This is the most commonly misunderstood property of the pattern. An action is not protected by the fact that only one button in the UI calls it. Consequently every action re-derives its own security context from scratch — authenticate, validate, authorise — and never infers anything from the fact that it was called.

Two corollaries enforced in review:

- **Never accept identity as a parameter.** An action takes `bookingId`, never `studentId`. The acting user comes from `getUser()`. An action accepting a user identifier from the client is an authorisation bypass with extra steps.
- **Never accept a role, price, or credit count that should be derived server-side.** These come from the database.

### 3.6 CSRF

| Control | Mechanism |
|---|---|
| Next.js built-in | Server Actions verify the `Origin` header against `Host` and reject mismatches |
| Cookie attribute | `SameSite=Lax` prevents the session cookie being attached to cross-site POST requests |

Both are present; neither is relied upon alone.

### 3.7 Cron endpoint protection

Route Handlers under `/api/cron/*` have no user session and mutate data. Each:

1. Reads a shared secret from the request header
2. Compares it to `CRON_SECRET` using a **constant-time comparison** (`timingSafeEqual`), not `===` — a naive comparison returns faster on an early-mismatching string, which leaks the secret one character at a time under repeated probing
3. Rejects with 401 and performs no work on mismatch


### 3.8 Attack surface deliberately absent

Recorded because absent surface is the cheapest security there is:

| Not present | Class of vulnerability avoided |
|---|---|
| File uploads | Malicious file storage, path traversal, content-type confusion, image parser exploits |
| Public REST API | An entire additional authenticated surface to secure |
| Payment processing | Card data handling, PCI scope, webhook forgery |
| User-supplied HTML or markdown | Stored XSS |
| Third-party OAuth providers | Token handling, account-linking confusion |
| Admin SQL console | Arbitrary query execution |

---

## 4. Input Validation and API Protection

### 4.1 The five layers, and which three are trusted

| # | Layer | Trusted |
|---|---|---|
| 1 | HTML attributes (`required`, `type`) | **No** — UX only |
| 2 | Zod on the client (`zodResolver`) | **No** — UX only |
| 3 | **Zod on the server, Action stage 2** | **Yes** |
| 4 | Postgres CHECK / UNIQUE / EXCLUDE constraints | **Yes** |
| 5 | RLS policies | **Yes** |

Layers 1 and 2 exist so users see errors immediately. A request forged with `curl` skips both entirely — which is exactly why the same Zod schema is imported from `lib/validation/` and re-executed server-side. One definition, validated twice, cannot drift.

### 4.2 Validation rules

| Rule | Implementation | Prevents |
|---|---|---|
| **Strict schemas** | `.strict()` — unknown keys rejected, not stripped | Mass assignment: a client adding `role: 'admin'` or `credits_remaining: 999` to a payload |
| **Explicit allowlists** | Every accepted field enumerated; no passthrough | Silent acceptance of fields the developer never considered |
| **Type coercion at the edge** | Strings parsed to numbers and dates within the schema | Type-confusion bugs deeper in the logic |
| **Bounded ranges** | Capacity 1–200, credits 1–500, duration 15–240, recurrence 1–12 | Resource exhaustion and absurd values |
| **Length limits** | Names 2–100, notes ≤ 500 | Storage abuse, oversized render payloads |
| **UUID format checks** | Before any database call | Wasted queries on malformed identifiers |

`tests/unit/validation.test.ts` exercises these against the Zod schemas directly, bypassing the forms.

### 4.3 Injection

**SQL injection.** No SQL string is ever concatenated. The Supabase client sends parameterised PostgREST requests; `plpgsql` functions receive typed parameters. Dynamic `EXECUTE` is not used anywhere in the project — where it is unavoidable in general practice, `format()` with `%I`/`%L` is the correct approach, and its absence here removes the question entirely. A unit test confirms the schemas accept a classic injection payload as inert literal text rather than rejecting it.

**Cross-site scripting.** React escapes all interpolated content by default. The project rule is absolute: **`dangerouslySetInnerHTML` is not used**, and no user-supplied content is ever rendered as HTML or markdown. A unit test confirms a `<script>` payload is accepted as a literal student name; that React escapes it on render is a property of the framework, not something this project asserts in a test. The absence of any rich-text feature (§3.8) means there is no legitimate reason for the rule to be relaxed later.

**Open redirect.** The auth callback accepts a `next` parameter. It is validated to be a relative path beginning with a single `/` — an absolute URL or protocol-relative `//evil.example` is rejected — so the login flow cannot be used to bounce a user to an attacker-controlled site with the studio's domain as the referrer.

### 4.4 Error handling as an information-disclosure control

| Never exposed | Why it matters |
|---|---|
| Postgres SQLSTATE codes | Reveals which constraint fired, mapping the schema |
| Constraint and index names | Names describe columns and business rules |
| SQL fragments | Direct schema disclosure |
| Stack traces | Reveals file paths, library versions, internal structure |
| Whether an email is registered | User enumeration |

`lib/errors/map.ts` translates Postgres error codes into the application's own `ErrorCode` enum before anything reaches the client. Unmapped errors become `INTERNAL_ERROR` with full detail logged **server-side only**.

### 4.5 Absent in v1: rate limiting

There is no rate limiting on authentication attempts or on Server Actions. Supabase Auth applies its own limits to sign-in and email sending, which provides partial coverage, but application actions are unthrottled.

Impact is bounded — booking still requires credits, and RLS still constrains every read — so this is a resource-abuse and brute-force concern rather than a data-exposure one. It is recorded as risk **R1** with a concrete remedy in §6.

---

## 5. Secrets Management

### 5.1 The `NEXT_PUBLIC_` boundary

Next.js inlines any environment variable prefixed `NEXT_PUBLIC_` **into the client bundle at build time**. It is not hidden, not obfuscated, and not retrievable — once built and deployed, it is public permanently. A secret exposed this way is compromised the moment it ships, and rotating it is the only remedy.

### 5.2 Variable register

| Variable | Prefix | Reaches browser | Sensitivity | Consumed by |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | None | Client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | **None — by design** | Client + server |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | **Never** | **Critical** | Cron routes only |
| `RESEND_API_KEY` | **Secret** | **Never** | High | Dispatch job only |
| `CRON_SECRET` | **Secret** | **Never** | High | Cron route auth |
| `NEXT_PUBLIC_SITE_URL` | Public | Yes | None | Email link construction |

### 5.3 Why the anon key is safe to publish — and the condition attached

The anon key identifies the project and the `anon`/`authenticated` PostgREST roles. It grants **no data access on its own**, because every table denies access absent a matching policy.

The condition is absolute and worth stating: **the anon key is safe if and only if RLS is enabled on every table.** A single table where `ENABLE ROW LEVEL SECURITY` was omitted is world-readable to anyone who reads the bundle. This is why §2.2's automated `pg_tables` assertion exists — it is not schema hygiene, it is the precondition that makes publishing the key acceptable.

### 5.4 The service role key

This key **bypasses RLS entirely**. Holding it is equivalent to unrestricted database access across every studio.

| Control | Mechanism |
|---|---|
| Never prefixed `NEXT_PUBLIC_` | Excluded from the client bundle by construction |
| Confined to one module | Only `lib/supabase/service.ts` reads it |
| Import restriction | ESLint `no-restricted-imports` permits that module to be imported only by `app/api/cron/**` — a violation fails the build |
| Source check | `npm run audit:security` asserts that no secret carries a `NEXT_PUBLIC_` prefix, which is what would place it in the client bundle. |
| Never logged | Excluded from all logging and error reporting |

The prefix check is mechanical rather than review-based deliberately. A single accidental prefix would publish a credential that defeats every policy in §2, and that mistake is invisible in a diff.

### 5.5 Repository and deployment hygiene

| Control | Practice |
|---|---|
| `.env.local` in `.gitignore` | Committed at project initialisation, before any secret exists |
| `.env.example` committed | Variable **names** and placeholder values only, so the repository documents required configuration without carrying secrets |
| Secrets set in Vercel per environment | Production and Preview configured separately |
| Preview isolation | Preview deployments point at a **separate Supabase project**, so a leak from a preview build cannot touch production data |
| Rotation on exposure | If a secret ever reaches git history, it is **rotated** — history rewriting is treated as insufficient, since clones and forks may already exist |
| Secrets never in client error messages | Error mapping (§4.4) prevents environment values surfacing in responses |

The preview-isolation point is the one most often skipped in student projects: sharing a production service role key with preview deployments means every pull-request build has full production database access.

---

## 6. Known Security Risks and Future Improvements

Recorded honestly. Each risk states its exposure, current mitigation, and intended remedy.

### 6.1 Outstanding risks in v1

| # | Risk | Exposure | Current mitigation | Severity |
|---|---|---|---|---|
| **R1** | **No application rate limiting** | Credential stuffing on login; automated probing of actions | Supabase Auth's own limits; actions require valid credits and pass RLS | **Medium** |
| **R2** | **No multi-factor authentication** | A compromised admin password grants full studio access | Strong password policy, leaked-password blocking | **Medium** |
| **R3** | **No general audit log** | Administrative actions other than credit movements are not systematically recorded | Ledger is append-only with `created_by`; sessions record `created_by`/`cancelled_by` | **Medium** |
| **R4** | **Temporary password handed over out-of-band** | Interception depends on the admin's chosen channel | Single-use, never stored, forced rotation at first login | **Low–Medium** |
| **R5** | **Email is the sole account-recovery factor** | Compromised mailbox permits account takeover | Standard for this product class | **Medium** |
| **R6** | **No Content-Security-Policy or hardened security headers** | Reduced XSS defence in depth; clickjacking possible | React escaping; no `dangerouslySetInnerHTML`; no user HTML | **Medium** |
| **R7** | **Service role key held in the Vercel environment** | Compromise of the Vercel account yields full database access | Vercel account access control; key confined to three cron routes | **High if realised** |
| **R8** | **No automated dependency vulnerability scanning** | A vulnerable transitive dependency could persist unnoticed | Small, deliberately chosen dependency set | **Medium** |
| **R9** | **No re-authentication for sensitive actions** | An unattended logged-in admin session can grant credits | Ledger records `created_by` and cannot be edited | **Low–Medium** |
| **R10** | **No secret scanning in CI** | A committed key would rely on human review to catch | `.gitignore`, `.env.example`, the `NEXT_PUBLIC_` prefix check in `npm run audit:security` | **Medium** |
| **R11** | **No point-in-time recovery on the free tier** | Data loss window between backups | Schema in migrations; data recoverable only to last backup | **Medium** |
| **R12** | **Soft deletion conflicts with data-erasure requests** | Nothing is hard-deleted (Design §3.13), so a deletion request cannot be satisfied by deletion | Data minimisation — no addresses, no payment data, no documents | **Low now, higher with growth** |
| **R13** | **Insider risk from a studio's own admin** | An admin can grant themselves unlimited credits | Every movement recorded in an **immutable** ledger with attribution | **Accepted** |

R13 is marked accepted rather than open. The studio owner is the customer; preventing them from administering their own studio is not a goal. Making their actions permanently attributable is, and §2.5 delivers it.

### 6.2 Improvements, in priority order

**Tier 1 — before any real studio uses this**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| S1 | **Rate limiting** | R1 | Per-IP limits on auth; per-user limits on mutating actions, at middleware. Highest value per unit of effort. |
| S2 | **Security headers + CSP** | R6 | `next.config` headers: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Static config, immediate benefit. |
| S3 | **Dependabot + `npm audit` in CI** | R8 | Automated pull requests for vulnerable dependencies. |
| S4 | **Secret scanning in CI** | R10 | Gitleaks or GitHub secret scanning, blocking on detection. |

**Tier 2 — as the customer base grows**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| S5 | **MFA for admin accounts** | R2, R5 | Supabase Auth TOTP enrolment, required for the admin role only — the account whose compromise matters most. |
| S6 | **General audit log** | R3, R9 | Append-only `audit_events` table capturing actor, action, target and timestamp for every administrative mutation, written inside the same transaction as the action. |
| S7 | **Step-up re-authentication** | R9 | Password re-entry for credit grants and policy changes. |
| S8 | **Point-in-time recovery** | R11 | Paid Supabase tier; a paying customer's data warrants it. |

**Tier 3 — maturity**

| # | Improvement | Addresses | Approach |
|---|---|---|---|
| S9 | **Anonymisation routine** | R12 | Replace personal fields with tombstones while preserving ledger and booking integrity — satisfies erasure without destroying the audit trail. |
| S10 | **Secrets manager with rotation** | R7 | Move the service role key out of plain environment variables; scheduled rotation. |
| S11 | **Anomaly alerting** | R1, R13 | Alert on unusual patterns — bulk credit grants, mass cancellations, repeated failed logins. |
| S12 | **External penetration test** | All | Independent review before serving multiple paying studios. |

### 6.3 What we consciously did not attempt

| Not attempted | Reason |
|---|---|
| End-to-end encryption of stored data | Data is names, class bookings and credit counts — not medical or financial records. Encryption at rest is provided by the platform; application-level encryption would prevent the queries and aggregations the product exists to perform. |
| Custom cryptography anywhere | Every cryptographic operation is delegated to GoTrue or the platform. |
| Defending against a compromised Supabase or Vercel platform | Outside our control and outside the assignment's scope. |
| WAF or DDoS mitigation | Provided by Vercel's edge network. |

---

## 7. Security Testing Coverage

What runs is `npm run verify`: 111 unit tests across five files, plus
`npm run audit:security`, a nine-item source-level checklist.

| Check | Mechanism |
|---|---|
| `getSession()` absent from all authorisation paths | `npm run audit:security` |
| `getUser()` is the verification call in `lib/auth/require.ts` | `npm run audit:security` |
| `dangerouslySetInnerHTML` absent | `npm run audit:security` |
| Service-role client confined to its allowlist | `npm run audit:security`, and ESLint `no-restricted-imports` |
| No secret carries a `NEXT_PUBLIC_` prefix | `npm run audit:security` |
| No layout-wide cache invalidation | `npm run audit:security` |
| Mass assignment: every schema is `.strict()` | `npm run audit:security` |
| Self-service actions derive identity from `getUser()` | `npm run audit:security` |
| Every action module routes through `runAction()` | `npm run audit:security` |
| Input validation rejects malformed and hostile values | `tests/unit/validation.test.ts` |
| Redirect sanitisation rejects off-site targets | `tests/unit/redirect.test.ts` |
| Cancellation and promotion window calculations | `tests/unit/policy.test.ts` |

The Row Level Security controls in §2 are enforced by the policies in migration
005 and the privilege grants in migrations 010 and 011. They are not covered by
automated tests. `assert_rls_coverage()`, `assert_no_overbooking()`,
`assert_ledger_consistency()`, `assert_no_dual_state()`,
`assert_definer_search_path()` and `assert_views_security_invoker()`
(migration 009) check these properties against a live database and are executed
manually.

---

## 8. Pre-Deployment Security Checklist

Executed against the production deployment before submission.

| # | Check | Method |
|---|---|---|
| 1 | RLS enabled on every table in `public` | Automated assertion (§2.2) |
| 2 | Every table has at least one explicit policy | Schema review + Supabase advisor |
| 3 | Supabase security advisor reports no errors | Dashboard |
| 4 | All `SECURITY DEFINER` functions pin `search_path` | Schema review |
| 5 | All views declared `security_invoker` | Schema review |
| 6 | No secret carries a `NEXT_PUBLIC_` prefix | `npm run audit:security` |
| 7 | No secret appears in git history | Gitleaks scan of full history |
| 8 | `.env.local` untracked; `.env.example` contains placeholders only | `git ls-files` |
| 9 | Production and preview use separate Supabase projects | Vercel environment configuration |
| 10 | Email confirmation enabled with custom SMTP configured | Supabase Auth settings |
| 11 | `getSession()` absent from all authorisation paths | Repository grep |
| 12 | `dangerouslySetInnerHTML` absent from the codebase | Repository grep |
| 13 | Full permission suite passes against the deployed database | Test run |
| 14 | HTTPS enforced; no mixed content | Browser inspection |

---

*End of document — awaiting review before proceeding to implementation.*
