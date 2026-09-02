/**
 * lib/validation/common.schema.ts
 *
 * Shared primitives. Every schema in this directory is imported by BOTH the
 * client form (via zodResolver) and the Server Action.
 *
 * The client-side parse is UX ONLY and is not trusted. A request forged with
 * curl and a valid session cookie skips it entirely, which is exactly why the
 * SAME schema is re-executed server-side. One definition, validated twice,
 * cannot drift (Basic Security §4.1).
 */

import { z } from 'zod';

export const uuidSchema = z.string().uuid({ message: 'Invalid identifier.' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Enter a valid email address.' })
  .max(255);

/**
 * Minimum 10 characters. Length outperforms composition rules, and Supabase's
 * leaked-password check (HaveIBeenPwned) handles the rest server-side.
 */
export const passwordSchema = z
  .string()
  .min(10, { message: 'Password must be at least 10 characters.' })
  .max(72, { message: 'Password must be at most 72 characters.' });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Name must be at least 2 characters.' })
  .max(100, { message: 'Name must be at most 100 characters.' });

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(30)
  .regex(/^[+0-9()\-\s]+$/, { message: 'Enter a valid phone number.' });

export const noteSchema = z.string().trim().max(500);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Enter a colour like #6366f1.' });

/** An ISO instant that must be in the future. Mirrors the DB CHECK. */
export const futureDatetimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid date and time.' })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: 'This must be in the future.',
  });

export const optionalFutureDatetimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: 'Expiry must be in the future.',
  })
  .nullable()
  .optional();

/** Keyset pagination cursor (Basic Scaling §4.3). */
export const cursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: uuidSchema,
  })
  .strict()
  .nullable()
  .optional();

export const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(25);

/**
 * Turns a Zod failure into the fieldErrors shape the forms render inline.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const flattened = error.flatten();
  const result: Record<string, string[]> = {};

  for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
    if (messages && messages.length > 0) result[key] = messages;
  }
  if (flattened.formErrors.length > 0) {
    result._form = flattened.formErrors;
  }
  return result;
}
