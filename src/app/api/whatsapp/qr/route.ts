import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { disconnectQr, getQrStatus, startQrConnection } from "@/modules/whatsapp-qr/server";

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
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return Response.json({ error: "Apenas proprietários e administradores podem conectar o WhatsApp." }, { status: 403, headers });
  try {
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
