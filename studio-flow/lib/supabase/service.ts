/**
 * lib/supabase/service.ts
 *
 * SERVICE ROLE client. Trust level: RLS COMPLETELY BYPASSED.
 *
 * ============================ READ THIS ============================
 * Holding this key is equivalent to unrestricted database access across
 * EVERY studio. It defeats every policy in migration 005.
 *
 * Rules, enforced mechanically rather than by convention:
 *
 *   1. This module may be imported ONLY by app/api/cron/**. Enforced by the
 *      ESLint `no-restricted-imports` rule in .eslintrc.json — a violation
 *      fails the build, not the review.
 *
 *   2. The key is NEVER prefixed NEXT_PUBLIC_, so it cannot be inlined into
 *      the client bundle. Test PR-58 runs `next build` and greps
 *      .next/static for its value; any occurrence fails CI.
 *
 *   3. It is never logged and never placed in an error payload.
 * ===================================================================
 */

import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database.types';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Deliberately does not echo the values.
    throw new Error('Service client is not configured.');
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
