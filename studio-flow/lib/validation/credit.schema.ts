/**
 * lib/validation/credit.schema.ts
 */

import { z } from 'zod';
import {
  uuidSchema,
  noteSchema,
  optionalFutureDatetimeSchema,
} from './common.schema';

export const grantCreditsSchema = z
  .object({
    studentId: uuidSchema,
    credits: z.coerce
      .number()
      .int({ message: 'Credits must be a whole number.' })
      .min(1, { message: 'Grant at least 1 credit.' })
      .max(500, { message: 'Grant at most 500 credits.' }),
    expiresAt: optionalFutureDatetimeSchema,
    note: noteSchema.optional(),
  })
  .strict();

/**
 * A negative grant must go through adjustCredits, which REQUIRES a reason.
 * Any manual movement of value must carry an explanation, because the ledger
 * is append-only and the note is the only record of intent.
 */
export const adjustCreditsSchema = z
  .object({
    studentId: uuidSchema,
    delta: z.coerce
      .number()
      .int()
      .min(-500)
      .max(500)
      .refine((value) => value !== 0, { message: 'Adjustment cannot be zero.' }),
    reason: z
      .string()
      .trim()
      .min(3, { message: 'A reason is required for any manual adjustment.' })
      .max(500),
  })
  .strict();

export type GrantCreditsInput = z.infer<typeof grantCreditsSchema>;
export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>;
