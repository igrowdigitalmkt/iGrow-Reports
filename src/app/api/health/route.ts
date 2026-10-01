import { getEncryptionConfig, getMetaApiConfig, getPrivilegedSupabaseConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const privileged = getPrivilegedSupabaseConfig();
  const encryption = getEncryptionConfig();
  const meta = getMetaApiConfig();
  let database = false;

  if (privileged) {
    try {
      const service = createSupabaseServiceClient();
      if (service) {
        const [metrics, reports] = await Promise.all([
          service.from("metric_definitions").select("key").limit(1),
          service.from("report_versions").select("id").limit(1),
        ]);
        database = !metrics.error && !reports.error;
      }
    } catch {
      database = false;
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
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
