import { describe, expect, it } from "vitest";
import { buildMetaCollectionIdentity } from "@/modules/meta/queue-identity";

describe("Meta queue identity", () => {
  it("keeps account, period, level and API version in the job scope", () => {
    expect(buildMetaCollectionIdentity({ clientId: "c", connectionId: "i", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", apiVersion: "v24.0" })).toEqual({ clientId: "c", connectionId: "i", provider: "meta", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 3 });
  });
});
