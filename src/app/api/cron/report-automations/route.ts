import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { runDueAutomations } from "@/modules/automations/runner";
import { createQrSender } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Called every few minutes with Authorization: Bearer CRON_SECRET (the WhatsApp server's
// scheduler; Vercel Hobby cron runs only once a day). Sends the scheduled messages that are due.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Agendamento indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Agendamento indisponível." }, { status: 503, headers });
  try {
    const summary = await runDueAutomations(service, {
      // Only the agency's own number connected by QR Code sends free text; without it runs are recorded as not sent.
      resolveSender: agencyId => createQrSender(agencyId).catch(() => null),
      appUrl: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? null,
    });
    console.info("report-automations", summary);
    return Response.json(summary, { headers });
  } catch {
    console.error("report-automations-failed");
    return Response.json({ error: "Não foi possível executar os agendamentos." }, { status: 500, headers });
  }
}
