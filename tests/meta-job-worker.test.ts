import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/integrations/repository", () => ({
  authorizeCollectionJob: vi.fn(), claimCollectionJob: vi.fn(), finishCollectionJob: vi.fn(), persistCollectionResult: vi.fn(), recordProviderHealth: vi.fn(),
}));
vi.mock("@/modules/meta/server", () => ({ loadMetaWorkerContext: vi.fn() }));
import { authorizeCollectionJob, claimCollectionJob, finishCollectionJob, persistCollectionResult, recordProviderHealth } from "@/modules/integrations/repository";
import { loadMetaWorkerContext } from "@/modules/meta/server";
import { runOneMetaIntegrationJob } from "@/modules/meta/job-worker";

it("connects an authorized claim to the Meta adapter and attempt-fenced persistence", async () => {
  const service = {} as SupabaseClient<Database>;
  vi.mocked(claimCollectionJob).mockResolvedValue({ job_id: "job-a", client_id: "client-a", connection_id: "connection-a", provider: "meta", external_account_id: "act_123", date_from: "2026-10-01", date_to: "2026-10-03", entity_level: "campaign", attempt_count: 2, api_version: "v24.0", contract_version: 1, idempotency_key: "key" });
  vi.mocked(authorizeCollectionJob).mockResolvedValue("integration-a");
  const getPeriodInsights = vi.fn(async () => [{ account_id: "123", campaign_id: "456", date_start: "2026-10-01", date_stop: "2026-10-03", spend: "100.25" }]);
  vi.mocked(loadMetaWorkerContext).mockResolvedValue({ client: { getPeriodInsights } as unknown as Awaited<ReturnType<typeof loadMetaWorkerContext>>["client"], currency: "BRL", timezone: "America/Sao_Paulo" });
  expect(await runOneMetaIntegrationJob(service)).toBe(true);
  expect(loadMetaWorkerContext).toHaveBeenCalledWith(service, expect.objectContaining({ clientId: "client-a", connectionId: "connection-a", apiVersion: "v24.0", contractVersion: 1 }));
  expect(vi.mocked(authorizeCollectionJob).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(loadMetaWorkerContext).mock.invocationCallOrder[0]);
  expect(persistCollectionResult).toHaveBeenCalledWith(service, "job-a", 2, expect.objectContaining({ complete: true, metrics: expect.arrayContaining([expect.objectContaining({ nativeKey: "spend", value: "100.25" })]) }), "confirmed");
  expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 2, { status: "confirmed", nextAttemptAt: null });
  expect(recordProviderHealth).toHaveBeenCalledWith(service, "integration-a", "meta", expect.objectContaining({ ok: true }));
});
