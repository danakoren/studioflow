/**
 * lib/supabase/server.ts
 *
 * SERVER client. Trust level: RLS ENFORCED, acting as the requesting user.
 *
 * This is the default client for everything: Server Components, Server
 * Actions, Route Handlers with a user session. Every query it issues is
 * filtered by Row Level Security, which is why application code contains no
 * ownership filters — the common `WHERE user_id = ?` that a developer forgets
 * cannot become a data leak here.
 *
 * Cookies are httpOnly, so an XSS payload cannot read the session token
 * (Basic Security §1.2).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/database.types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. This is expected and
            // harmless: middleware refreshes the session on every request, so
            // the token is kept current there instead.
          }
        },
      },
    },
  );
}
