import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getMetaApiConfig } from "@/lib/env";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { subscribePageToLeadgen } from "@/modules/lead-pages/connect";
import { appSecretsFromEnv } from "@/modules/lead-pages/graph-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Inscreve a Página do Facebook da página de leads no app (evento `leadgen`). Só proprietário ou administrador da organização dona
 * da página, logado. É idempotente (repetir não causa efeito além do já inscrito) e nunca devolve tokens.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return Response.json({ ok: false, message: "Apenas proprietários e administradores podem conectar a Página." }, { status: 403, headers });
  const service = createSupabaseServiceClient();
  const token = process.env.META_LEADS_ACCESS_TOKEN?.trim();
  const config = getMetaApiConfig();
  if (!service || !token || !config) return Response.json({ ok: false, message: "Falta configurar META_LEADS_ACCESS_TOKEN ou a versão da API da Meta neste ambiente." }, { status: 503, headers });
  const { data: page } = await service.from("lead_pages").select("fb_page_id,active").eq("slug", slug).eq("agency_id", context.agency.id).maybeSingle();
  if (!page || !page.active || !page.fb_page_id) return Response.json({ ok: false, message: "Página de leads não encontrada nesta organização." }, { status: 404, headers });
  const result = await subscribePageToLeadgen({ pageId: page.fb_page_id, token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() });
  return Response.json(result.ok
    ? { ok: true, pageId: page.fb_page_id, subscribed: result.subscribed, message: "Página inscrita no app para receber leads (leadgen)." }
    : { ok: false, pageId: page.fb_page_id, step: result.step, metaStatus: result.status, metaCode: result.code, message: result.message },
  { status: result.ok ? 200 : 502, headers });
}
