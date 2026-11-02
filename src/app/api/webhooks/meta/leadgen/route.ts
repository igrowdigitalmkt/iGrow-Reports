import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getMetaApiConfig } from "@/lib/env";
import { fetchLead, parseLeadgenEvents, processLeadgenEvents } from "@/modules/lead-pages/leads";
import { findLeadPages, saveLead } from "@/modules/lead-pages/store";
import { validWebhookSignature } from "@/modules/whatsapp/webhook";

export const runtime = "nodejs";

const appSecret = () => process.env.META_APP_SECRET?.trim() || process.env.WHATSAPP_APP_SECRET?.trim() || undefined;
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
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"), appSecret())) return new Response("Invalid signature", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  const events = parseLeadgenEvents(payload);
  if (!events.length) return new Response("OK", { status: 200 });

  const service = createSupabaseServiceClient();
  const token = process.env.META_LEADS_ACCESS_TOKEN?.trim();
  const config = getMetaApiConfig();
  if (!service || !token || !config) {
    console.error("leadgen: configuração incompleta", { banco: !!service, tokenDeLeads: !!token, versaoDaApi: !!config });
    return new Response("Retry", { status: 503 });
  }
  const result = await processLeadgenEvents(events, {
    findPages: (pageId, formId) => findLeadPages(service, pageId, formId),
    fetchLead: leadgenId => fetchLead({ leadgenId, token, apiVersion: config.apiVersion, appSecret: appSecret() }),
    save: (page, lead, fields) => saveLead(service, page, lead, fields),
  });
  return new Response(result.retry ? "Retry" : "OK", { status: result.retry ? 503 : 200 });
}
