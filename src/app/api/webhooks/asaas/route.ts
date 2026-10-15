import { after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getAsaasConfig, getAsaasWebhookToken } from "@/modules/billing/config";
import { asBillingDb, callRpc } from "@/modules/billing/db";
import { drainBillingEvents } from "@/modules/billing/event-processor";
import { createBillingRuntime } from "@/modules/billing/server";
import { MAX_WEBHOOK_BYTES, parseAsaasEvent, validateWebhookToken } from "@/modules/billing/webhook";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

// Receber → autenticar → validar → PERSISTIR → responder → processar de forma recuperável.
// HTTP 200 só depois de o evento estar gravado (ou já conhecido): se não der para gravar, o Asaas tenta de novo.
// O estado financeiro nunca vem do corpo do evento: o processador lê o pagamento/assinatura na API do Asaas.
export async function POST(request: Request) {
  const expected = getAsaasWebhookToken();
  if (!expected || !getAsaasConfig()) return Response.json({ error: "Indisponível." }, { status: 503, headers }); // inerte até ser configurado
  if (validateWebhookToken(request.headers.get("asaas-access-token"), expected) !== "ok") return Response.json({ error: "Não autorizado." }, { status: 401, headers });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return Response.json({ error: "Conteúdo grande demais." }, { status: 413, headers });
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return Response.json({ error: "Conteúdo grande demais." }, { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Requisição inválida." }, { status: 400, headers }); }
  const event = parseAsaasEvent(body);
  if (!event) return Response.json({ error: "Evento inválido." }, { status: 400, headers });

  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503, headers });
  let recorded: { id: number; duplicate: boolean };
  try {
    recorded = await callRpc(asBillingDb(service), "billing_record_event", {
      p_environment: "sandbox", p_event_id: event.eventId, p_event_type: event.eventType, p_resource_type: event.resourceType, p_resource_id: event.resourceId, p_payload: event.payload,
    });
  } catch {
    console.error("asaas-webhook-persist-failed");
    return Response.json({ error: "Tente novamente." }, { status: 503, headers }); // não confirma o que não foi gravado
  }
  if (!recorded.duplicate) {
    // Aceleração: tenta processar já, e aproveita para retomar eventos antigos que ficaram pendentes (os mais antigos primeiro).
    // Se esta função for interrompida, o evento continua gravado e a rotina periódica (/api/cron/billing) o retoma.
    after(async () => {
      const deps = createBillingRuntime();
      if (!deps) return;
      try { await drainBillingEvents(deps, { limit: 5 }); } catch { console.error("asaas-webhook-inline-failed"); }
    });
  }
  return Response.json({ received: true, duplicate: recorded.duplicate }, { headers });
}
