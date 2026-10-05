import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,expect,it,vi } from "vitest";
import type { SnapshotDashboardData } from "@/modules/client-portal/snapshot-dashboard-loader";
import { snapshotPdfFixture } from "./fixtures/snapshot-pdf";
const transitions = vi.hoisted(() => ({ index: 0,selection: false }));
vi.mock("react",async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,useTransition: () => [transitions.index++ === 1 && transitions.selection,vi.fn()] };
});
vi.mock("next/navigation",() => ({ useRouter: () => ({ refresh: vi.fn(),push: vi.fn() }) }));
vi.mock("@/modules/client-portal/snapshot-dashboard-actions",() => ({ requestMissingSnapshotData: vi.fn() }));
import { SnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard";
beforeEach(() => { transitions.index = 0; transitions.selection = false; });
function source(): SnapshotDashboardData {
  const view = snapshotPdfFixture(1); view.scopes[0].identity.level = "account";
  return { accounts: [{ id: "account",connection_id: "connection",external_id: "act_123",name: "Conta",currency: "BRL",timezone_name: "America/Sao_Paulo" }],selectedAccountIds: ["account"],dateFrom: "2026-10-01",dateTo: "2026-10-03",view,blockedReason: null };
}
it("hides old confirmed values, entity tables and exports throughout a filter navigation",() => {
  transitions.selection = true;
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: source(),clientId: "client",canCollect: true }));
  expect(html).toContain('aria-busy="true"'); expect(html).toContain("Carregando o período selecionado");
  expect(html).not.toContain('class="snapshot-card"'); expect(html).not.toContain("123456789012345678");
  expect(html).not.toContain("Exportar PDF"); expect(html).not.toContain("Exportar CSV"); expect(html).not.toContain("Exportar JSON");
  expect(html).not.toContain("Entidades do nível selecionado");
  expect(html).toContain('<fieldset aria-label="Filtros da análise" disabled=""');
});
it("releases the complete confirmed screen after navigation finishes",() => {
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: source(),clientId: "client" }));
  expect(html).toContain('aria-busy="false"'); expect(html).toContain('class="snapshot-card"');
  expect(html).toContain("Exportar PDF"); expect(html).not.toContain("Carregando o período selecionado");
});
