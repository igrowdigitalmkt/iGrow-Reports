import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runOneMetaIntegrationJob } from "@/modules/meta/job-worker";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { runWorkerBatch } from "@/modules/integrations/worker-batch";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const auth = authorizeWorkerRequest(request.headers.get("authorization"),process.env.INTEGRATION_WORKER_SECRET);
  const headers = { "Cache-Control": "no-store" };
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Executor indisponível." : "Acesso negado." },{ status: auth === "unconfigured" ? 503 : 401,headers });
  const executionId = randomUUID();
  try {
    const service = createSupabaseServiceClient();
    if (!service) return Response.json({ error: "Executor indisponível." },{ status: 503,headers });
    const result = await runWorkerBatch(() => runOneMetaIntegrationJob(service),{ maxJobs: 4,budgetMs: 240_000 });
    return Response.json({ executionId,...result },{ headers });
  } catch {
    // Do not copy provider URLs, credentials or database exception details.
    console.error("integration-worker-failed",{ executionId,provider: "meta" });
    return Response.json({ executionId,error: "Não foi possível concluir a execução da fila." },{ status: 500,headers });
  }
}
