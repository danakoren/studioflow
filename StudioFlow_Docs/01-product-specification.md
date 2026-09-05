# Product Specification Document
## StudioFlow — Class Booking & Waitlist Management for Small Yoga & Pilates Studios

**Course:** Internet Technologies — Become a Full-Stack Engineer, RUNI CS 2026
**Document:** Deliverable 3 of 10 — Product Specification (מסמך אפיון מוצר)
**Version:** 1.0
**Status:** Draft for review

---

## 1. Executive Summary

StudioFlow is a web application that replaces the WhatsApp-group-and-spreadsheet workflow used by small yoga and Pilates studios to manage class bookings.

It gives studio owners a live schedule, enforced capacity limits, an automatic waitlist that fills seats freed by cancellations, a cancellation policy that is applied by the system rather than negotiated by message, and a class-credit balance per student.

The product is deliberately narrow. It serves single-location studios with one to five instructors and roughly 40–300 active students. It does not attempt to compete with the full feature surface of established studio-management platforms; it targets the specific segment for which those platforms are too expensive and too slow to configure.

---

## 2. The Problem

### 2.1 How small studios operate today

A typical small studio runs its schedule through some combination of:

- A WhatsApp group per class or per studio, where students write "I'm in" for tomorrow's 07:00 class.
- A Google Sheet or paper notebook where the owner tracks who has how many classes left on their 10-class card.
- The owner's memory for who cancelled late, who is owed a credit, and who has been absent for three weeks.

This works at 20 students. It breaks somewhere between 60 and 100.

### 2.2 The four concrete failures

**Failure 1 — Seats stay empty even when there is demand.**
A class is full. Three students who wanted it were told "sorry, full." That evening, two people drop out. Nobody tells the three who were turned away, because doing so requires the owner to notice the cancellation, remember who asked, and message them individually — usually at 22:00. The class runs with two empty mats while three paying students sit at home. This is pure lost revenue on a fixed cost: the room is rented and the instructor is paid whether the mat is occupied or not.

**Failure 2 — Overbooking and disputes.**
A studio room holds 14 mats. Sixteen people write "I'm in" on a fast-moving thread. Two are turned away at the door. Nobody can prove who wrote first, because messages, edits and deletions are hard to audit under pressure. The owner absorbs the conflict.

**Failure 3 — The cancellation policy exists on paper only.**
Almost every studio has a rule of the form "cancel at least 12 hours before class or you lose the credit." Enforcing it manually means the owner personally telling a paying customer, in a chat, that they owe money — the day after they were sick. Most owners avoid the conversation. The policy is then unenforced, late cancellations continue, and Failure 1 gets worse because the seat is released too late to be refilled.

**Failure 4 — Administrative time is significant and unpaid.**
Reconciling attendance against class cards, answering "how many classes do I have left?", chasing expired packages, and rebuilding next week's schedule consumes several hours per week. That time comes out of teaching, marketing, or the owner's evening.

### 2.3 Why the problem persists

Full studio-management platforms solve this, but they are priced and designed for multi-location chains: significant monthly cost, long onboarding, and a large surface area of features (payroll, retail POS, marketing automation) the small studio will never use. The result is a segment that knows the tools exist and still chooses WhatsApp, because the switching cost feels higher than the pain.

The wedge is therefore **not "more features than the incumbents."** It is *one workflow, correct and enforced, that a studio owner can configure alone in under thirty minutes.*

---

## 3. Users vs. Customer

The distinction matters because the person who pays is not the person who uses the product most often.

### 3.1 The Customer — Studio Owner

The **Studio Owner** is the paying customer. They make the purchase decision, own the account, and are the only party with a commercial relationship to the product.

- **Buys because of:** revenue recovered from filled seats, hours of admin returned, and the ability to enforce a cancellation policy without having the conversation personally.
- **Churns because of:** any incident that damages trust with their own students — a double booking, a lost credit, a class that vanishes from the schedule.
- **Business model:** monthly SaaS subscription, tiered by number of active students. Payment collection for the subscription itself is handled outside the product in v1 (see §8).

The Studio Owner holds the Admin role in the application. Every other user is a beneficiary, not a buyer.

### 3.2 Role 1 — Student (Member)

