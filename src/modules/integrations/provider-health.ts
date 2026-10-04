export type ProviderHealthState = "unknown" | "healthy" | "degraded" | "blocked";
export type ProviderHealthEvent = { ok: boolean; errorCode?: string; latencyMs?: number };
export type ProviderHealth = { status: ProviderHealthState; consecutiveFailures: number; lastErrorCode: string | null; averageLatencyMs: number | null };

export function applyProviderHealthEvent(previous: ProviderHealth, event: ProviderHealthEvent): ProviderHealth {
  const latency = event.latencyMs == null ? previous.averageLatencyMs : previous.averageLatencyMs == null ? event.latencyMs : Math.round((previous.averageLatencyMs * 4 + event.latencyMs) / 5);
  if (event.ok) return { status: "healthy", consecutiveFailures: 0, lastErrorCode: null, averageLatencyMs: latency };
  const failures = previous.consecutiveFailures + 1;
  return { status: failures >= 5 ? "blocked" : "degraded", consecutiveFailures: failures, lastErrorCode: event.errorCode ?? "unknown", averageLatencyMs: latency };
}
