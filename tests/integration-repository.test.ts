import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));
import { authorizeCollectionJob, enqueueCollectionJob, enqueueCollectionJobs, finishCollectionJob, persistCollectionResult,requestMetaCollectionRefresh,claimCollectionJob } from "@/modules/integrations/repository";
import { collectionIdempotencyKey } from "@/modules/integrations/data-contract";

const result = { metrics: [], complete: true, reconciliation: {}, rawPayloads: [{ endpoint: "insights", payload: { rows: [] }, httpStatus: 200 }] };

describe("collection result persistence", () => {
  it("claims Meta work through its provider-specific RPC",async () => {
    const rpc = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null,error: null }) }));
    await claimCollectionJob({ rpc } as unknown as SupabaseClient<Database>,new Date("2026-10-04T12:00:00Z"),"meta");
    expect(rpc).toHaveBeenCalledWith("claim_meta_collection_job",{ p_now: "2026-10-04T12:00:00.000Z" });
  });
  it("requests refresh with one exact scope and validates reported totals",async () => {
    const identity = { clientId: "c",connectionId: "i",provider: "meta" as const,externalAccountId: "act_1",dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "account" as const,apiVersion: "v24.0",contractVersion: 3 };
    const rpc = vi.fn().mockResolvedValue({ data: { created: 0,rescheduled: 1,preserved: 0 },error: null });
    const service = { rpc } as unknown as SupabaseClient<Database>;
    expect(await requestMetaCollectionRefresh(service,[identity])).toEqual({ created: 0,rescheduled: 1,preserved: 0 });
    expect(rpc).toHaveBeenCalledWith("request_meta_collection_refresh",expect.objectContaining({ p_client_id: "c",p_connection_id: "i",p_contract_version: 3,p_scopes: [{ externalAccountId: "act_1",level: "account" }] }));
    rpc.mockResolvedValue({ data: { created: 0,rescheduled: 0,preserved: 0 },error: null });
    await expect(requestMetaCollectionRefresh(service,[identity])).rejects.toThrow("inválida");
    await expect(requestMetaCollectionRefresh(service,[identity,{ ...identity,clientId: "other" }])).rejects.toThrow("incompatíveis");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("registers a missing-scope bundle in one idempotent statement without resetting existing jobs",async () => {
    const identity = { clientId: "c",connectionId: "i",provider: "meta" as const,externalAccountId: "act_1",dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "account" as const,apiVersion: "v24.0",contractVersion: 3 };
    const table = { upsert: vi.fn().mockReturnThis(),select: vi.fn().mockResolvedValue({ data: [{ id: "j1" },{ id: "j2" }],error: null }) };
    const service = { from: vi.fn(() => table) } as unknown as SupabaseClient<Database>;
    expect(await enqueueCollectionJobs(service,[identity,{ ...identity,level: "campaign" }])).toBe(2);
    expect(table.upsert).toHaveBeenCalledTimes(1);
    expect(table.upsert.mock.calls[0][0]).toHaveLength(2);
    expect(table.upsert.mock.calls[0][1]).toEqual({ onConflict: "idempotency_key",ignoreDuplicates: true });
    await expect(enqueueCollectionJobs(service,[identity,identity])).rejects.toThrow("duplicado");
    await expect(enqueueCollectionJobs(service,[identity,{ ...identity,clientId: "foreign" }])).rejects.toThrow("incompatíveis");
    expect(table.upsert).toHaveBeenCalledTimes(1);
  });
  it("returns the integration identified by the authorized claim", async () => {
    const rpc = vi.fn(async () => ({ data: "integration-a", error: null }));
    expect(await authorizeCollectionJob({ rpc } as unknown as SupabaseClient<Database>, "job", 2)).toBe("integration-a");
    expect(rpc).toHaveBeenCalledWith("authorize_integration_collection_job", { p_job_id: "job", p_attempt_count: 2 });
  });

  it("represents a denied scope without exposing the database message", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "private details" } }));
    expect(await authorizeCollectionJob({ rpc } as unknown as SupabaseClient<Database>, "job", 2)).toBeNull();
  });

  it.each(["40001", "503"])("propagates stale claims and outages separately from denied scope (%s)", async code => {
    const rpc = vi.fn(async () => ({ data: null, error: { code, message: "private details" } }));
    await expect(authorizeCollectionJob({ rpc } as unknown as SupabaseClient<Database>, "job", 2)).rejects.toThrow("Não foi possível validar");
  });
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
