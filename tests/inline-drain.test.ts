import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), runOne: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/modules/meta/job-worker", () => ({ runOneMetaIntegrationJob: mocks.runOne }));
import { scheduleMetaQueueDrain } from "@/modules/meta/inline-drain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const service = "service" as unknown as SupabaseClient<Database>;
let pending: Promise<unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  pending = null;
  mocks.after.mockImplementation((callback: () => Promise<unknown>) => { pending = callback(); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("drains queued Meta jobs after the response until the queue is empty", async () => {
  mocks.runOne.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  scheduleMetaQueueDrain(service);
  await pending;
  expect(mocks.after).toHaveBeenCalledTimes(1);
  expect(mocks.runOne).toHaveBeenCalledTimes(3);
  expect(mocks.runOne).toHaveBeenCalledWith(service);
});

it("stops claiming at the job limit", async () => {
  mocks.runOne.mockResolvedValue(true);
  scheduleMetaQueueDrain(service);
  await pending;
  expect(mocks.runOne).toHaveBeenCalledTimes(20);
});

it("can be disabled without code changes", async () => {
  vi.stubEnv("INLINE_COLLECTION_DISABLED", "true");
  scheduleMetaQueueDrain(service);
  expect(mocks.after).not.toHaveBeenCalled();
});

it("logs a failed drain without provider or database details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.runOne.mockRejectedValue(new Error("https://graph.facebook.com/?access_token=secret"));
  scheduleMetaQueueDrain(service);
  await expect(pending).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith("inline-collection-drain-failed", { provider: "meta" });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
