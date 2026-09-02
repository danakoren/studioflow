/**
 * lib/validation/session.schema.ts
 *
 * Every object is .strict(): unknown keys are REJECTED, not stripped.
 *
 * This is the mass-assignment defence. A client adding `capacity: 999` or
 * `studio_id: '<other studio>'` to a payload must fail loudly rather than have
 * the field silently ignored — silence hides an attack in progress
 * (Basic Security §4.2).
 */

import { z } from 'zod';
import { uuidSchema, futureDatetimeSchema, noteSchema } from './common.schema';

const sessionCoreSchema = z.object({
  classTypeId: uuidSchema,
  roomId: uuidSchema,
  instructorId: uuidSchema,
  startsAt: futureDatetimeSchema,
  /** Optional override; defaults to the room's capacity when omitted. */
  capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
});

export const createSessionSchema = sessionCoreSchema.strict();

export const createRecurringSessionsSchema = sessionCoreSchema
  .extend({
    // Bounded to keep the transaction small; mirrors the DB guard exactly
    // (Detailed Technical Design §4.5).
    weeks: z.coerce.number().int().min(1).max(12),
  })
  .strict();

export const updateSessionSchema = z
  .object({
    sessionId: uuidSchema,
    classTypeId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    instructorId: uuidSchema.optional(),
    startsAt: futureDatetimeSchema.optional(),
    capacity: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    { message: 'Nothing to update.' },
  );

export const cancelSessionSchema = z
  .object({
    sessionId: uuidSchema,
    reason: noteSchema.min(3, { message: 'Please give a reason.' }),
  })
  .strict();

export const adminBookStudentSchema = z
  .object({
    sessionId: uuidSchema,
    // Legitimate here: the ACTOR is the admin from getUser(); the SUBJECT is
    // someone else by design. Authorisation is on the actor, never the
    // subject.
    studentId: uuidSchema,
  })
  .strict();

export const adminRemoveBookingSchema = z
  .object({
    bookingId: uuidSchema,
    // Explicit, because the admin is making a judgement the system cannot:
    // a student who phoned in sick versus one who simply did not appear.
    refund: z.boolean(),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type CreateRecurringSessionsInput = z.infer<
  typeof createRecurringSessionsSchema
>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;
