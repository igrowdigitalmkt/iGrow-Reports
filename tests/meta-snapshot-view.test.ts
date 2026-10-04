import { expect, it } from "vitest";
import { projectMetaSnapshotView } from "@/modules/meta/snapshot-view";
import type { SnapshotBundle } from "@/modules/integrations/snapshot-bundle-reader";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";

const identity: CollectionIdentity = { clientId: "c", connectionId: "i", provider: "meta", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 3 };
function bundle(): Extract<SnapshotBundle, { status: "ready" | "stale" }> {
  return { status: "ready", missing: [], collectedAt: "2026-10-04T12:00:00Z", scopes: [{ identity,
    snapshot: { status: "ready", snapshotId: "s", collectedAt: "2026-10-04T12:00:00Z", ageMs: 0, entities: [{
      id: "123", metadata: { name: "Campanha A", parentId: "act_1", campaignId: "123", adsetId: null },
      currency: "BRL", timezone: "America/Sao_Paulo", values: { spend: "123456789012345678.12345678", inline_link_clicks: "0", cost_per_result: null },
      states: { spend: "available", inline_link_clicks: "zero", cost_per_result: "unavailable" },
      units: { spend: "currency", inline_link_clicks: "count", cost_per_result: "currency" },
      aggregationRules: { spend: "sum", inline_link_clicks: "sum", cost_per_result: "ratio" },
    }] } }] };
}
it("preserves decimal precision, zero and unavailable values with dashboard labels", () => {
  const entity = projectMetaSnapshotView(bundle()).scopes[0].entities[0];
  expect(entity.name).toBe("Campanha A");
  expect(entity.deliveryStatus).toBeNull();
  expect(entity.indicators[0]).toMatchObject({ label: "Valor usado", value: "123456789012345678.12345678", unit: "currency", aggregationRule: "sum" });
  expect(entity.indicators[1]).toMatchObject({ key: "link_clicks", nativeKey: "inline_link_clicks", label: "Cliques no link", value: "0", state: "zero" });
  expect(entity.indicators[2]).toMatchObject({ value: null, state: "unavailable" });
});
it("withholds presentation data for a pending bundle", () => {
  expect(projectMetaSnapshotView({ status: "pending", scopes: [], missing: [identity], collectedAt: null }))
    .toEqual({ status: "pending", scopes: [], missing: [identity], collectedAt: null });
});
it("keeps stale data and collection provenance", () => {
  const input = bundle(); input.status = "stale";
  expect(projectMetaSnapshotView(input)).toMatchObject({ status: "stale", collectedAt: input.collectedAt,
    scopes: [{ snapshotId: "s", collectedAt: input.collectedAt, identity }] });
});
it("keeps different levels separate and uses the ID when a name is absent", () => {
  const input = bundle();
  input.scopes.push({ ...input.scopes[0], identity: { ...identity, level: "account" } });
  input.scopes[0].snapshot.entities[0].metadata = null;
  const result = projectMetaSnapshotView(input);
  expect(result.scopes.map(scope => scope.identity.level)).toEqual(["campaign", "account"]);
  expect(result.scopes[0].entities[0].name).toBe("123");
});
it("preserves complete empty collections", () => {
  const input = bundle(); input.scopes[0].snapshot.entities = [];
  expect(projectMetaSnapshotView(input).scopes[0].entities).toEqual([]);
});
it("rejects other providers and missing metric metadata", () => {
  const input = bundle(); input.scopes[0].identity = { ...identity, provider: "google" };
  expect(() => projectMetaSnapshotView(input)).toThrow("incompatível");
  const missing = bundle(); delete missing.scopes[0].snapshot.entities[0].units.spend;
  expect(() => projectMetaSnapshotView(missing)).toThrow("sem metadados");
});
it("does not let aliases overwrite one another", () => {
  const input = bundle(); input.scopes[0].snapshot.entities[0].values.link_clicks = "1";
  expect(() => projectMetaSnapshotView(input)).toThrow("duplicados");
});
it("returns detached presentation metadata", () => {
  const input = bundle(); const output = projectMetaSnapshotView(input);
  output.scopes[0].identity.clientId = "changed";
  output.scopes[0].entities[0].hierarchy!.name = "changed";
  expect(input.scopes[0].identity.clientId).toBe("c");
  expect(input.scopes[0].snapshot.entities[0].metadata!.name).toBe("Campanha A");
});
