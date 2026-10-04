import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
import { enqueueCollectionJob, finishCollectionJob, persistCollectionResult } from "@/modules/integrations/repository";
import { collectionIdempotencyKey } from "@/modules/integrations/data-contract";

const result = { metrics: [], complete: true, reconciliation: {}, rawPayloads: [{ endpoint: "insights", payload: { rows: [] }, httpStatus: 200 }] };

describe("collection result persistence", () => {
  it("queues the same client and versions used in the idempotency identity", async () => {
    const identity = { clientId: "client-a", connectionId: "connection-a", provider: "meta" as const, externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign" as const, apiVersion: "v24.0", contractVersion: 11 };
    const table = { upsert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { id: "job" }, error: null })) };
    const service = { from: vi.fn(() => table) } as unknown as SupabaseClient<Database>;
    await enqueueCollectionJob(service, identity, 25);
    expect(table.upsert).toHaveBeenCalledWith(expect.objectContaining({ client_id: identity.clientId, api_version: identity.apiVersion, contract_version: identity.contractVersion, priority: 25, idempotency_key: collectionIdempotencyKey(identity) }), { onConflict: "idempotency_key", ignoreDuplicates: true });
  });
  it("sends the claim attempt to the atomic result RPC without direct table writes", async () => {
    const rpc = vi.fn(async () => ({ data: "snapshot", error: null }));
    const from = vi.fn();
    const service = { rpc, from } as unknown as SupabaseClient<Database>;
    expect(await persistCollectionResult(service, "job", 2, result, "confirmed")).toBe("snapshot");
    expect(rpc).toHaveBeenCalledWith("persist_integration_collection_result", {
      p_job_id: "job", p_attempt_count: 2, p_status: "confirmed", p_metrics: [], p_reconciliation: {}, p_raw_payloads: result.rawPayloads,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates rejected stale result writes", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Tentativa expirada" } }));
    await expect(persistCollectionResult({ rpc } as unknown as SupabaseClient<Database>, "job", 1, result, "confirmed")).rejects.toThrow("Tentativa expirada");
  });

  it("fences finalization by attempt and sets completion time only for confirmed transitions", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const service = { rpc } as unknown as SupabaseClient<Database>;
    await finishCollectionJob(service, "job", 2, { status: "confirmed" });
    expect(rpc).toHaveBeenLastCalledWith("finish_integration_collection_job", expect.objectContaining({ p_attempt_count: 2, p_completed_at: expect.any(String) }));
    await finishCollectionJob(service, "job", 2, { status: "partial" });
    expect(rpc).toHaveBeenLastCalledWith("finish_integration_collection_job", expect.objectContaining({ p_attempt_count: 2, p_completed_at: null }));
  });
});
