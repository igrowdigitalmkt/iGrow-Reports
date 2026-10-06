import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { sendReportByWhatsApp, WhatsAppSetupError } from "@/modules/whatsapp/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PDF_BYTES = 4 * 1024 * 1024;

// Receives the report PDF generated in the browser and sends it to the chosen recipients.
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const form = await request.formData().catch(() => null);
  const parsed = z.object({
    clientId: z.uuid(), reportVersionId: z.uuid(), recipientIds: z.array(z.uuid()).min(1).max(50),
    period: z.string().trim().min(4).max(80), filename: z.string().trim().min(5).max(120).regex(/\.pdf$/i),
  }).safeParse({
    clientId: form?.get("clientId"), reportVersionId: form?.get("reportVersionId"), recipientIds: form?.getAll("recipientIds"),
    period: form?.get("period"), filename: form?.get("filename"),
  });
  const file = form?.get("file");
  if (!parsed.success || !(file instanceof Blob)) return Response.json({ error: "Envio inválido." }, { status: 400, headers });
  if (file.size === 0 || file.size > MAX_PDF_BYTES) return Response.json({ error: "O PDF do relatório precisa ter até 4 MB." }, { status: 400, headers });
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.agencyMode || !context.workspaceRole || context.workspaceRole === "viewer") {
    return Response.json({ error: "Seu perfil não pode enviar relatórios." }, { status: 403, headers });
  }
  try {
    const results = await sendReportByWhatsApp({
      agencyId: context.access.agencyId, clientId: parsed.data.clientId, reportVersionId: parsed.data.reportVersionId,
      recipientIds: parsed.data.recipientIds, actorId: context.user.id, pdf: file, filename: parsed.data.filename,
      clientName: context.access.client.name, period: parsed.data.period,
    });
    return Response.json({ results }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof WhatsAppSetupError ? error.message : "Não foi possível enviar pelo WhatsApp agora." }, { status: 502, headers });
  }
}
