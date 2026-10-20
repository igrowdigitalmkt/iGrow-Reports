import "server-only";

import { notFound } from "next/navigation";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Autorização da gestão de Campanhas de UM cliente, no servidor: identificador válido, cliente DA ORGANIZAÇÃO da sessão e permissão da
 * área. Cliente inexistente, de outra organização ou sem acesso responde 404 (a mesma resposta, sem revelar a diferença) e nunca
 * cai em outro cliente. `allowed: false` indica só a falta de permissão da área (a página mostra o aviso).
 */
export async function authorizeCampaignsClient(clientId: string) {
  if (!UUID.test(clientId)) notFound();
  const context = await requireAgencyContext();
  const { data: client, error } = await context.supabase.from("clients").select("id,name,archived_at").eq("id", clientId).eq("agency_id", context.agency.id).maybeSingle();
  if (error) throw new Error("Não foi possível consultar o cliente.");
  if (!client) notFound();
  // Permissão granular de Campanhas exige migration (a lista de módulos é restrita no banco); por ora vale a de Clientes.
  const modules = context.role === "owner" || context.role === "admin" ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  return { context, client, allowed: canOpenSection(context.role, modules, "campanhas"), preferenceKey: `${context.agency.id}:${context.user.id}` };
}
