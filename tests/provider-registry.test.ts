import { describe, expect, it } from "vitest";
import { getProviderDefinition, listProviderDefinitions } from "@/modules/integrations/provider-registry";

describe("provider registry", () => {
  it("keeps provider capabilities explicit", () => {
    const meta = getProviderDefinition("meta");
    expect(meta?.hierarchyLevels).toContain("campaign");
    expect(meta?.supportsAsyncReports).toBe(true);
    expect(meta?.expectedLatencyMinutes).toBeGreaterThan(0);
  });
  it("exposes the initial integration set", () => {
    expect(listProviderDefinitions().map(p => p.id)).toEqual(["meta", "google", "tiktok", "linkedin", "youtube"]);
  });
  it("does not invent capabilities for unknown providers", () => {
    expect(getProviderDefinition("unknown")).toBeNull();
  });
});
