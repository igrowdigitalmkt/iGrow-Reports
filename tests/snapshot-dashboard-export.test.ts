import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/client-portal/snapshot-dashboard-actions", () => ({ requestMissingSnapshotData: vi.fn() }));
import { SnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard";
import type { SnapshotDashboardData } from "@/modules/client-portal/snapshot-dashboard-loader";
import { snapshotPdfFixture } from "./fixtures/snapshot-pdf";
function data(): SnapshotDashboardData {
  const view = snapshotPdfFixture(1); view.scopes[0].identity.level = "account";
  return { accounts: [{ id: "account", connection_id: "connection", external_id: "act_123", name: "Conta", currency: "BRL", timezone_name: "America/Sao_Paulo" }], selectedAccountIds: ["account"], dateFrom: "2026-10-01", dateTo: "2026-10-03", view, blockedReason: null };
}
it("offers PDF, CSV and JSON only after the complete analysis is released", () => {
  const source = data();
  const html = renderToStaticMarkup(createElement(SnapshotDashboard, { data: source, clientId: "client" }));
  expect(html).toContain("Exportar PDF do nível"); expect(html).toContain("Exportar CSV do nível"); expect(html).toContain("Exportar JSON do nível");
  expect(html).not.toContain('disabled=""');
  source.view.status = "pending"; source.blockedReason = "missing";
  const pending = renderToStaticMarkup(createElement(SnapshotDashboard, { data: source, clientId: "client" }));
  expect(pending).not.toContain("Exportar PDF"); expect(pending).not.toContain("Exportar CSV"); expect(pending).not.toContain("Exportar JSON");
  expect(pending).toContain("Aguardando a análise completa");
});
it("keeps a stale confirmed report exportable with its update notice", () => {
  const source = data(); source.view.status = "stale";
  const html = renderToStaticMarkup(createElement(SnapshotDashboard, { data: source, clientId: "client" }));
  expect(html).toContain("Exportar PDF do nível"); expect(html).toContain("aguardando atualização");
});
it("explains previous-only entities and renders a negative decimal change",() => {
  const source = data(); const previous = structuredClone(source.view);
  previous.scopes[0].identity.dateFrom = "2026-09-28"; previous.scopes[0].identity.dateTo = "2026-09-30";
  source.view.scopes[0].entities[0].indicators[0].value = "80";
  previous.scopes[0].entities[0].indicators[0].value = "100";
  const extra = structuredClone(previous.scopes[0].entities[0]); extra.id = "previous-only"; previous.scopes[0].entities.push(extra);
  source.comparison = { dateFrom: "2026-09-28",dateTo: "2026-09-30",view: previous,blockedReason: null };
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: source,clientId: "client" }));
  expect(html).toContain("1 entidade foi retornada apenas no período anterior");
  expect(html).toContain("Diferença: R$ -20,00"); expect(html).toContain("-20,00%");
});
