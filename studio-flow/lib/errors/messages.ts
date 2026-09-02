/**
 * lib/errors/messages.ts
 *
 * Error code -> user-facing text.
 *
 * Two of these carry PRODUCT INTENT rather than merely reporting a fault, and
 * that is deliberate (Detailed Technical Design §7.2):
 *
 *   SESSION_FULL          offers the waitlist, turning a dead end into the
 *                         mechanism behind business goal G1.
 *   INSUFFICIENT_CREDITS  prompts repurchase, which is the sales mechanism
 *                         described in G4.
 *
 * An error message is a place where the product either recovers a user or
 * loses one.
 */

import type { ErrorCode } from './codes';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NOT_AUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_A_MEMBER: 'You are not a member of this studio.',
  PASSWORD_ROTATION_REQUIRED:
    'Please set a new password before continuing.',
  // Says nothing about WHICH half was wrong, and nothing about whether the
  // address exists. See the note in codes.ts.
  INVALID_CREDENTIALS: 'Invalid email or password.',

  VALIDATION_FAILED: 'Please check the highlighted fields and try again.',

  SESSION_NOT_FOUND: 'This class is no longer available.',
  SESSION_CANCELLED: 'This class has been cancelled.',
  SESSION_STARTED: 'This class has already started.',
  SESSION_FULL: 'This class is full — join the waitlist?',
  SESSION_NOT_FULL: 'This class still has space — you can book it directly.',
  ROOM_CONFLICT: 'That room is already booked at this time.',
  INSTRUCTOR_CONFLICT: 'That instructor is already teaching then.',
  // Names the number, because the admin's next action is to decide which
  // bookings to remove — and they cannot decide that from "invalid input".
  CAPACITY_BELOW_BOOKED:
    'That capacity is lower than the number of students already booked in. Remove some bookings first.',

  BOOKING_NOT_FOUND: 'Booking not found.',
  ALREADY_BOOKED: "You're already booked into this class.",
  ALREADY_WAITLISTED: "You're already on the waitlist for this class.",
  ALREADY_CANCELLED: 'This booking was already cancelled.',
  ALREADY_LEFT: 'You have already left this waitlist.',
  ENTRY_NOT_FOUND: 'Waitlist entry not found.',

  INSUFFICIENT_CREDITS:
    'You have no classes left. Contact the studio to buy a package.',
  MEMBER_NOT_FOUND: 'That person is not an active member of this studio.',
  EMAIL_ALREADY_REGISTERED:
    'An account with that email already exists. If they are already a member, find them in the student list instead.',

  ATTENDANCE_WINDOW_CLOSED: 'Attendance can no longer be changed for this class.',

  CLASS_TYPE_NOT_FOUND: 'That class type could not be found.',
  ROOM_NOT_FOUND: 'That room could not be found.',
  DUPLICATE_NAME: 'Something with that name already exists.',
  IN_USE: 'This is still in use and cannot be removed.',

  NOT_FOUND: 'Not found.',
  CONFLICT: 'That conflicts with something else. Please review and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
