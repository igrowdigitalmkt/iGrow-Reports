import { expect,it } from "vitest";
import { compareSnapshotIndicator,resolveSnapshotComparison } from "@/modules/meta/snapshot-comparison";
import { exportSnapshotComparisonCsv,exportSnapshotComparisonJson } from "@/modules/meta/snapshot-comparison-export";
import { snapshotPdfFixture } from "./fixtures/snapshot-pdf";
function fixture() {
  const current = snapshotPdfFixture(1), previous = snapshotPdfFixture(1);
  previous.scopes[0].identity.dateFrom = "2026-09-28"; previous.scopes[0].identity.dateTo = "2026-09-30";
  previous.scopes[0].snapshotId = "previous-snapshot";
  current.scopes[0].entities[0].indicators[0].value = "100.12345678";
  previous.scopes[0].entities[0].indicators[0].value = "80.12345678";
  return { current,previous };
}
it("preserves exact decimal differences and rounds only the calculated percentage",() => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0],old = previous.scopes[0].entities[0];
  expect(compareSnapshotIndicator(now.indicators[0],now,old)).toMatchObject({ status: "available",previousValue: "80.12345678",absoluteChange: "20",percentChange: "24.961479" });
  now.indicators[0].value = "123456789012345678901234567890.12345679"; old.indicators[0].value = "123456789012345678901234567890.12345678";
  expect(compareSnapshotIndicator(now.indicators[0],now,old).absoluteChange).toBe("0.00000001");
  now.indicators[0].value = "1e100"; old.indicators[0].value = "1";
  expect(compareSnapshotIndicator(now.indicators[0],now,old).absoluteChange).toBe("9".repeat(100));
});
it("keeps an absolute change when the previous value is zero without inventing a percentage",() => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0],old = previous.scopes[0].entities[0];
  old.indicators[0].value = "0"; old.indicators[0].state = "zero";
  expect(compareSnapshotIndicator(now.indicators[0],now,old)).toMatchObject({ status: "available",absoluteChange: "100.12345678",percentChange: null,reason: "zero_baseline" });
  now.indicators[0].value = "0"; now.indicators[0].state = "zero";
  expect(compareSnapshotIndicator(now.indicators[0],now,old)).toMatchObject({ absoluteChange: "0",percentChange: null });
});
it("never treats absent entities, absent metrics or unavailable values as zero",() => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0],old = previous.scopes[0].entities[0];
  expect(compareSnapshotIndicator(now.indicators[0],now).reason).toBe("missing_entity");
  expect(compareSnapshotIndicator({ ...now.indicators[0],key: "new" },now,old).reason).toBe("missing_metric");
  old.indicators[0].value = null; old.indicators[0].state = "unavailable";
  expect(compareSnapshotIndicator(now.indicators[0],now,old)).toMatchObject({ status: "unavailable",absoluteChange: null,percentChange: null });
});
it.each(["currency","timezone","attribution"])("refuses changed %s",key => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0],old = previous.scopes[0].entities[0];
  if (key === "currency") old.currency = "USD";
  if (key === "timezone") old.timezone = "UTC";
  if (key === "attribution") old.attributionWindow = "7d_click";
  expect(compareSnapshotIndicator(now.indicators[0],now,old).reason).toBe("incompatible");
});
it.each(["unit","nativeKey","aggregationRule"] as const)("refuses incompatible metric %s",key => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0],old = previous.scopes[0].entities[0]; old.indicators[0][key] = "different";
  expect(compareSnapshotIndicator(now.indicators[0],now,old).reason).toBe("incompatible");
});
it.each(["NaN","Infinity","-1","bad","1e10000"])("refuses invalid or unbounded amounts: %s",value => {
  const { current,previous } = fixture(); const now = current.scopes[0].entities[0]; now.indicators[0].value = value;
  expect(compareSnapshotIndicator(now.indicators[0],now,previous.scopes[0].entities[0]).status).toBe("unavailable");
});
it.each(["pending","foreign","duration","gap","duplicate"])("rejects incompatible period pair: %s",kind => {
  const { current,previous } = fixture();
  if (kind === "pending") previous.status = "pending";
  if (kind === "foreign") previous.scopes[0].identity.clientId = "foreign";
  if (kind === "duration") previous.scopes[0].identity.dateFrom = "2026-09-29";
  if (kind === "gap") { previous.scopes[0].identity.dateFrom = "2026-09-27"; previous.scopes[0].identity.dateTo = "2026-09-29"; }
  if (kind === "duplicate") previous.scopes[0].entities.push(previous.scopes[0].entities[0]);
  expect(() => resolveSnapshotComparison(current,previous,"act_123","ad")).toThrow();
});
it("exports both periods and previous-only entities with source IDs and exact deltas",() => {
  const { current,previous } = fixture(); previous.status = "stale";
  const extra = structuredClone(previous.scopes[0].entities[0]); extra.id = "previous-only"; extra.name = "=FORMULA";
  previous.scopes[0].entities.push(extra); const before = JSON.stringify({ current,previous });
  const json = JSON.parse(exportSnapshotComparisonJson(current,previous,"act_123","ad").content);
  expect(json.status).toBe("stale"); expect(json.previous.entities).toHaveLength(2);
  expect(json.comparisons[0].indicators[0].absoluteChange).toBe("20"); expect(json.previous.snapshotId).toBe("previous-snapshot");
  const csv = exportSnapshotComparisonCsv(current,previous,"act_123","ad").content;
  expect(csv).toContain('"\'=FORMULA"'); expect(csv).toContain('"previous-only"'); expect(csv).toContain('"20";"24.961479"');
  expect(csv.trim().split("\r\n")[0].split(";")).toHaveLength(21);
  expect(csv.trim().split("\r\n").every(row => row.split(";").length === 21)).toBe(true);
  expect(JSON.stringify({ current,previous })).toBe(before);
});
