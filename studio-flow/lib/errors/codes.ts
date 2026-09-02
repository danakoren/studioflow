/**
 * lib/errors/codes.ts
 *
 * The complete error vocabulary of the application.
 *
 * These codes are the ONLY thing that crosses the boundary to the client.
 * Postgres SQLSTATE values, constraint names, SQL fragments and stack traces
 * never do — constraint names describe columns and business rules, which maps
 * the schema for an attacker (Basic Security §4.4).
 */

export const ERROR_CODES = [
  // Authentication / authorisation
  'NOT_AUTHENTICATED',
  'FORBIDDEN',
  'NOT_A_MEMBER',
  'PASSWORD_ROTATION_REQUIRED',
  // Deliberately the ONLY sign-in failure code. Supabase distinguishes
  // "wrong password" from "no such user" from "email not confirmed"; every
  // one of them maps here, because a distinct message confirms which
  // addresses are registered (Basic Security §1.5, user enumeration).
  'INVALID_CREDENTIALS',

  // Input
  'VALIDATION_FAILED',

  // Sessions
  'SESSION_NOT_FOUND',
  'SESSION_CANCELLED',
  'SESSION_STARTED',
  'SESSION_FULL',
  'SESSION_NOT_FULL',
  'ROOM_CONFLICT',
  'INSTRUCTOR_CONFLICT',
  'CAPACITY_BELOW_BOOKED',

  // Bookings
  'BOOKING_NOT_FOUND',
  'ALREADY_BOOKED',
  'ALREADY_WAITLISTED',
  'ALREADY_CANCELLED',
  'ALREADY_LEFT',
  'ENTRY_NOT_FOUND',

  // Credits
  'INSUFFICIENT_CREDITS',
  'MEMBER_NOT_FOUND',

  // Members
  // Only ever returned to an ADMIN creating an account. It deliberately says
  // more than the old public sign-up would have: an anonymous visitor could
  // have used a definite answer to enumerate accounts, whereas front-desk staff
  // need to tell a returning client from a mistyped address.
  'EMAIL_ALREADY_REGISTERED',

  // Attendance
  'ATTENDANCE_WINDOW_CLOSED',

  // Catalogue
  'CLASS_TYPE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'DUPLICATE_NAME',
  'IN_USE',

  // Generic
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
  );
}
