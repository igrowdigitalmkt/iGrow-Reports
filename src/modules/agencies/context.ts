import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/modules/auth/redirect";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgencyRole, Database } from "@/types/database";

export const AGENCY_COOKIE = "igrow-agency";

export type AgencyMembership = {
  agency: { id: string; name: string; timezone: string };
  role: AgencyRole;
};

export async function requireUserSession(next = "/dashboard") {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(`/entrar?next=${encodeURIComponent(safeRedirect(next))}`);
  return { supabase, user };
}

export async function getUserMemberships(supabase: SupabaseClient<Database>, userId: string): Promise<AgencyMembership[]> {
  const { data, error } = await supabase.from("agency_users")
    .select("agency_id, role, agencies!inner(id, name, timezone)")
    .eq("user_id", userId);
  if (error) throw new Error("Não foi possível consultar seus espaços de trabalho. Confira a migração e a conexão com o banco.");
  return (data ?? []).map((membership) => ({ agency: membership.agencies, role: membership.role }));
}

// Cached per request: the dashboard layout and page both need the context.
export const requireAgencyContext = cache(async function requireAgencyContext() {
  const { supabase, user } = await requireUserSession();
  const memberships = await getUserMemberships(supabase, user.id);
  if (memberships.length === 0) redirect("/sem-acesso");
  const selectedId = (await cookies()).get(AGENCY_COOKIE)?.value;
  // A cookie only chooses among memberships re-read under the authenticated user's RLS.
  const selected = memberships.find(({ agency }) => agency.id === selectedId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!selected) redirect("/selecionar-espaco");
  return { supabase, user, agency: selected.agency, role: selected.role, memberships };
});

