import { getEncryptionConfig, getMetaApiConfig, getPrivilegedSupabaseConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const privileged = getPrivilegedSupabaseConfig();
  const encryption = getEncryptionConfig();
  const meta = getMetaApiConfig();
  let database = false;
  let databaseChecks = { metrics: "not_checked", reports: "not_checked" };

  if (privileged) {
    try {
      const service = createSupabaseServiceClient();
      if (service) {
        const [metrics, reports] = await Promise.all([
          service.from("metric_definitions").select("key").limit(1),
          service.from("report_versions").select("id").limit(1),
        ]);
        databaseChecks = {
          metrics: metrics.error?.code ?? "ok",
          reports: reports.error?.code ?? "ok",
        };
        database = !metrics.error && !reports.error;
      }
    } catch {
      database = false;
      databaseChecks = { metrics: "exception", reports: "exception" };
    }
  }

  const checks = {
    application: true,
    privilegedSupabase: !!privileged,
    database,
    encryption: !!encryption,
    metaApi: !!meta,
  };
  const ready = Object.values(checks).every(Boolean);

  return Response.json(
    {
      status: ready ? "ok" : "degraded",
      service: "igrow-reports",
      version: "0.1.0",
      checks,
      databaseChecks: ready ? undefined : databaseChecks,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
