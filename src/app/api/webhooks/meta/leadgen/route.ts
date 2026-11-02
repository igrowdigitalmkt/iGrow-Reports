import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getMetaApiConfig } from "@/lib/env";
import { fetchLead, parseLeadgenEvents, processLeadgenEvents } from "@/modules/lead-pages/leads";
import { findLeadPages, saveLead } from "@/modules/lead-pages/store";
import { notifyNewLead } from "@/modules/lead-pages/alerts-send";
import { appSecretsFromEnv } from "@/modules/lead-pages/graph-proof";
import { runAfter } from "@/modules/lead-pages/run-after";
import { leadsTokenCandidates } from "@/modules/lead-pages/leads-tokens";
import { validWebhookSignature } from "@/modules/whatsapp/webhook";

export const runtime = "nodejs";

const verifyToken = () => process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN?.trim() || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;

// A Meta confirma o endereço uma vez, com um GET que traz o token de verificação.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = verifyToken();
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// Leads novos da Meta (Lead Ads). Assinatura conferida primeiro; falha temporária devolve 503 para a Meta repetir o aviso mais tarde.
export async function POST(request: Request) {
  const raw = await request.text();
  // O aviso é assinado com o segredo do app que o enviou (WhatsApp e Meta podem ser apps diferentes): vale qualquer segredo configurado.
  const signature = request.headers.get("x-hub-signature-256");
  if (!appSecretsFromEnv().some(secret => validWebhookSignature(raw, signature, secret))) return new Response("Invalid signature", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  const events = parseLeadgenEvents(payload);
  if (!events.length) return new Response("OK", { status: 200 });

  const service = createSupabaseServiceClient();
  const config = getMetaApiConfig();
  const tokens = service ? await leadsTokenCandidates(service) : [];
  if (!service || !tokens.length || !config) {
    console.error("leadgen: configuração incompleta", { banco: !!service, tokenDeLeads: tokens.length > 0, versaoDaApi: !!config });
    return new Response("Retry", { status: 503 });
  }
  const created: string[] = [];
  const result = await processLeadgenEvents(events, {
    findPages: (pageId, formId) => findLeadPages(service, pageId, formId),
    fetchLead: async leadgenId => {
      let failure: unknown = new Error("sem credencial");
      for (const token of tokens) {
        try { return await fetchLead({ leadgenId, token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() }); } catch (error) { failure = error; }
      }
      throw failure;
    },
    save: async (page, lead, fields) => { const id = await saveLead(service, page, lead, fields); if (id) created.push(id); },
  });
  // Alertas de lead novo (WhatsApp): depois de responder à Meta, para não atrasar o aviso.
  if (created.length) runAfter(async () => { for (const id of created) await notifyNewLead(service, id).catch(() => undefined); });
  return new Response(result.retry ? "Retry" : "OK", { status: result.retry ? 503 : 200 });
}
