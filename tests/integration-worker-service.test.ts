import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/integrations/repository", () => ({
  authorizeCollectionJob: vi.fn(), claimCollectionJob: vi.fn(), finishCollectionJob: vi.fn(), persistCollectionResult: vi.fn(), recordProviderHealth: vi.fn(),
}));
import { authorizeCollectionJob, claimCollectionJob, finishCollectionJob, persistCollectionResult, recordProviderHealth } from "@/modules/integrations/repository";
import { runOneIntegrationJob } from "@/modules/integrations/worker-service";

const service = {} as SupabaseClient<Database>;
const result = { metrics: [], complete: true, reconciliation: { confirmed: false }, rawPayloads: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeCollectionJob).mockResolvedValue("integration-a");
  vi.mocked(claimCollectionJob).mockResolvedValue({ job_id: "job-a", client_id: "client-a", connection_id: "connection-a", idempotency_key: "key", provider: "meta", external_account_id: "act_1", date_from: "2026-10-01", date_to: "2026-10-03", entity_level: "campaign", attempt_count: 1, api_version: "v24.0", contract_version: 11 });
});

describe("claimed job worker", () => {
  it("uses the fresh-cycle retry budget while fencing writes with the lifetime attempt",async () => {
    const job = (await vi.mocked(claimCollectionJob).getMockImplementation()!(service))!;
    vi.mocked(claimCollectionJob).mockResolvedValue({ ...job,attempt_count: 9,retry_attempt_count: 1 });
    await runOneIntegrationJob(service,{ meta: { provider: "meta",collect: vi.fn().mockRejectedValue(new Error("HTTP 503 unavailable")) } });
    expect(finishCollectionJob).toHaveBeenCalledWith(service,"job-a",9,expect.objectContaining({ status: "partial" }));
  });
  it("keeps unreconciled snapshots partial and finalizes through the transition RPC", async () => {
    const collect = vi.fn(async () => result);
    expect(await runOneIntegrationJob(service, { meta: { provider: "meta", collect } })).toBe(true);
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-a", connectionId: "connection-a", provider: "meta", apiVersion: "v24.0", contractVersion: 11 }));
    expect(persistCollectionResult).toHaveBeenCalledWith(service, "job-a", 1, result, "partial");
    expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 1, expect.objectContaining({ status: "partial" }));
    expect(authorizeCollectionJob).toHaveBeenCalledWith(service, "job-a", 1);
    expect(recordProviderHealth).toHaveBeenCalledWith(service, "integration-a", "meta", expect.objectContaining({ ok: true }));
  });

  it("does not collect or record provider health after scope authorization is revoked", async () => {
    vi.mocked(authorizeCollectionJob).mockResolvedValue(null);
    const collect = vi.fn(async () => result);
    await runOneIntegrationJob(service, { meta: { provider: "meta", collect } });
    expect(collect).not.toHaveBeenCalled();
    expect(persistCollectionResult).not.toHaveBeenCalled();
    expect(recordProviderHealth).not.toHaveBeenCalled();
    expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 1, expect.objectContaining({ status: "failed", errorCode: "collection_scope_invalid" }));
  });

  it("propagates validation outages without marking the scope invalid", async () => {
    vi.mocked(authorizeCollectionJob).mockRejectedValue(new Error("validation unavailable"));
    const collect = vi.fn(async () => result);
    await expect(runOneIntegrationJob(service, { meta: { provider: "meta", collect } })).rejects.toThrow("validation unavailable");
    expect(collect).not.toHaveBeenCalled();
    expect(finishCollectionJob).not.toHaveBeenCalled();
  });

  it("rejects an adapter registered under another provider before collecting", async () => {
    const collect = vi.fn(async () => result);
    await runOneIntegrationJob(service, { meta: { provider: "google", collect } });
    expect(collect).not.toHaveBeenCalled();
    expect(persistCollectionResult).not.toHaveBeenCalled();
    expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 1, expect.objectContaining({ status: "failed", errorCode: "provider_not_registered" }));
  });
});
