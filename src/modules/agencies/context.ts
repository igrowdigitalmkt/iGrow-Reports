import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/modules/auth/redirect";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AgencyRole, Database } from "@/types/database";

export const AGENCY_COOKIE = "igrow-agency";

export type AgencyMembership = {
  agency: { id: string; name: string; timezone: string };
  role: AgencyRole;
};

// Um cliente do Supabase por requisição.
const getRequestSupabase = cache(async () => createSupabaseServerClient());

// Uma única confirmação da sessão por requisição (antes cada layout, página e verificação de acesso chamava o Auth de novo: ~100 ms cada).
// `cache` vale só durante a renderização de UMA requisição; cada Server Action e cada rota /api confirma a sessão por conta própria.
const getRequestSession = cache(async () => {
  const supabase = await getRequestSupabase();
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

/** O que as telas de VISUALIZAÇÃO usam da pessoa (vem do crachá da sessão, sem perguntar ao serviço de login). */
export type ViewUser = Pick<User, "id" | "email" | "user_metadata" | "app_metadata">;
type SessionClaims = { sub?: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown>; amr?: Array<{ method?: string }> };

/**
 * O crachá (JWT) basta quando a pessoa já tem senha definida: o marcador `password_set` ou um login por senha. Quem entrou por link de
 * convite, código ou Google pode ainda precisar definir a senha, e essa informação só o serviço de login sabe: nesses casos a tela confirma lá.
 */
export function claimsAreEnough(claims: SessionClaims): boolean {
  if (claims.app_metadata?.password_set === true) return true;
  return Array.isArray(claims.amr) && claims.amr.some(entry => entry?.method === "password");
}

// Telas de VISUALIZAÇÃO (layouts e páginas): conferem o crachá no próprio servidor (assinatura e validade), ~100 ms mais rápido por tela.
// Quem foi bloqueado, removido ou desconectado à força continua valendo até o crachá vencer (cerca de 1 h) APENAS para ler telas: o banco
// já aceitava o mesmo crachá. Ações que alteram dados e rotas /api NÃO usam isto: elas continuam confirmando a sessão no serviço de login.
const getRequestViewSession = cache(async () => {
  const supabase = await getRequestSupabase();
  if (!supabase) return { supabase: null, user: null } as const;
  const { data, error } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as SessionClaims | null;
  if (!error && claims?.sub && claimsAreEnough(claims)) {
    const user: ViewUser = { id: claims.sub, email: claims.email, user_metadata: claims.user_metadata ?? {}, app_metadata: claims.app_metadata ?? {} };
    return { supabase, user } as const;
  }
  return getRequestSession();
});

export async function requireViewSession(next = "/") {
  const { supabase, user } = await getRequestViewSession();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  if (!user) redirect(`/entrar?next=${encodeURIComponent(safeRedirect(next))}`);
  return { supabase, user: user as ViewUser };
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
  const supabase = await getRequestSupabase();
  if (!supabase) return [];
  return getUserMemberships(supabase, userId);
});

async function agencyContextFor<U extends ViewUser>(supabase: SupabaseClient<Database>, user: U) {
  const memberships = await getRequestMemberships(user.id);
  if (memberships.length === 0) redirect("/sem-acesso");
  const selectedId = (await cookies()).get(AGENCY_COOKIE)?.value;
  // A cookie only chooses among memberships re-read under the authenticated user's RLS.
  const selected = memberships.find(({ agency }) => agency.id === selectedId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!selected) redirect("/selecionar-espaco");
  return { supabase, user, agency: selected.agency, role: selected.role, memberships };
}

// Cached per request: the dashboard layout and page both need the context. Sessão confirmada no serviço de login (ações, rotas /api, escritas).
export const requireAgencyContext = cache(async function requireAgencyContext() {
  const { supabase, user } = await requireUserSession();
  return agencyContextFor(supabase, user);
});

/** Mesmo contexto, para telas de VISUALIZAÇÃO (layouts e páginas): sessão pelo crachá, sem a ida ao serviço de login. */
export const requireAgencyViewContext = cache(async function requireAgencyViewContext() {
  const { supabase, user } = await requireViewSession();
  return agencyContextFor(supabase, user);
});