The highest-volume user. Opens the app several times a week, usually on a phone.

**Goals:** see what classes are available, secure a spot quickly, know how many credits remain, and cancel without a social confrontation.

**Permissions:**
- Register, log in, manage own profile
- View the public class schedule
- Book a seat in a class with available capacity
- Join the waitlist for a full class, and see their own position
- Cancel their own booking
- View their own credit balance and booking history
- Receive notifications about their own bookings and waitlist promotions

**Explicitly cannot:** see the roster of other students, see any other student's credit balance or contact details, create or edit classes, or view any revenue or attendance reporting.

### 3.3 Role 2 — Instructor

**Goals:** know who is coming to the classes they teach, and record who actually showed up.

**Permissions:**
- All Student permissions for their own account (an instructor may also take classes)
- View the schedule of classes **they are assigned to teach**
- View the roster (name, and waitlist order) for their own classes
- Mark attendance — present / absent — for their own classes, from the point the class starts until 24 hours after it ends
- Cancel a class session they teach, which triggers notification and credit refund to all booked students

**Explicitly cannot:** create classes, edit the schedule, change studio policy, manage student credits, view rosters for classes taught by other instructors, or access any financial reporting.

The instructor role exists in the product for a reason beyond convenience: it is the mechanism that keeps attendance data accurate without the owner attending every class. Attendance accuracy is what makes the no-show policy enforceable.

### 3.4 Role 3 — Admin (Studio Owner or Studio Manager)

**Goals:** run the studio. Configure everything, see everything, fix everything.

**Permissions:**
- Full read and write access to all data within their own studio
- Create, edit, and cancel class sessions; generate a recurring weekly schedule
- Create and manage class types (Vinyasa, Reformer Pilates, Prenatal) and rooms with mat capacity
- Invite and manage instructors
- View and manage the student list
- Grant, adjust, and expire student credit packages, with a recorded reason
- Configure studio policy: cancellation window, waitlist promotion cutoff, no-show handling
- Manually book or remove a student from any class (walk-ins, phone bookings, exceptions)
- Override attendance marking
- View reports: attendance rate, fill rate, waitlist conversion, no-show rate

**Explicitly cannot:** access data belonging to any other studio. This boundary is enforced at the database level, not in application code (see the Security document).

### 3.5 Role summary

| Capability | Student | Instructor | Admin |
|---|:---:|:---:|:---:|
| View public schedule | Yes | Yes | Yes |
| Book / cancel own seat | Yes | Yes | Yes |
| View own credit balance | Yes | Yes | Yes |
| View roster of own taught class | — | Yes | Yes |
| Mark attendance | — | Own classes | All classes |
| Cancel a class session | — | Own classes | All classes |
| Create / edit schedule | — | — | Yes |
| Manage students & credits | — | — | Yes |
| Configure studio policy | — | — | Yes |
| View reports | — | — | Yes |

---

## 4. Business Goals

Each goal is stated with the mechanism that delivers it and the metric that demonstrates it. The metrics are also the acceptance criteria for the project.

### G1 — Recover revenue from seats that would otherwise sit empty

**Mechanism:** an automatic waitlist. When a booked student cancels, the system immediately promotes the first eligible person on the waitlist and notifies them, with no action required from the owner.

**Metric:** *waitlist conversion rate* — the percentage of waitlist entries that become confirmed bookings. Baseline in a manual studio is close to zero, because the promotion rarely happens in time. Target: above 50% of cancellations occurring more than 4 hours before class result in a filled seat.

**Why it matters commercially:** the marginal cost of the fourteenth student in a fourteen-mat room is zero. Every recovered seat is close to pure margin.

### G2 — Return administrative hours to the studio owner

**Mechanism:** self-service booking and cancellation, self-service credit balance visibility, and schedule generation from a weekly template rather than manual re-entry.

**Metric:** *manual interventions per week* — the count of admin-initiated bookings, cancellations and credit adjustments. A low number indicates students are serving themselves. Secondary: owner-reported hours per week on scheduling admin, target under one hour.

### G3 — Make the cancellation policy actually enforceable

**Mechanism:** the system applies the window automatically and impersonally. Cancelling outside the window refunds the credit; cancelling inside it does not. The rule is visible before the student confirms, so there is no surprise, and no conversation for the owner to have.

