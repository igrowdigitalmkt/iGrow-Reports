import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { validWebhookToken } from "@/modules/whatsapp-qr/server";
import { LEAD_INSTANCE } from "@/modules/lead-pages/wa-session";

export const runtime = "nodejs";
export const maxDuration = 30;

// Avisos da sessão de captação de leads por WhatsApp (um número por cliente, separado da caixa da agência).
// Etapa 3a: só confere a assinatura e registra que a sessão está viva; a criação de leads entra na etapa seguinte.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { instance?: unknown; event?: unknown } | null;
  const instance = body?.instance;
  const match = typeof instance === "string" ? LEAD_INSTANCE.exec(instance) : null;
  if (!match || typeof instance !== "string") return Response.json({ error: "Acesso negado." }, { status: 401 });
  if (!validWebhookToken(instance, request.headers.get("x-igrow-token"))) return Response.json({ error: "Acesso negado." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const { data: session } = await service.from("lead_whatsapp_sessions").select("id,active").eq("id", match[1]).maybeSingle();
  if (!session || !session.active) return Response.json({ ok: true, ignored: "no_session" });
  const event = String(body?.event ?? "");
  if (/^(messages[._]upsert|connection[._]update)$/i.test(event)) {
    const { error } = await service.from("lead_whatsapp_sessions").update({ last_event_at: new Date().toISOString() }).eq("id", session.id);
    if (error) return Response.json({ error: "Tente de novo." }, { status: 503 });
  }
  return Response.json({ ok: true });
}
