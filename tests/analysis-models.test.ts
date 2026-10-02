import { describe, expect, it } from "vitest";
import { modelMetrics, moveMetric } from "@/modules/client-portal/analysis-models";

describe("analysis models", () => {
  it("does not invent unavailable platform metrics and keeps frequency", () => {
    expect(modelMetrics(["roas", "action:purchase", "roas"], ["roas", "frequency"])).toEqual(["roas", "frequency"]);
    expect(modelMetrics(["roas"], ["reach"])).toEqual([]);
  });
  it("reorders without losing selected metrics and protects boundaries", () => {
    const keys = ["clicks", "frequency", "roas"];
    expect(moveMetric(keys, "roas", -1)).toEqual(["clicks", "roas", "frequency"]);
    expect(moveMetric(keys, "clicks", -1)).toEqual(keys);
    expect(moveMetric(keys, "missing", 1)).toEqual(keys);
    expect(keys).toEqual(["clicks", "frequency", "roas"]);
  });
});

