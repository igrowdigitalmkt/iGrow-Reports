import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), meta: vi.fn(), encryption: vi.fn(), from: vi.fn(), limit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/lib/env", () => ({ getMetaApiConfig: mocks.meta, getEncryptionConfig: mocks.encryption }));
import { GET } from "@/app/api/workers/meta/health/route";
const secret = "s".repeat(48);
const request = (authorized = true) => new Request("https://app.test/api/workers/meta/health", { headers: authorized ? { authorization: `Bearer ${secret}` } : {} });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("INTEGRATION_WORKER_SECRET", secret);
  mocks.meta.mockReturnValue({ apiVersion: "v24.0" }); mocks.encryption.mockReturnValue({ key: secret });
  mocks.limit.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ select: vi.fn(() => ({ limit: mocks.limit })) });
  mocks.service.mockReturnValue({ from: mocks.from });
});
afterEach(() => vi.unstubAllEnvs());
it("refuses unauthorized checks before privileged access", async () => {
  expect((await GET(request(false))).status).toBe(401);
  expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.meta).not.toHaveBeenCalled();
  vi.stubEnv("INTEGRATION_WORKER_SECRET", "");
  expect((await GET(request())).status).toBe(503);
  expect(mocks.service).not.toHaveBeenCalled();
});
it("checks four tables without reading rows or invoking a worker", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ready: true, checks: { meta: true, encryption: true, database: true } });
  expect(mocks.from.mock.calls.map(call => call[0])).toEqual(["integration_collection_jobs", "integration_raw_payloads", "integration_snapshots", "integration_provider_health"]);
  expect(mocks.limit.mock.calls).toEqual([[0], [0], [0], [0]]);
});
it.each(["meta", "encryption", "service"] as const)("reports missing %s configuration", async key => {
  mocks[key].mockReturnValue(null);
  const response = await GET(request()); expect(response.status).toBe(503);
  expect((await response.json()).ready).toBe(false);
});
it("does not report readiness when any schema query fails", async () => {
  mocks.limit.mockResolvedValueOnce({ error: { message: secret } });
  const response = await GET(request()); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ready: false, checks: { meta: true, encryption: true, database: false } });
});
it("sanitizes exceptions containing credentials", async () => {
  mocks.service.mockImplementation(() => { throw Error(secret); });
  const response = await GET(request()); expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(secret);
});
