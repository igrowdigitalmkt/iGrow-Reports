import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { runDailyMetaRefresh } from "@/modules/meta/daily-refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron (vercel.json) calls this once a day with Authorization: Bearer CRON_SECRET.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Agendamento indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  const executionId = randomUUID();
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Agendamento indisponível." }, { status: 503, headers });
  try {
    // Leave room for the request in flight when the budget ends.
    const result = await runDailyMetaRefresh(service, { budgetMs: 240_000 });
    console.info("meta-daily-refresh", { executionId, ...result });
    return Response.json({ executionId, ...result }, { headers });
  } catch {
    console.error("meta-daily-refresh-failed", { executionId });
    return Response.json({ executionId, error: "Não foi possível concluir a atualização diária." }, { status: 500, headers });
  }
}
