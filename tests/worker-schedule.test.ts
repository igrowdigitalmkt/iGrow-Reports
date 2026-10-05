import { expect, it, vi } from "vitest";
// @ts-expect-error Operational script also runs directly in Node.
import { applyWorkerSchedule, prepareWorkerSchedule } from "../scripts/worker-schedule.mjs";
const env = { NEXT_PUBLIC_APP_URL: "https://igrow.example.com", INTEGRATION_WORKER_SECRET: "s".repeat(48), QSTASH_TOKEN: "qstash-private-token" };
const ready = () => Response.json({ ready: true, checks: { meta: true, encryption: true, database: true } });
it("prepares a stable schedule without disclosing secrets", () => {
  const plan = prepareWorkerSchedule(env);
  expect(plan).toMatchObject({ destination: "https://igrow.example.com/api/workers/meta", cron: "*/15 * * * *", method: "POST", retries: 0 });
  expect(prepareWorkerSchedule(env).scheduleId).toBe(plan.scheduleId);
  expect(prepareWorkerSchedule({ ...env, NEXT_PUBLIC_APP_URL: "https://other.example.com" }).scheduleId).not.toBe(plan.scheduleId);
  expect(JSON.stringify(plan)).not.toContain(env.INTEGRATION_WORKER_SECRET); expect(JSON.stringify(plan)).not.toContain(env.QSTASH_TOKEN);
});
it.each(["http://app.example.com", "https://user:private@app.example.com", "https://app.example.com/path", "https://app.example.com/?token=private"])("rejects unsafe destination %s", origin => {
  expect(() => prepareWorkerSchedule({ ...env, NEXT_PUBLIC_APP_URL: origin })).toThrow("NEXT_PUBLIC_APP_URL");
});
it.each(["https://qstash.upstash.io.evil.test", "https://evil.test", "http://qstash.upstash.io", "https://qstash.upstash.io/path"])("rejects credential forwarding to %s", origin => {
  expect(() => prepareWorkerSchedule({ ...env, QSTASH_URL: origin })).toThrow("QSTASH_URL");
});
it("stops without network access when credentials are missing", async () => {
  const fetcher = vi.fn();
  await expect(applyWorkerSchedule({ NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL }, fetcher)).rejects.toThrow("Configure");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([new Response(null, { status: 503 }), Response.json({ ready: true }), Response.json({ ready: false, checks: { meta: true, encryption: true, database: true } })])("requires verified health before any QStash call", async response => {
  const fetcher = vi.fn().mockResolvedValue(response);
  await expect(applyWorkerSchedule(env, fetcher)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${env.INTEGRATION_WORKER_SECRET}` } });
});
it("never overwrites an existing schedule or retries a failed lookup", async () => {
  for (const status of [200, 401, 500]) {
    const fetcher = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response(null, { status }));
    await expect(applyWorkerSchedule(env, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});
it("creates only after health and absence checks with separate tokens and redaction", async () => {
  const plan = prepareWorkerSchedule(env);
  const fetcher = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ scheduleId: plan.scheduleId }));
  expect(await applyWorkerSchedule(env, fetcher)).toMatchObject({ created: true, scheduleId: plan.scheduleId });
  expect(fetcher.mock.calls[2][0]).toBe(`https://qstash.upstash.io/v2/schedules/${encodeURIComponent(plan.destination)}`);
  expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${env.QSTASH_TOKEN}`, "Upstash-Forward-Authorization": `Bearer ${env.INTEGRATION_WORKER_SECRET}`, "Upstash-Redact-Fields": "header[Authorization]", "Upstash-Retries": "0" }, body: "{}" });
});
it("never prints provider bodies or connection exceptions", async () => {
  for (const result of [new Response(env.QSTASH_TOKEN, { status: 400 }), Response.json({ scheduleId: env.QSTASH_TOKEN })]) {
    const fetcher = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(result);
    await expect(applyWorkerSchedule(env, fetcher)).rejects.not.toThrow(env.QSTASH_TOKEN);
  }
  await expect(applyWorkerSchedule(env, vi.fn().mockRejectedValue(Error(env.QSTASH_TOKEN)))).rejects.not.toThrow(env.QSTASH_TOKEN);
});
it("rejects malformed or null health responses without provisioning", async () => {
  for (const response of [Response.json(null), new Response("not-json")]) {
    const fetcher = vi.fn().mockResolvedValue(response);
    await expect(applyWorkerSchedule(env, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("reports ambiguous creation responses without automatically retrying", async () => {
  for (const response of [Response.json(null), new Response("not-json")]) {
    const fetcher = vi.fn().mockResolvedValueOnce(ready()).mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(response);
    await expect(applyWorkerSchedule(env, fetcher)).rejects.toThrow("confira");
    expect(fetcher).toHaveBeenCalledTimes(3);
  }
});
