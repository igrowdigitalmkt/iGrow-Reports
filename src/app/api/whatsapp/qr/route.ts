import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { disconnectQr, getQrStatus, resetQrSession, startQrConnection } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

// Polled by the connection screen while the QR Code is shown (route handlers run in parallel).
export async function GET() {
  const context = await requireAgencyContext();
  try {
    return Response.json(await getQrStatus(context.agency.id), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof EvolutionError ? error.message : "Não foi possível consultar o WhatsApp." }, { status: 502, headers });
  }
}

export async function POST(request: Request) {
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("qr") }),
    z.object({ action: z.literal("pair"), phone: z.string().trim().min(8).max(30) }),
    z.object({ action: z.literal("disconnect") }),
    z.object({ action: z.literal("reset") }),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return Response.json({ error: "Apenas proprietários e administradores podem conectar o WhatsApp." }, { status: 403, headers });
  try {
    if (parsed.data.action === "reset") {
      const service = createSupabaseServiceClient();
      if (!service) return Response.json({ error: "Banco indisponível." }, { status: 503, headers });
      // Block incoming webhooks before requesting logout and removing the device.
      const { error: beginError } = await service.rpc("begin_whatsapp_qr_reset", { p_agency_id: context.agency.id });
      if (beginError) return Response.json({ error: "Proteção da limpeza indisponível." }, { status: 503, headers });
      await resetQrSession(context.agency.id);
      let removed = 0;
      const start = performance.now();
      // Small transactional batches avoid overwhelming the Supabase Free instance.
      for (let i = 0; i < 30 && performance.now() - start < 22_000; i++) {
        const { data, error } = await service.rpc("clear_whatsapp_qr_history_batch", {
          p_agency_id: context.agency.id, p_batch_size: 40,
        });
        if (error || typeof data !== "number" || data < 0 || data > 40) {
          return Response.json({ error: "Limpeza interrompida. Tente novamente para concluir.", removed }, { status: 503, headers });
        }
        removed += data;
        if (data < 40) return Response.json({ success: true, removed }, { headers });
      }
      return Response.json({ error: "Limpeza parcial. Tente novamente para concluir.", removed }, { status: 503, headers });
    }
    if (parsed.data.action === "disconnect") {
      await disconnectQr(context.agency.id);
      return Response.json({ success: true }, { headers });
    }
    const result = await startQrConnection(context.agency.id, parsed.data.action === "pair" ? parsed.data.phone : undefined);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof EvolutionError ? error.message : "Não foi possível falar com o WhatsApp agora." }, { status: 502, headers });
  }
}
