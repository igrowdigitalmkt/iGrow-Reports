import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isOptOutText, OPT_OUT_REPLY, parseIncomingMessage, parseMessageReceipt } from "@/modules/whatsapp-qr/opt-out";
import { replyFromInstance, validWebhookToken } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const INSTANCE = /^igrow-([0-9a-f-]{36})$/;

// Messages received by the agency's own number (Evolution API). Only "PARAR"-like replies matter:
// the sender stops receiving automatic reports from that agency. Message text is never stored.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const instance = (body as { instance?: unknown } | null)?.instance;
  if (typeof instance !== "string" || !INSTANCE.test(instance) || !validWebhookToken(instance, request.headers.get("x-igrow-token"))) {
    return Response.json({ error: "Acesso negado." }, { status: 401 });
  }
  const receipt = parseMessageReceipt(body);
  if (receipt) {
    const service = createSupabaseServiceClient();
    if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
    const agencyId = INSTANCE.exec(instance)![1];
    const at = new Date().toISOString();
    // Statuses only move forward: sent → delivered → read. A read also implies delivered.
    await service.from("automation_messages").update({ delivered_at: at }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).is("delivered_at", null);
    if (receipt.status === "read") await service.from("automation_messages").update({ status: "read", read_at: at }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).in("status", ["sent", "delivered"]);
    else await service.from("automation_messages").update({ status: "delivered" }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).eq("status", "sent");
    return Response.json({ ok: true });
  }
  const message = parseIncomingMessage(body);
  if (!message || !isOptOutText(message.text)) return Response.json({ ok: true });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const agencyId = INSTANCE.exec(instance)![1];
  const { data: count, error } = await service.rpc("service_recipient_opt_out", {
    p_agency_id: agencyId, p_phone: message.phone, p_source: "Resposta de descadastro no WhatsApp",
  });
  if (error) {
    console.error("evolution-opt-out-failed", { code: error.code });
    return Response.json({ error: "Falha ao registrar." }, { status: 500 });
  }
  if (count && count > 0) await replyFromInstance(instance, message.phone, OPT_OUT_REPLY);
  return Response.json({ ok: true, revoked: count ?? 0 });
}
