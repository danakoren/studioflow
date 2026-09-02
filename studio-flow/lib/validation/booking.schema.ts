/**
 * lib/validation/booking.schema.ts
 *
 * NOTE WHAT IS ABSENT: none of these schemas contains a studentId.
 *
 * A Server Action compiles to a POST endpoint whose identifier is present in
 * the client bundle — anyone can invoke it directly with any arguments. An
 * action that accepted `studentId` would be an authorisation bypass with extra
 * steps: the caller would simply pass someone else's id. The acting user is
 * always derived from getUser() (Basic Security §3.5).
 */

import { z } from 'zod';
import { uuidSchema } from './common.schema';

export const bookSessionSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export const cancelBookingSchema = z
  .object({ bookingId: uuidSchema })
  .strict();

export const joinWaitlistSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export const leaveWaitlistSchema = z
  .object({ entryId: uuidSchema })
  .strict();

export const markAttendanceSchema = z
  .object({
    bookingId: uuidSchema,
    status: z.enum(['attended', 'absent']),
  })
  .strict();

export const markAllPresentSchema = z
  .object({ sessionId: uuidSchema })
  .strict();

export type BookSessionInput = z.infer<typeof bookSessionSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
export type LeaveWaitlistInput = z.infer<typeof leaveWaitlistSchema>;
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
