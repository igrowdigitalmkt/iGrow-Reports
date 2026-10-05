import { expect,it } from "vitest";
import { exportMetaSnapshotCsv,exportMetaSnapshotJson } from "@/modules/meta/snapshot-export";
import type { MetaSnapshotView } from "@/modules/meta/snapshot-view";

function fixture(): MetaSnapshotView {
  return { status: "ready",missing: [],collectedAt: "2026-10-04T12:00:00Z",scopes: [{
    identity: { clientId: "client",connectionId: "connection",provider: "meta",externalAccountId: "act_1",
      dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "ad",apiVersion: "v24.0",contractVersion: 3 },
    snapshotId: "snapshot",collectedAt: "2026-10-04T12:00:00Z",entities: [{ id: "123",name: 'Anúncio; "A"\nlinha',
      hierarchy: { name: "A",parentId: "456",campaignId: "789",adsetId: "456" },currency: "BRL",timezone: "America/Sao_Paulo",deliveryStatus: null,
      indicators: [
        { key: "spend",nativeKey: "spend",label: "Valor usado",value: "123456789012345678.12345678",state: "available",unit: "currency",aggregationRule: "sum" },
        { key: "clicks",nativeKey: "clicks",label: "Cliques",value: "0",state: "zero",unit: "count",aggregationRule: "sum" },
        { key: "cost_per_result",nativeKey: "cost_per_result",label: "Custo",value: null,state: "unavailable",unit: "currency",aggregationRule: "ratio" },
      ],
    }],
  }] };
}

it("exports exact values, distinct zero/unavailable states and scope provenance",() => {
  const report = exportMetaSnapshotCsv(fixture(),"act_1","ad");
  expect(report.filename).toBe("meta-act_1-ad-2026-10-01-2026-10-03.csv");
  expect(report.content.startsWith("\uFEFF")).toBe(true);
  expect(report.content).toContain('"123456789012345678.12345678";"available"');
  expect(report.content).toContain('"0";"zero"');
  expect(report.content).toContain('"";"unavailable"');
  expect(report.content).toContain('"snapshot";"2026-10-04T12:00:00Z";"v24.0";"3"');
  expect(report.content).toContain('"789";"456";"BRL";"America/Sao_Paulo"');
  expect(report.content).toContain('"Anúncio; ""A""\nlinha"');
});

it.each(["=HYPERLINK(1)","+SUM(1)","-1+2","@SUM(1)"," \t=1","\r\n@SUM(1)"])("neutralizes spreadsheet formula text %s",name => {
  const view = fixture(); view.scopes[0].entities[0].name = name;
  expect(exportMetaSnapshotCsv(view,"act_1","ad").content).toContain(`"'${name}"`);
  expect(JSON.parse(exportMetaSnapshotJson(view,"act_1","ad").content).entities[0].name).toBe(name);
});

it("exports all entities independently of UI pagination, without mutation",() => {
  const view = fixture(); const entity = view.scopes[0].entities[0];
  view.scopes[0].entities = Array.from({ length: 61 },(_,index) => ({ ...entity,id: String(index) }));
  const before = JSON.stringify(view);
  const report = exportMetaSnapshotCsv(view,"act_1","ad");
  expect(report.entityCount).toBe(61);
  expect(report.content.match(/\r\n"indicador";/g)).toHaveLength(183);
  expect(JSON.parse(exportMetaSnapshotJson(view,"act_1","ad").content).entities).toHaveLength(61);
  expect(JSON.stringify(view)).toBe(before);
});

it("exports an empty confirmed scope with a manifest instead of invented zeros",() => {
  const view = fixture(); view.scopes[0].entities = [];
  const report = exportMetaSnapshotCsv(view,"act_1","ad");
  expect(report.entityCount).toBe(0); expect(report.content).toContain('"escopo";"ready"');
  expect(report.content).not.toContain('\r\n"indicador";');
  expect(report.content.trim().split("\r\n")).toHaveLength(2);
  expect(report.content.trim().split("\r\n").map(row => row.split(";").length)).toEqual([23,23]);
});

it("retains old confirmation timestamp and stale status in both formats",() => {
  const view = fixture(); view.status = "stale";
  expect(exportMetaSnapshotCsv(view,"act_1","ad").content).toContain('"escopo";"stale"');
  const report = JSON.parse(exportMetaSnapshotJson(view,"act_1","ad").content);
  expect(report.status).toBe("stale"); expect(report.collectedAt).toBe(view.scopes[0].collectedAt);
  expect(report.entities[0].indicators[0].value).toBe("123456789012345678.12345678");
  expect(report.entities[0].indicators[2].value).toBeNull();
});

it.each([exportMetaSnapshotCsv,exportMetaSnapshotJson])("blocks pending, missing, ambiguous and incompatible scopes",exporter => {
  const pending = fixture(); pending.status = "pending";
  expect(() => exporter(pending,"act_1","ad")).toThrow("completa");
  const missing = fixture(); missing.missing = [missing.scopes[0].identity];
  expect(() => exporter(missing,"act_1","ad")).toThrow("completa");
  expect(() => exporter(fixture(),"act_2","ad")).toThrow("escopo");
  expect(() => exporter(fixture(),"act_1","campaign")).toThrow("escopo");
  const duplicate = fixture(); duplicate.scopes.push(duplicate.scopes[0]);
  expect(() => exporter(duplicate,"act_1","ad")).toThrow("escopo");
  const incompatible = fixture(); incompatible.scopes[0].identity.provider = "google";
  expect(() => exporter(incompatible,"act_1","ad")).toThrow("escopo");
});

it("isolates the selected account and level without adding parent or currency totals",() => {
  const view = fixture(); const scope = view.scopes[0];
  view.scopes.push({ ...scope,identity: { ...scope.identity,externalAccountId: "act_2" },snapshotId: "other-account" });
  view.scopes.push({ ...scope,identity: { ...scope.identity,level: "campaign" },snapshotId: "parent-level" });
  const report = exportMetaSnapshotCsv(view,"act_1","ad");
  expect(report.entityCount).toBe(1); expect(report.content).not.toContain("other-account");
  expect(report.content).not.toContain("parent-level");
});
