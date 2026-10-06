import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { runDueAutomations } from "@/modules/automations/runner";

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
      // The QR Code connection (own number) is the only channel that sends free text; until it exists runs are recorded as not sent.
      resolveSender: async () => null,
      appUrl: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? null,
    });
    console.info("report-automations", summary);
    return Response.json(summary, { headers });
  } catch {
    console.error("report-automations-failed");
    return Response.json({ error: "Não foi possível executar os agendamentos." }, { status: 500, headers });
  }
}
