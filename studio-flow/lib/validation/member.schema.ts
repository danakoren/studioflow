/**
 * lib/validation/member.schema.ts
 */

import { z } from 'zod';
import {
  uuidSchema,
  emailSchema,
  passwordSchema,
  fullNameSchema,
  phoneSchema,
} from './common.schema';

export const createStudentSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

/**
 * Sign-in deliberately validates NEITHER field's format.
 *
 * On sign-in the email is a LOOKUP KEY for an account that already exists, not
 * new data being admitted to the system. Applying createStudentSchema's strict
 * emailSchema here would lock out accounts whose addresses the current rules
 * would refuse but which authenticate perfectly well — every seeded test
 * account (`student1.a@test` has no dotted domain and fails `.email()`), and
 * any account created through the Admin API.
 *
 * This is the same reasoning the password field below already followed: it uses
 * min(1) rather than passwordSchema, so a credential predating the 10-character
 * rule can still get its owner in. A format check on either field here would
 * reject legitimate users while stopping no attacker — Supabase Auth decides
 * whether the pair is valid, not a regex.
 *
 * trim() and toLowerCase() are kept: they are NORMALISATION, needed because
 * Supabase stores addresses lowercased, so " Noa@Example.com " must still match.
 * Registration keeps the strict emailSchema, which is where a real, deliverable
 * address actually matters.
 */
export const signInSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, { message: 'Enter your email address.' })
      .max(255),
    password: z.string().min(1, { message: 'Enter your password.' }),
  })
  .strict();

/**
 * NOTE: no `role` field. An admin creating an instructor cannot choose the
 * role from the client — the action hard-codes 'instructor'. A role accepted
 * from a payload is a privilege-escalation vector.
 */
export const createInstructorSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema.nullable().optional(),
  })
  .strict();

export const setMemberActiveSchema = z
  .object({
    memberId: uuidSchema,
    isActive: z.boolean(),
  })
  .strict();

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type CreateInstructorInput = z.infer<typeof createInstructorSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
