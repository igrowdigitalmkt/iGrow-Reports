import { META_ANALYTICS_VERSION } from "@/modules/meta/analytics-contract";

export function confirmedReportConfiguration(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const configuration = input as Record<string, unknown>;
  const analytics = configuration.analytics;
  if (!analytics || typeof analytics !== "object" || Array.isArray(analytics)) return false;
  const aggregate = (analytics as Record<string, unknown>).metaAggregate;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) return false;
  const provenance = aggregate as Record<string, unknown>;
  return typeof configuration.snapshot_version === "number" && configuration.snapshot_version >= 5
    && provenance.confirmed === true && provenance.version === META_ANALYTICS_VERSION;
}
