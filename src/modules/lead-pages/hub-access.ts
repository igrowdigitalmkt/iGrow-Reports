import "server-only";

import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { hashAccessCode } from "./leads";
import type { Service } from "./hub-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Quem está olhando os leads e o que pode fazer. Todo acesso (sessão ou link) vira este objeto, e só ele autoriza leitura e escrita. */
export type LeadsAccess = {
  service: Service; agencyId: string; clientId: string; clientName: string; via: "workspace" | "portal" | "link";
  /** Criar fontes e links, conectar a Página (proprietário e administrador da organização). */
  canManage: boolean;
  /** Mudar status e escrever notas. */
  canUpdate: boolean;
  /** null = todos os formulários; senão só estes (link com escopo). */
  restrictFormIds: string[] | null;
  actor: string; userId: string | null; linkId: string | null;
  /** Cliente de banco da sessão (só em acesso por login): lê o investimento do período sob as permissões da pessoa. */
  supabase?: SupabaseClient<Database>;
};

const displayName = (user: { email?: string | null; user_metadata?: Record<string, unknown> }) => {
  const meta = user.user_metadata?.full_name;
  return (typeof meta === "string" && meta.trim()) || user.email?.split("@")[0] || "Usuário";
};

/**
 * Acesso por sessão (equipe da organização ou cliente do portal) ao menu Leads de UM cliente. `allowed: false` = a equipe não tem a
 * área liberada (Equipe › Permissões); cliente de outra organização ou inexistente cai no 404/redirecionamento de requireClientDashboardAccess.
 */
export async function authorizeLeadsClient(clientId: string): Promise<(LeadsAccess & { allowed: true }) | { allowed: false }> {
  if (!UUID.test(clientId)) notFound();
  const context = await requireClientDashboardAccess(clientId);
  const service = createSupabaseServiceClient();
  if (!service) throw new Error("Serviço indisponível neste ambiente.");
  const agencyMode = context.agencyMode;
  if (agencyMode && context.workspaceRole && context.workspaceRole !== "owner" && context.workspaceRole !== "admin") {
    const modules = await loadOwnModules(context.supabase, context.access.agencyId, context.user.id);
    if (!canOpenSection(context.workspaceRole, modules, "clientes")) return { allowed: false };
  }
  const role = context.workspaceRole;
  return {
    allowed: true, service, agencyId: context.access.agencyId, clientId, clientName: context.access.client.name, via: agencyMode ? "workspace" : "portal",
    canManage: agencyMode && (role === "owner" || role === "admin"), canUpdate: agencyMode ? role !== "viewer" : true, restrictFormIds: null,
    actor: displayName(context.user), userId: context.user.id, linkId: null, supabase: context.supabase,
  };
}

/** Acesso pelo link compartilhado (sem login). O código vira hash e é procurado direto; link revogado ou inexistente: null. */
export async function authorizeLeadsLink(code: string | null | undefined, options: { touch?: boolean } = {}): Promise<LeadsAccess | null> {
  if (!code || code.length < 16 || code.length > 128) return null;
  const service = createSupabaseServiceClient();
  if (!service) return null;
  const { data: link } = await service.from("lead_share_links").select("id,agency_id,client_id,name,form_ids,can_update,active,last_opened_at").eq("access_hash", hashAccessCode(code)).maybeSingle();
  if (!link || !link.active) return null;
  const { data: client } = await service.from("clients").select("name,archived_at").eq("id", link.client_id).maybeSingle();
  if (!client) return null;
  // Registro de "última abertura" no máximo a cada 10 minutos, para não escrever a cada atualização da tela.
  if (options.touch && (!link.last_opened_at || Date.now() - new Date(link.last_opened_at).getTime() > 10 * 60_000)) {
    await service.from("lead_share_links").update({ last_opened_at: new Date().toISOString() }).eq("id", link.id);
  }
  return {
    service, agencyId: link.agency_id, clientId: link.client_id, clientName: client.name, via: "link", canManage: false, canUpdate: link.can_update,
    restrictFormIds: link.form_ids && link.form_ids.length ? link.form_ids : null, actor: `Link: ${link.name}`, userId: null, linkId: link.id,
  };
}
