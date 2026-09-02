/**
 * lib/validation/studio.schema.ts
 *
 * Ranges mirror the CHECK constraints in migration 002 exactly. Where they
 * disagree, the database wins — but a mismatch would surface as an opaque
 * 23514 instead of a helpful field error, so they are kept in step.
 */

import { z } from 'zod';
import { uuidSchema, hexColorSchema, noteSchema } from './common.schema';

export const updateStudioSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(3).max(64),
    cancellationWindowHours: z.coerce.number().int().min(0).max(168),
    promotionCutoffHours: z.coerce.number().int().min(0).max(48),
    attendanceWindowHours: z.coerce.number().int().min(1).max(168),
    unmarkedAttendanceDefault: z.enum(['attended', 'absent']),
  })
  .strict()
  .refine(
    (value) => value.promotionCutoffHours <= value.cancellationWindowHours,
    {
      message:
        'The promotion cutoff should not exceed the cancellation window.',
      path: ['promotionCutoffHours'],
    },
  );

export const createRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    capacity: z.coerce.number().int().min(1).max(200),
  })
  .strict();

export const updateRoomSchema = createRoomSchema
  .extend({ roomId: uuidSchema, isActive: z.boolean().optional() })
  .strict();

export const createClassTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: noteSchema.optional(),
    durationMinutes: z.coerce.number().int().min(15).max(240),
    color: hexColorSchema.default('#6366f1'),
  })
  .strict();

export const updateClassTypeSchema = createClassTypeSchema
  .extend({ classTypeId: uuidSchema, isActive: z.boolean().optional() })
  .strict();

export const markNotificationReadSchema = z
  .object({ notificationId: uuidSchema })
  .strict();

/**
 * Takes no input — the recipient is auth.uid() and the scope is "everything
 * still unread". Still .strict(), so a caller who invents a `recipientId` to
 * clear someone else's alerts is REJECTED at stage 2 rather than having the
 * field quietly dropped. An empty schema is not a pointless one.
 */
export const markAllNotificationsReadSchema = z.object({}).strict();

export type UpdateStudioSettingsInput = z.infer<
  typeof updateStudioSettingsSchema
>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type CreateClassTypeInput = z.infer<typeof createClassTypeSchema>;
