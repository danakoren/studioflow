/**
 * lib/supabase/client.ts
 *
 * BROWSER client. Trust level: RLS ENFORCED.
 *
 * Used for authentication calls only (sign in, sign up, sign out, password
 * change). All data access happens on the server through Server Components
 * and Server Actions.
 *
 * The anon key here is public by design and is embedded in the client bundle.
 * It grants NOTHING on its own, because every table denies access absent a
 * matching policy — but that safety is CONDITIONAL on RLS being enabled
 * everywhere, which is why assert_rls_coverage() runs in CI
 * (Basic Security §5.3).
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
