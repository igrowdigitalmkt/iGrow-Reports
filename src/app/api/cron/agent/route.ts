import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { agentSchedulerEnabled, runAgentScheduler } from "@/modules/agent-executor/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Passe do agente de campanhas. Autenticado por CRON_SECRET; desligado ate AGENT_SCHEDULER_ENABLED=true. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") {
    return Response.json({ error: "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  }
  if (!agentSchedulerEnabled()) return Response.json({ enabled: false }, { headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Servico indisponivel." }, { status: 503, headers });
  try {
    const report = await runAgentScheduler(service);
    return Response.json(report, { headers });
  } catch {
    // Sem detalhes: nenhum dado de cliente ou credencial na resposta.
    return Response.json({ error: "Falha no passe do agente." }, { status: 500, headers });
  }
}
