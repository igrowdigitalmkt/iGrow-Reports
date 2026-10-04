import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
import { finishCollectionJob, persistCollectionResult } from "@/modules/integrations/repository";

function setup(jobError: unknown = null) {
  const job = { client_id: "client-a", provider: "google", external_account_id: "account-a", date_from: "2026-10-01", date_to: "2026-10-03", entity_level: "campaign" };
  const jobTable = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: jobError ? null : job, error: jobError })), update: vi.fn() };
  const rawTable = { insert: vi.fn(async () => ({ error: null })) };
  const snapshotTable = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: { id: "snapshot" }, error: null })) };
  const rpc = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => ({ integration_collection_jobs: jobTable, integration_raw_payloads: rawTable, integration_snapshots: snapshotTable })[table]);
  return { service: { from, rpc } as unknown as SupabaseClient<Database>, jobTable, rawTable, snapshotTable, rpc, job };
}

const result = { metrics: [], complete: true, reconciliation: {}, rawPayloads: [{ endpoint: "insights", payload: { rows: [] }, httpStatus: 200 }] };

describe("collection result persistence", () => {
  it("inherits provider and client scope from the stored job without finalizing it", async () => {
    const { service, rawTable, snapshotTable, jobTable, job } = setup();
    await persistCollectionResult(service, "job", result, "confirmed");
    expect(rawTable.insert).toHaveBeenCalledWith([expect.objectContaining({ job_id: "job", provider: "google" })]);
    expect(snapshotTable.insert).toHaveBeenCalledWith(expect.objectContaining({ ...job, job_id: "job", status: "confirmed" }));
    expect(jobTable.update).not.toHaveBeenCalled();
  });

  it("does not write payloads when the job cannot be read", async () => {
    const { service, rawTable, snapshotTable } = setup({ message: "missing" });
    await expect(persistCollectionResult(service, "missing", result, "confirmed")).rejects.toThrow("Job de coleta não encontrado");
    expect(rawTable.insert).not.toHaveBeenCalled();
    expect(snapshotTable.insert).not.toHaveBeenCalled();
  });

  it("sets completion time only for confirmed transitions", async () => {
    const { service, rpc } = setup();
    await finishCollectionJob(service, "job", { status: "confirmed" });
    expect(rpc).toHaveBeenLastCalledWith("finish_integration_collection_job", expect.objectContaining({ p_completed_at: expect.any(String) }));
    await finishCollectionJob(service, "job", { status: "partial" });
    expect(rpc).toHaveBeenLastCalledWith("finish_integration_collection_job", expect.objectContaining({ p_completed_at: null }));
  });
});
