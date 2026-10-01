import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPrivilegedSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

export function createSupabaseServiceClient() {
  const config = getPrivilegedSupabaseConfig();
  if (!config) return null;

  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "igrow-reports-server",
      },
    },
  });
}
