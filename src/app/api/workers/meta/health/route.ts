import { getEncryptionConfig, getMetaApiConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";

export const runtime = "nodejs";

// Read-only operational check: never claim a job or call the Meta API.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.INTEGRATION_WORKER_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Executor indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  try {
    const checks = { meta: Boolean(getMetaApiConfig()), encryption: Boolean(getEncryptionConfig()), database: false };
    const service = createSupabaseServiceClient();
    if (service) {
      const results = await Promise.all([
        service.from("integration_collection_jobs").select("id,retry_epoch_attempt,attempt_count").limit(0),
        service.from("integration_raw_payloads").select("id").limit(0),
        service.from("integration_snapshots").select("id").limit(0),
        service.from("integration_provider_health").select("id").limit(0),
      ]);
      checks.database = results.every(result => !result.error);
    }
    const ready = Object.values(checks).every(Boolean);
    return Response.json({ ready, checks }, { status: ready ? 200 : 503, headers });
  } catch {
    return Response.json({ ready: false, error: "Não foi possível verificar o executor." }, { status: 503, headers });
  }
}
