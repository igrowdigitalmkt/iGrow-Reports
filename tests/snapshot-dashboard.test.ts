import { expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
vi.mock("next/navigation",() => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/client-portal/snapshot-dashboard-actions",() => ({ requestMissingSnapshotData: vi.fn() }));
import { SnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard";
import type { SnapshotDashboardData } from "@/modules/client-portal/snapshot-dashboard-loader";
import { formatSnapshotDecimal } from "@/modules/meta/snapshot-format";
const account = { id: "a",connection_id: "i",external_id: "act_1",name: "Conta A",currency: "BRL",timezone_name: "America/Sao_Paulo" };
const data: SnapshotDashboardData = { accounts: [account],selectedAccountIds: ["a"],dateFrom: "2026-10-01",dateTo: "2026-10-03",blockedReason: "missing",
  view: { status: "pending",missing: [],scopes: [],collectedAt: null } };
it("renders loading guidance without any partial indicator cards",() => {
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data,clientId: "c" }));
  expect(html).toContain("Aguardando a análise completa");
  expect(html).not.toContain('class="snapshot-card"');
  expect(html).not.toContain("Indisponível");
  expect(html).not.toContain("Exportar CSV");
  expect(html).not.toContain("Exportar JSON");
});
it("exposes collection requests only to authorized operators",() => {
  const missingData = { ...data,view: { ...data.view,missing: [{ clientId: "c",connectionId: "i",provider: "meta" as const,externalAccountId: "act_1",dateFrom: data.dateFrom,dateTo: data.dateTo,level: "account" as const,apiVersion: "v24.0",contractVersion: 3 }] } };
  expect(renderToStaticMarkup(createElement(SnapshotDashboard,{ data: missingData,clientId: "c",canCollect: false }))).not.toContain("Solicitar dados faltantes");
  expect(renderToStaticMarkup(createElement(SnapshotDashboard,{ data: missingData,clientId: "c",canCollect: true }))).toContain("Solicitar dados faltantes");
});
it("offers only the missing previous period and hides every export while comparing",() => {
  const previous = { ...data.view,missing: [{ clientId: "c",connectionId: "i",provider: "meta" as const,externalAccountId: "act_1",dateFrom: "2026-09-28",dateTo: "2026-09-30",level: "account" as const,apiVersion: "v24.0",contractVersion: 3 }] };
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: { ...data,comparison: { dateFrom: "2026-09-28",dateTo: "2026-09-30",view: previous,blockedReason: "missing" } },clientId: "c",canCollect: true }));
  expect(html).toContain("Solicitar dados do período anterior");
  expect(html).not.toContain("Solicitar dados do período atual");
  expect(html).not.toContain("Exportar CSV"); expect(html).not.toContain('class="snapshot-card"');
});
it("keeps recovery available to an operator when stored metrics are invalid",() => {
  const invalid = { ...data,blockedReason: "invalid" as const };
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: invalid,clientId: "c",canCollect: true }));
  expect(html).toContain("Atualizar dados"); expect(html).toContain("precisam ser conciliados");
  expect(html).not.toContain('class="snapshot-card"');
});
it("renders confirmed indicators together with the account and collection time",() => {
  const ready: SnapshotDashboardData = { ...data,blockedReason: null,view: { status: "ready",missing: [],collectedAt: "2026-10-04T12:00:00Z",scopes: [{
    identity: { clientId: "c",connectionId: "i",provider: "meta",externalAccountId: "act_1",dateFrom: data.dateFrom,dateTo: data.dateTo,level: "account",apiVersion: "v24.0",contractVersion: 3 },
    snapshotId: "s",collectedAt: "2026-10-04T12:00:00Z",entities: [{ id: "act_1",name: "Conta A",hierarchy: null,currency: "BRL",timezone: "America/Sao_Paulo",deliveryStatus: null,
      indicators: [{ key: "spend",nativeKey: "spend",label: "Valor usado",value: "123456789012345678.12",state: "available",unit: "currency",aggregationRule: "sum" }] }],
  }] } };
  const html = renderToStaticMarkup(createElement(SnapshotDashboard,{ data: ready,clientId: "c" }));
  expect(html).toContain("Análise confirmada"); expect(html).toContain("123.456.789.012.345.678,12");
  expect(html).toContain("Valor usado"); expect(html).not.toContain("Aguardando a análise completa");
  expect(html).toContain("Exportar CSV do nível");
  expect(html).toContain("Exportar JSON do nível");
});
it("formats exact large decimals without converting to Number",() => {
  expect(formatSnapshotDecimal("123456789012345678.12345678","currency","BRL")).toBe("R$ 123.456.789.012.345.678,12");
  expect(formatSnapshotDecimal("0","count",null)).toBe("0");
  expect(formatSnapshotDecimal("2.19","percent",null)).toBe("2,19%");
  expect(formatSnapshotDecimal(null,"count",null)).toBe("Indisponível");
  expect(formatSnapshotDecimal("10","currency",null)).toBe("Indisponível");
});