**Metric:** *late-cancellation rate* and *no-show rate*. Both should decline over the first two months as the enforced rule changes behaviour.

### G4 — Support the sale of class packages

**Mechanism:** students hold a credit balance. Booking consumes a credit; eligible cancellation returns it. The balance is visible to the student at all times, and low-balance states are surfaced.

**Metric:** *credits consumed per active student per month*, and the count of students at a zero balance who are prompted to repurchase. Making the balance visible is itself a sales mechanism — students who can see "1 class remaining" repurchase sooner than students who must ask.

### G5 — Give the owner visibility into studio health

**Mechanism:** a reporting view over attendance and booking data.

**Metric:** the owner can answer, without a spreadsheet: which class times fill and which do not, which instructors have the strongest retention, and which students have stopped attending.

### G6 — Eliminate overbooking entirely

**Mechanism:** capacity enforced atomically at the database level, so two simultaneous requests for the last seat cannot both succeed.

**Metric:** *zero* confirmed bookings above room capacity. This is a correctness requirement, not a target — a single violation is a defect.

---

## 5. Software Capabilities

The capabilities required to deliver the goals above. Each is traced to the goal it serves.

### 5.1 Identity and access
| # | Capability | Serves |
|---|---|---|
| C1 | Email/password registration and login for students | G2, G4 |
| C2 | Role assignment (student / instructor / admin) with role-appropriate navigation and access | G5, G6 |
| C3 | Instructor invitation by admin | G2 |
| C4 | Every record scoped to a studio, with cross-studio access impossible | — (integrity) |

### 5.2 Schedule management
| # | Capability | Serves |
|---|---|---|
| C5 | Manage class types (name, duration, description) | G2 |
| C6 | Manage rooms with mat capacity | G6 |
| C7 | Create a single class session: type, instructor, room, date, start time, capacity | G2 |
| C8 | Generate a recurring weekly schedule for N weeks, producing individual editable sessions | G2 |
| C9 | Edit or cancel a session, with automatic notification and credit refund to all booked students | G2, G3 |

### 5.3 Booking
| # | Capability | Serves |
|---|---|---|
| C10 | Browse upcoming schedule with live remaining-capacity indication | G1 |
| C11 | Book a seat, atomically validating capacity, credit balance, and duplicate booking | G4, G6 |
| C12 | Cancel a booking, with the policy window applied automatically | G3 |
| C13 | Join a waitlist for a full class, with FIFO ordering | G1 |
| C14 | Leave a waitlist, with remaining positions recalculated | G1 |
| C15 | View own upcoming and past bookings | G2 |

### 5.4 Waitlist automation
| # | Capability | Serves |
|---|---|---|
| C16 | On cancellation, automatically promote the first waitlisted student who has a sufficient credit balance | G1 |
| C17 | Suppress promotion inside the promotion cutoff, when notice would be too short to be useful | G1 |
| C18 | Notify the promoted student that they now hold a confirmed seat | G1 |

### 5.5 Credits
| # | Capability | Serves |
|---|---|---|
| C19 | Credit balance per student, with a full immutable ledger of every movement | G4 |
| C20 | Admin grants a credit package, with amount, expiry date, and reason recorded | G4 |
| C21 | Automatic deduction on booking and automatic refund on eligible cancellation | G3, G4 |
| C22 | Student-visible balance, ledger history, and low-balance prompt | G4 |

### 5.6 Attendance
| # | Capability | Serves |
|---|---|---|
| C23 | Instructor views roster for their own session | G5 |
| C24 | Mark each booking present or absent | G3, G5 |
| C25 | Unmarked bookings resolve to a defined default after the marking window closes | G5 |

### 5.7 Notifications
| # | Capability | Serves |
|---|---|---|
| C26 | In-app notification centre — the guaranteed delivery channel | G1 |
| C27 | Email notification for waitlist promotion and class cancellation — the high-value events | G1 |

### 5.8 Reporting
| # | Capability | Serves |
|---|---|---|
| C28 | Fill rate by class type, by instructor, and by time slot | G5 |
| C29 | Attendance, no-show and late-cancellation rates | G3, G5 |
| C30 | Waitlist conversion rate | G1 |
| C31 | Inactive-student list (no attendance in N days) | G5 |

