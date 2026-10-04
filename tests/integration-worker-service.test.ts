import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/integrations/repository", () => ({
  claimCollectionJob: vi.fn(), finishCollectionJob: vi.fn(), persistCollectionResult: vi.fn(), recordProviderHealth: vi.fn(),
}));
import { claimCollectionJob, finishCollectionJob, persistCollectionResult } from "@/modules/integrations/repository";
import { runOneIntegrationJob } from "@/modules/integrations/worker-service";

const service = {} as SupabaseClient<Database>;
const result = { metrics: [], complete: true, reconciliation: { confirmed: false }, rawPayloads: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimCollectionJob).mockResolvedValue({ job_id: "job-a", client_id: "client-a", connection_id: "connection-a", idempotency_key: "key", provider: "meta", external_account_id: "act_1", date_from: "2026-10-01", date_to: "2026-10-03", entity_level: "campaign", attempt_count: 1, api_version: "v24.0", contract_version: 11 });
});

describe("claimed job worker", () => {
  it("keeps unreconciled snapshots partial and finalizes through the transition RPC", async () => {
    const collect = vi.fn(async () => result);
    expect(await runOneIntegrationJob(service, { meta: { provider: "meta", collect } })).toBe(true);
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-a", connectionId: "connection-a", provider: "meta", apiVersion: "v24.0", contractVersion: 11 }));
    expect(persistCollectionResult).toHaveBeenCalledWith(service, "job-a", 1, result, "partial");
    expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 1, expect.objectContaining({ status: "partial" }));
  });

  it("rejects an adapter registered under another provider before collecting", async () => {
    const collect = vi.fn(async () => result);
    await runOneIntegrationJob(service, { meta: { provider: "google", collect } });
    expect(collect).not.toHaveBeenCalled();
    expect(persistCollectionResult).not.toHaveBeenCalled();
    expect(finishCollectionJob).toHaveBeenCalledWith(service, "job-a", 1, expect.objectContaining({ status: "failed", errorCode: "provider_not_registered" }));
  });
});
