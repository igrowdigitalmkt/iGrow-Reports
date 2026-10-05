import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { MetaSnapshotIndicator, MetaSnapshotView } from "@/modules/meta/snapshot-view";
import { exportMetaSnapshotCsv, exportMetaSnapshotJson } from "@/modules/meta/snapshot-export";
import { buildMetaSnapshotPdf } from "@/modules/reports/snapshot-pdf";

const fonts = { regular: readFileSync("public/fonts/NotoSans-Regular.ttf").toString("base64"), bold: readFileSync("public/fonts/NotoSans-Bold.ttf").toString("base64") };
const metric = (key: string, value: string | null, label = key, unit = "count"): MetaSnapshotIndicator =>
  ({ key, nativeKey: key, label, value, state: value === null ? "unavailable" : "available", unit, aggregationRule: "sum" });
const identity = (level: "account" | "campaign") => ({ clientId: "client", connectionId: "connection", provider: "meta" as const,
  externalAccountId: "act_1", dateFrom: "2026-09-28", dateTo: "2026-10-04", level, apiVersion: "v24.0", contractVersion: 3 });
const entity = (id: string, indicators: MetaSnapshotIndicator[]) => ({ id, name: id, hierarchy: null, currency: "BRL", timezone: "America/Sao_Paulo", indicators, deliveryStatus: null });

function view(): MetaSnapshotView {
  return { status: "ready", collectedAt: "2026-10-05T14:40:00Z", missing: [], scopes: [
    { identity: identity("account"), snapshotId: "s-account", collectedAt: "2026-10-05T14:40:00Z", entities: [entity("act_1", [
      metric("spend", "544.12", "Valor usado", "currency"), metric("result:provider_known", null),
      metric("primary_results", null, "Resultados"), metric("cost_per_result", null, "Custo por resultado", "currency"),
    ])] },
    { identity: identity("campaign"), snapshotId: "s-campaign", collectedAt: "2026-10-05T14:40:00Z", entities: [
      entity("c1", [metric("spend", "264.47", "Valor usado", "currency"), metric("result:provider_known", "1"), metric("result:provider:action:link_click", "1366", "Cliques no link")]),
      entity("c2", [metric("spend", "279.65", "Valor usado", "currency"), metric("result:provider_known", "1"), metric("result:provider:action:offsite_conversion.fb_pixel_complete_registration", "10", "Cadastros concluídos no site")]),
    ] },
  ] };
}

it("adds labelled campaign-derived results to the account CSV without altering stored rows", () => {
  const csv = exportMetaSnapshotCsv(view(), "act_1", "account").content;
  const derived = csv.split("\r\n").filter(line => line.startsWith('"resultado_derivado"'));
  expect(derived).toHaveLength(4);
  expect(derived[0]).toContain('"campaign_results:result:provider:action:link_click"');
  expect(derived[0]).toContain('"1366"');
  expect(derived[1]).toContain('"campaign_cost_per_result:result:provider:action:link_click"');
  expect(derived[3]).toContain('"27.965"');
  expect(csv).toContain('"indicador";"ready";"act_1";"account"');
  expect(exportMetaSnapshotCsv(view(), "act_1", "campaign").content).not.toContain("resultado_derivado");
});

it("adds campaign-derived results to the account JSON as a separate field", () => {
  const json = JSON.parse(exportMetaSnapshotJson(view(), "act_1", "account").content);
  expect(json.campaignDerivedResults.results).toEqual([
    expect.objectContaining({ nativeKey: "result:provider:action:link_click", value: "1366" }),
    expect.objectContaining({ label: "Cadastros concluídos no site", value: "10", costPerResult: "27.965" }),
  ]);
  expect(json.campaignDerivedResults.primaryResults).toBeNull();
  expect(json.entities[0].indicators.find((item: MetaSnapshotIndicator) => item.key === "primary_results").value).toBeNull();
  expect(JSON.parse(exportMetaSnapshotJson(view(), "act_1", "campaign").content)).not.toHaveProperty("campaignDerivedResults");
});

it("renders the derived results section in the account PDF", () => {
  const report = buildMetaSnapshotPdf({ view: view(), externalAccountId: "act_1", level: "account", accountName: "Colégio Crescer" }, fonts);
  expect(report.entityCount).toBe(1);
  mkdirSync("artifacts/snapshot-pdf", { recursive: true });
  writeFileSync("artifacts/snapshot-pdf/account-derived-results.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
