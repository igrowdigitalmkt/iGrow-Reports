import { getEncryptionConfig, getMetaApiConfig, getPrivilegedSupabaseConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const privileged = getPrivilegedSupabaseConfig();
  const encryption = getEncryptionConfig();
  const meta = getMetaApiConfig();
  const rawPrivilegedKey = (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  ).trim();
  const supabaseUrlValid = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").protocol === "https:";
    } catch {
      return false;
    }
  })();
  const privilegedKeyKind = classifyPrivilegedKey(rawPrivilegedKey);
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
      configurationChecks: ready
        ? undefined
        : {
            supabaseUrl: supabaseUrlValid ? "valid" : "invalid",
            privilegedKey: privilegedKeyKind,
          },
      databaseChecks: ready ? undefined : databaseChecks,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function classifyPrivilegedKey(value: string) {
  if (!value) return "missing";
  if (value.startsWith("sb_secret_")) return "sb_secret";
  if (value.startsWith("sb_publishable_")) return "publishable";
  if (value.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(
        Buffer.from(value.split(".")[1], "base64url").toString("utf8"),
      ) as { role?: string };
      return payload.role === "service_role" ? "legacy_service_role" : "jwt_other";
    } catch {
      return "jwt_invalid";
    }
  }
  return "other";
}