---

## 6. Business Rules

These are the parameters the system enforces. They are configurable per studio, with the defaults shown. This section is the source of truth for the Test Specification document.

| ID | Rule | Default |
|---|---|---|
| BR-1 | Cancellation window — cancelling at or before this many hours before start returns the credit | 12 hours |
| BR-2 | Cancelling inside the window does not return the credit | — |
| BR-3 | Waitlist promotion cutoff — no automatic promotion inside this many hours before start | 2 hours |
| BR-4 | Booking requires a credit balance of at least 1 | — |
| BR-5 | Confirmed bookings for a session may never exceed room capacity | — |
| BR-6 | A student may hold at most one active booking **or** one waitlist entry per session, never both | — |
| BR-7 | Waitlist promotion is strictly FIFO by join time, skipping students with insufficient credit | — |
| BR-8 | Booking is not permitted after the session start time | — |
| BR-9 | A session cancelled by the studio refunds credits to all booked students regardless of the window | — |
| BR-10 | A no-show does not return the credit | — |
| BR-11 | Attendance may be marked from session start until 24 hours after session end | — |
| BR-12 | Bookings unmarked after the marking window default to `attended` | — |
| BR-13 | Credit packages expire on a date set at grant time; expired credits are unusable | — |
| BR-14 | All times are stored in UTC and displayed in the studio's local timezone | Asia/Jerusalem |

BR-12 deserves a note, because the alternative is tempting and wrong. Defaulting unmarked bookings to `absent` would silently penalise students for an instructor's administrative oversight — the studio would be taking credits from people who attended. Defaulting to `attended` errs in the student's favour, which is the correct direction for a trust-sensitive product.

---

## 7. Core User Flows

### Flow 1 — Student registration and first booking

1. Student opens the studio's public schedule URL. The schedule is visible without an account, since forcing registration before value is seen suppresses conversion.
2. Student selects a class and chooses to book. The system requires authentication.
3. Student registers with email, password, and full name, or logs in.
4. On first registration, a student record is created and linked to the studio, with a zero credit balance.
5. Booking is attempted. With zero credits, the system blocks it and explains that a class package is required, directing the student to contact the studio.
6. The studio owner grants a package (Flow 6). The student's balance updates.
7. Student returns and books successfully.

*Design note:* v1 does not sell packages online. A new student's first purchase happens in person or by message, which reflects how these studios actually acquire members. The product's job is everything after that point.

### Flow 2 — Admin creates the weekly schedule

1. Admin defines rooms with capacities, and class types with durations.
2. Admin adds instructors, who receive an invitation to set a password.
3. Admin creates a session: class type, instructor, room, date, start time, capacity defaulting to room capacity.
4. The system validates that the room is free for the duration, and that the instructor is not already teaching elsewhere at that time. A conflict blocks creation with a specific message.
5. For a repeating class, the admin selects "repeat weekly for N weeks." The system generates N individual session rows.
6. Generated sessions are ordinary, independently editable rows. Editing week 5 does not affect week 6.

*Design note:* generating concrete rows rather than storing a recurrence rule is a deliberate simplification. Recurrence-rule engines are a substantial source of complexity and defects, particularly around exceptions and daylight-saving transitions, and they buy nothing the studio needs — no small studio schedules more than a few months ahead.

### Flow 3 — Booking a seat

**Preconditions:** authenticated student, session in the future, session not cancelled.

1. Student selects a session showing remaining capacity.
2. The system validates, as a single atomic operation:
   - session is in the future (BR-8)
   - session is not cancelled
   - confirmed bookings are below capacity (BR-5)
   - student has no existing booking or waitlist entry for the session (BR-6)
   - student has at least one unexpired credit (BR-4)
3. On success: a confirmed booking is created, one credit is deducted, a ledger entry is written, and confirmation is shown.
4. On failure, the specific reason is returned, and the student is offered the waitlist if the cause was capacity.

**Critical requirement:** steps 2 and 3 must be atomic. Two students requesting the final seat simultaneously must produce exactly one confirmed booking. A read-then-write implemented in application code is incorrect regardless of how fast it appears to run; the check and the insert must be serialised by the database. This is a correctness requirement, and its implementation is specified in the Technical Design document.

