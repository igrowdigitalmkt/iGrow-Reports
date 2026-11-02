import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { appSecretsFromEnv } from "@/modules/lead-pages/graph-proof";
import { captureInstagramLeads } from "@/modules/lead-pages/ig-capture";
import { parseInstagramMessages } from "@/modules/lead-pages/ig-rules";
import { notifyNewLead } from "@/modules/lead-pages/alerts-send";
import { runAfter } from "@/modules/lead-pages/run-after";
import { validWebhookSignature } from "@/modules/whatsapp/webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

const verifyToken = () => process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN?.trim() || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || undefined;

// A Meta confirma o endereço uma vez, com um GET que traz o token de verificação (o mesmo dos leads).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = verifyToken();
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// Mensagens diretas recebidas pelas contas do Instagram conectadas. Assinatura conferida primeiro; falha temporária devolve 503 para a Meta repetir.
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!appSecretsFromEnv().some(secret => validWebhookSignature(raw, signature, secret))) return new Response("Invalid signature", { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  const messages = parseInstagramMessages(payload);
  if (!messages.length) return new Response("OK", { status: 200 });
  const service = createSupabaseServiceClient();
  if (!service) return new Response("Retry", { status: 503 });
  const result = await captureInstagramLeads(service, messages);
  if (result.created.length) runAfter(async () => { for (const id of result.created) await notifyNewLead(service, id).catch(() => undefined); });
  return new Response(result.retry ? "Retry" : "OK", { status: result.retry ? 503 : 200 });
}
