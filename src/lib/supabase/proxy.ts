import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { AUTH_COOKIE } from "./constants";

/** onSession roda no mesmo cliente, depois da renovação da sessão: se devolver uma resposta, ela substitui a padrão (mantendo os cookies renovados). */
export async function updateSession(request: NextRequest, onSession?: (supabase: SupabaseClient<Database>, request: NextRequest) => Promise<NextResponse | null>) {
  const config = getSupabaseConfig();
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!config) return response;

  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookieOptions: {
      name: AUTH_COOKIE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });

  // Verify the JWT while refreshing both request and response cookies. Authorization
  // stays in each server operation and in PostgreSQL RLS, never only in this proxy.
  await supabase.auth.getClaims();
  const override = onSession ? await onSession(supabase, request) : null;
  if (override) {
    response.cookies.getAll().forEach((cookie) => override.cookies.set(cookie));
    override.headers.set("Cache-Control", "private, no-store");
    return override;
  }
  return response;
}