### Flow 4 — Joining the waitlist

1. Student selects a session at full capacity.
2. The system validates no existing booking or waitlist entry (BR-6), and that the session is in the future.
3. A waitlist entry is created with a join timestamp. **No credit is deducted** — a waitlist entry is not a booking.
4. Student sees their position, derived from join-time ordering.
5. Student may leave the waitlist at any time; remaining positions shift up automatically.

### Flow 5 — Cancellation and automatic waitlist promotion

**Part A — the student cancels**

1. Student selects an existing booking and requests cancellation.
2. The system compares the current time to the session start and determines whether the cancellation falls outside the window (BR-1).
3. The consequence is displayed **before** confirmation: either "your credit will be returned" or "this is a late cancellation and the credit will not be returned."
4. On confirmation, the booking status becomes `cancelled`, and if eligible the credit is returned with a ledger entry.

**Part B — the seat is refilled**

5. Cancellation triggers promotion evaluation.
6. If the current time is inside the promotion cutoff (BR-3), no promotion occurs and the seat simply remains open. Notifying someone ninety minutes before a 07:00 class is not a service.
7. Otherwise the system selects the earliest waitlist entry by join time.
8. If that student has insufficient credit, they are skipped, and the next is evaluated (BR-7). A student cannot be promoted into a booking they cannot pay for.
9. The selected student's waitlist entry is converted to a confirmed booking, a credit is deducted, and a ledger entry is written.
10. An in-app notification and an email are sent: they now hold a confirmed seat.
11. If no eligible waitlisted student exists, the seat remains open for general booking.

*Design note — why automatic promotion rather than a time-limited offer:* an offer model ("you have 30 minutes to claim this seat") is more polite but fills fewer seats, because it depends on the student being awake and attentive. Automatic promotion fills the seat, and the promoted student retains the normal right to cancel under the standard policy. The trade-off is disclosed to students when they join a waitlist, which resolves the fairness concern.

### Flow 6 — Admin grants a class package

1. Admin selects a student and grants a package: number of credits, expiry date, optional note recording the payment reference.
2. A ledger entry of type `grant` is written and the balance increases.
3. The student sees the new balance and the ledger entry.

*The ledger is append-only.* The balance is always the sum of the ledger, never an independently mutable number. This makes every credit movement auditable and makes "she says she paid for ten and only got five" a question with an answer.

### Flow 7 — Instructor marks attendance

1. Instructor opens their class list and selects a session that has started.
2. The roster of confirmed bookings is displayed.
3. Each student is marked present or absent. Marks are saved individually, so a lost connection does not lose the whole roster.
4. Absences are recorded as no-shows and do not return credits (BR-10).
5. After the marking window closes, unmarked bookings default to `attended` (BR-12).

### Flow 8 — Studio cancels a session

1. Admin or the assigned instructor cancels a session, with a reason.
2. The session status becomes `cancelled` and it is removed from the bookable schedule.
3. **All** confirmed bookings are refunded, regardless of the cancellation window (BR-9) — the studio's cancellation is not the student's fault.
4. All booked and waitlisted students receive an in-app notification and an email.

### Flow 9 — Admin reviews studio performance

1. Admin opens the reports view and selects a date range.
2. The system presents fill rate by class type, instructor and time slot; attendance, no-show and late-cancellation rates; waitlist conversion; and a list of students with no recent attendance.
3. The owner uses this to decide which classes to keep, move, or drop.

---

## 8. Out of Scope

The following are deliberately excluded from v1. Each is listed with the reason, because the reason is the part that demonstrates the decision was made rather than merely arrived at.

### Excluded — product scope

