import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { validWebhookToken } from "@/modules/whatsapp-qr/server";
import { LEAD_INSTANCE } from "@/modules/lead-pages/wa-session";
import { captureWhatsAppLead, resolveWaAdNames } from "@/modules/lead-pages/wa-capture";
import { notifyNewLead } from "@/modules/lead-pages/alerts-send";
import { runAfter } from "@/modules/lead-pages/run-after";

export const runtime = "nodejs";
export const maxDuration = 30;

// Avisos da sessão de captação de leads por WhatsApp (um número por cliente, separado da caixa da agência).
// Confere a assinatura, registra que a sessão está viva e cria o lead de contatos novos conforme as regras do cliente.
// Nada aqui grava a conversa na caixa do WhatsApp da agência.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { instance?: unknown; event?: unknown } | null;
  const instance = body?.instance;
  const match = typeof instance === "string" ? LEAD_INSTANCE.exec(instance) : null;
  if (!match || typeof instance !== "string") return Response.json({ error: "Acesso negado." }, { status: 401 });
  if (!validWebhookToken(instance, request.headers.get("x-igrow-token"))) return Response.json({ error: "Acesso negado." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const { data: session } = await service.from("lead_whatsapp_sessions").select("id,agency_id,client_id,active,qualify_mode,ignored_numbers,connected_phone").eq("id", match[1]).maybeSingle();
  if (!session || !session.active) return Response.json({ ok: true, ignored: "no_session" });
  const event = String(body?.event ?? "");
  if (/^(messages[._]upsert|connection[._]update)$/i.test(event)) {
    const { error } = await service.from("lead_whatsapp_sessions").update({ last_event_at: new Date().toISOString() }).eq("id", session.id);
    if (error) return Response.json({ error: "Tente de novo." }, { status: 503 });
    if (/^messages[._]upsert$/i.test(event)) {
      const result = await captureWhatsAppLead(service, session, body).catch(() => ({ created: null, reason: "error" as const }));
      if (result.reason === "error") return Response.json({ error: "Tente de novo." }, { status: 503 });
      const created = result.created;
      const adId = result.adId ?? null;
      // Primeiro completa o anúncio (para o aviso já sair com a campanha), depois avisa a equipe.
      if (created) runAfter(async () => { if (adId) await resolveWaAdNames(service, { agencyId: session.agency_id, leadId: created, adId }).catch(() => undefined); await notifyNewLead(service, created).catch(() => undefined); });
    }
  }
  return Response.json({ ok: true });
}
