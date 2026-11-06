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

// Uma única confirmação da sessão por requisição (antes cada layout, página e verificação de acesso chamava o Auth de novo: ~100 ms cada).
// `cache` vale só durante a renderização de UMA requisição; cada Server Action e cada rota /api confirma a sessão por conta própria.
const getRequestSession = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null } as const;
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user } as const;
});

export async function requireUserSession(next = "/") {
  const { supabase, user } = await getRequestSession();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  if (!user) redirect(`/entrar?next=${encodeURIComponent(safeRedirect(next))}`);
  return { supabase, user };
}

export async function getUserMemberships(supabase: SupabaseClient<Database>, userId: string): Promise<AgencyMembership[]> {
  const { data, error } = await supabase.from("agency_users")
    .select("agency_id, role, agencies!inner(id, name, timezone)")
    .eq("user_id", userId);
  if (error) throw new Error("Não foi possível consultar seus espaços de trabalho. Confira a migração e a conexão com o banco.");
  return (data ?? []).map((membership) => ({ agency: membership.agencies, role: membership.role }));
}

/** Espaços do usuário, lidos uma vez por requisição (o layout, a página e a verificação de acesso do cliente precisam da mesma lista). */
export const getRequestMemberships = cache(async (userId: string): Promise<AgencyMembership[]> => {
  const { supabase } = await getRequestSession();
  if (!supabase) return [];
  return getUserMemberships(supabase, userId);
});

// Cached per request: the dashboard layout and page both need the context.
export const requireAgencyContext = cache(async function requireAgencyContext() {
  const { supabase, user } = await requireUserSession();
  const memberships = await getRequestMemberships(user.id);
  if (memberships.length === 0) redirect("/sem-acesso");
  const selectedId = (await cookies()).get(AGENCY_COOKIE)?.value;
  // A cookie only chooses among memberships re-read under the authenticated user's RLS.
  const selected = memberships.find(({ agency }) => agency.id === selectedId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!selected) redirect("/selecionar-espaco");
  return { supabase, user, agency: selected.agency, role: selected.role, memberships };
});