| Not building | Why |
|---|---|
| **Online payment / self-service package purchase** | Adds a payment provider, webhook handling, idempotency, refund logic and reconciliation — a project in itself. Small studios already collect payment in person or by bank transfer. Admin-recorded package grants capture the business outcome at a fraction of the complexity. Identified as the highest-priority v2 addition. |
| **Native mobile applications** | A responsive web application serves the phone-first usage pattern. Two native codebases and two app-store review processes deliver no additional capability here. |
| **Multi-location studios** | The data model carries a studio identifier throughout, so the schema is ready. The user interface for cross-location management is not built, because the target segment has one location. |
| **Payroll and instructor compensation** | A finance problem, not a scheduling problem, and one usually already handled by an accountant. |
| **Retail / point of sale** | Selling mats and water is unrelated to booking. |
| **Marketing automation** | Campaigns, drip sequences and promotional codes are a different product. |
| **Recurring subscription memberships (unlimited-class plans)** | v1 models a finite credit balance only. Unlimited plans require renewal cycles, proration and dunning. |
| **Public discovery marketplace** | Students arrive via the studio's own link. Building a directory would mean acquiring students, which is a different business. |
| **In-app messaging between students and studio** | WhatsApp already does this well. Competing with it would be a poor use of the remaining scope. |
| **Instructor substitution workflow** | Admin reassigns the instructor on the session directly. A request-and-accept flow is unnecessary at five instructors. |
| **Waitlist position guarantees or paid priority** | Strict FIFO. Any other ordering introduces a fairness argument the product cannot win. |

### Excluded — technical scope

| Not building | Why |
|---|---|
| **Recurrence-rule engine (RRULE)** | Materialised session rows, as described in Flow 2. |
| **SMS and push notifications** | In-app plus email covers the events that matter. SMS adds cost and per-country regulatory handling. |
| **Calendar integration (iCal / Google Calendar)** | Genuinely useful, genuinely v2. |
| **Internationalisation / multi-language UI** | Single language, single timezone in v1. Timestamps are stored in UTC so this is extensible rather than a rewrite. |
| **Offline support** | Studios have connectivity. |

---

## 9. Assumptions and Risks

| # | Assumption | Risk if wrong | Mitigation |
|---|---|---|---|
| A1 | Students will self-serve rather than expecting to message the studio | Adoption fails; owner ends up doing double work | Public schedule requires no account to view; booking is three taps |
| A2 | A studio operates in one timezone | Time display errors | All storage in UTC; timezone is a studio-level setting from day one |
| A3 | Instructors will mark attendance reliably | No-show data is unreliable, weakening G3 | Marking is fast; BR-12 default protects students from the consequences of missed marking |
| A4 | Email is delivered reliably enough for promotion notices | Promoted students miss classes they now hold seats in | In-app notification centre is the guaranteed channel; email is an enhancement, not the source of truth |
| A5 | Owners will configure their own schedule without onboarding support | High setup friction, abandonment | Weekly-repeat generation; sensible capacity defaults from room definitions |

---

## 10. Success Criteria for v1

The release is considered successful when all of the following hold:

1. A studio owner can go from empty account to a published week of classes in under thirty minutes without assistance.
2. A student can complete registration through confirmed booking in under two minutes on a phone.
3. No confirmed booking above room capacity exists under concurrent load.
4. A cancellation outside the window returns exactly one credit; a cancellation inside the window returns none.
5. A cancellation outside the promotion cutoff results in an eligible waitlisted student holding a confirmed booking and a notification, with no admin action.
6. The credit ledger balances: for every student, the sum of ledger entries equals the displayed balance.
7. No user can read or modify data belonging to another studio, or another student's personal data.

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **Session** | A single instance of a class at a specific date and time. The bookable unit. |
| **Class type** | A template (Vinyasa Flow, Reformer Pilates) from which sessions are created. |
| **Booking** | A student's confirmed seat in a session. |
| **Waitlist entry** | A student's queued claim on a seat in a full session. Consumes no credit. |
| **Promotion** | Automatic conversion of a waitlist entry into a confirmed booking when a seat opens. |
| **Credit** | One unit of prepaid class attendance. |
| **Ledger** | The append-only record of all credit movements. Authoritative source of every balance. |
| **Cancellation window** | The period before a session within which cancelling forfeits the credit (BR-1). |
| **Promotion cutoff** | The period before a session within which automatic promotion is suppressed (BR-3). |
| **No-show** | A confirmed booking marked absent. Forfeits the credit. |
| **Fill rate** | Attended seats divided by capacity. |
| **Waitlist conversion rate** | Waitlist entries that became confirmed bookings, divided by total waitlist entries. |

---

*End of document — awaiting review before proceeding to the Technical Architecture document.*
