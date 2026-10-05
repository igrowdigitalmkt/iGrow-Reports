import { afterEach,beforeEach,expect,it,vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(),runOne: vi.fn() }));
vi.mock("server-only",() => ({}));
vi.mock("@/lib/supabase/service",() => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/meta/job-worker",() => ({ runOneMetaIntegrationJob: mocks.runOne }));
import { POST } from "@/app/api/workers/meta/route";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { runWorkerBatch } from "@/modules/integrations/worker-batch";
const secret = "a".repeat(48);
const request = (header?: string) => new Request("https://example.test/api/workers/meta",{ method: "POST",headers: header ? { authorization: header } : {} });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("INTEGRATION_WORKER_SECRET",secret); mocks.service.mockReturnValue("service"); mocks.runOne.mockResolvedValue(false); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("authenticates a bearer token and rejects malformed or missing secrets",() => {
  expect(authorizeWorkerRequest(`Bearer ${secret}`,secret)).toBe("authorized");
  expect(authorizeWorkerRequest(`Bearer ${"b".repeat(48)}`,secret)).toBe("unauthorized");
  expect(authorizeWorkerRequest(`bearer ${secret}`,secret)).toBe("unauthorized");
  expect(authorizeWorkerRequest(null,secret)).toBe("unauthorized");
  expect(authorizeWorkerRequest(`Bearer ${secret}`,"short")).toBe("unconfigured");
});
it("never creates a privileged client for unauthenticated requests",async () => {
  const response = await POST(request());
  expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.runOne).not.toHaveBeenCalled();
});
it("returns unavailable when configuration is absent",async () => {
  vi.stubEnv("INTEGRATION_WORKER_SECRET","");
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  expect(mocks.service).not.toHaveBeenCalled();
  vi.stubEnv("INTEGRATION_WORKER_SECRET",secret); mocks.service.mockReturnValue(null);
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  expect(mocks.runOne).not.toHaveBeenCalled();
});
it("processes sequential jobs and stops when the queue is empty",async () => {
  mocks.runOne.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const response = await POST(request(`Bearer ${secret}`));
  expect(await response.json()).toMatchObject({ processed: 2,stopReason: "empty",executionId: expect.any(String) });
  expect(mocks.runOne).toHaveBeenCalledTimes(3);
});
it("limits one HTTP invocation to four processed jobs",async () => {
  mocks.runOne.mockResolvedValue(true);
  expect(await (await POST(request(`Bearer ${secret}`))).json()).toMatchObject({ processed: 4,stopReason: "job_limit" });
  expect(mocks.runOne).toHaveBeenCalledTimes(4);
});
it("sanitizes infrastructure errors and stops claiming additional jobs",async () => {
  const logger = vi.spyOn(console,"error").mockImplementation(() => {});
  mocks.runOne.mockRejectedValue(new Error(`access_token=${secret}`));
  const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(secret);
  expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  expect(mocks.runOne).toHaveBeenCalledTimes(1);
});
it("sanitizes errors constructing the privileged client",async () => {
  const logger = vi.spyOn(console,"error").mockImplementation(() => {});
  mocks.service.mockImplementation(() => { throw new Error(`private configuration ${secret}`); });
  const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain(secret);
  expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  expect(mocks.runOne).not.toHaveBeenCalled();
});
it("does not claim a new job after its time budget is consumed",async () => {
  let elapsed = 0;
  const runOne = vi.fn(async () => { elapsed += 70; return true; });
  expect(await runWorkerBatch(runOne,{ maxJobs: 5,budgetMs: 100,now: () => elapsed })).toEqual({ processed: 2,stopReason: "time_budget" });
  expect(runOne).toHaveBeenCalledTimes(2);
});
it("rejects invalid batch limits before claiming",async () => {
  const runOne = vi.fn();
  await expect(runWorkerBatch(runOne,{ maxJobs: 0,budgetMs: 100 })).rejects.toThrow("inválidos");
  await expect(runWorkerBatch(runOne,{ maxJobs: 1,budgetMs: Infinity })).rejects.toThrow("inválidos");
  expect(runOne).not.toHaveBeenCalled();
});
