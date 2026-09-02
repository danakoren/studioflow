/**
 * actions/studio.actions.ts
 *
 * Studio policy and catalogue management (rooms, class types). Admin-only.
 *
 * Policy values live in the studios table rather than in code, so changing a
 * cancellation window is a data change, not a deployment. The Postgres
 * functions read the studio's own values at execution time.
 */

'use server';

import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/auth/action';
import { fail, ok, type ActionResult } from '@/lib/types/actions.types';
import { mapPostgresError, logServerError } from '@/lib/errors/map';
import type { RoomRow, ClassTypeRow } from '@/lib/types/database.types';
import {
  updateStudioSettingsSchema,
  createRoomSchema,
  updateRoomSchema,
  createClassTypeSchema,
  updateClassTypeSchema,
  type UpdateStudioSettingsInput,
  type CreateRoomInput,
  type CreateClassTypeInput,
} from '@/lib/validation/studio.schema';

/**
 * Update the studio's business rules.
 *
 * The studio id comes from the ACTOR'S MEMBERSHIP, never from the request.
 * Accepting a studioId parameter here would let an admin of Studio B name
 * Studio A in the payload — RLS would still refuse, but the action would be
 * relying on the database to catch a mistake it should not have made.
 */
export async function updateStudioSettings(
  input: UpdateStudioSettingsInput,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateStudioSettingsSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { error } = await supabase
        .from('studios')
        .update({
          name: value.name,
          timezone: value.timezone,
          cancellation_window_hours: value.cancellationWindowHours,
          promotion_cutoff_hours: value.promotionCutoffHours,
          attendance_window_hours: value.attendanceWindowHours,
          unmarked_attendance_default: value.unmarkedAttendanceDefault,
        })
        .eq('id', context.membership.studioId);

      if (error) {
        logServerError('updateStudioSettings', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/settings', '/schedule'],
  });
}

export async function createRoom(
  input: CreateRoomInput,
): Promise<ActionResult<{ roomId: string }>> {
  return runAction(input, {
    schema: createRoomSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          studio_id: context.membership.studioId,
          name: value.name,
          capacity: value.capacity,
        })
        .select('id')
        .single();

      if (error) {
        logServerError('createRoom', error);
        return fail(mapPostgresError(error));
      }
      return ok({ roomId: data.id });
    },
    revalidate: () => ['/admin/rooms', '/admin/schedule'],
  });
}

/**
 * Update a room.
 *
 * Changing capacity does NOT resize existing sessions: each session copied its
 * capacity at creation. A session already holding twelve bookings cannot
 * silently become a ten-mat room and drop two students.
 */
export async function updateRoom(
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateRoomSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const patch: Partial<RoomRow> = {
        name: value.name,
        capacity: value.capacity,
      };
      if (value.isActive !== undefined) patch.is_active = value.isActive;

      const { error } = await supabase
        .from('rooms')
        .update(patch)
        .eq('id', value.roomId)
        .eq('studio_id', context.membership.studioId);

      if (error) {
        logServerError('updateRoom', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/rooms', '/admin/schedule'],
  });
}

export async function createClassType(
  input: CreateClassTypeInput,
): Promise<ActionResult<{ classTypeId: string }>> {
  return runAction(input, {
    schema: createClassTypeSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('class_types')
        .insert({
          studio_id: context.membership.studioId,
          name: value.name,
          description: value.description ?? null,
          duration_minutes: value.durationMinutes,
          color: value.color,
        })
        .select('id')
        .single();

      if (error) {
        logServerError('createClassType', error);
        return fail(mapPostgresError(error));
      }
      return ok({ classTypeId: data.id });
    },
    revalidate: () => ['/admin/class-types', '/admin/schedule', '/schedule'],
  });
}

export async function updateClassType(
  input: unknown,
): Promise<ActionResult<null>> {
  return runAction(input, {
    schema: updateClassTypeSchema,
    roles: ['admin'],
    handler: async ({ input: value, context }) => {
      const supabase = await createClient();
      const patch: Partial<ClassTypeRow> = {
        name: value.name,
        description: value.description ?? null,
        duration_minutes: value.durationMinutes,
        color: value.color,
      };
      if (value.isActive !== undefined) patch.is_active = value.isActive;

      const { error } = await supabase
        .from('class_types')
        .update(patch)
        .eq('id', value.classTypeId)
        .eq('studio_id', context.membership.studioId);

      if (error) {
        logServerError('updateClassType', error);
        return fail(mapPostgresError(error));
      }
      return ok(null);
    },
    revalidate: () => ['/admin/class-types', '/admin/schedule', '/schedule'],
  });
}
