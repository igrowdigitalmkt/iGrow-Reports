import { describe, expect, it } from "vitest";
import { assertWorkloadIsolation, buildSyntheticWorkload } from "@/modules/integrations/load-simulation";

describe("100-client workload", () => {
  it("creates isolated work for every client", () => {
    const workload = buildSyntheticWorkload(100);
    expect(workload).toHaveLength(100);
    expect(new Set(workload.map(item => item.clientId)).size).toBe(100);
    expect(assertWorkloadIsolation(workload)).toBe(true);
  });
  it("keeps the workload provider-scoped", () => {
    const workload = buildSyntheticWorkload(100, "tiktok");
    expect(workload.every(item => item.jobs[0].provider === "tiktok")).toBe(true);
    expect(workload.every(item => item.priority === 20)).toBe(true);
  });
  it("rejects accidental cross-client or duplicate identity", () => {
    const workload = buildSyntheticWorkload(2);
    workload[1].jobs[0] = { ...workload[0].jobs[0], clientId: "wrong-client" };
    expect(assertWorkloadIsolation(workload)).toBe(false);
  });
});
