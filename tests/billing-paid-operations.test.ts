import { beforeEach, describe, expect, it, vi } from "vitest";

// Trava das operações PAGAS no servidor (política: suspensa/encerrada bloqueia novas operações pagas; leitura e histórico continuam).
// Usa o guard REAL; só o estado financeiro (agency_billing_restricted) é simulado. Teste com mocks: não prova o banco nem entrega externa.
const mocks = vi.hoisted(() => ({
  access: vi.fn(), context: vi.fn(), modules: vi.fn(), sendQrReply: vi.fn(), record: vi.fn(), service: vi.fn(), sendReport: vi.fn(),
  dashboardAccess: vi.fn(), revalidate: vi.fn(), analytics: vi.fn(), fresh: vi.fn(), refresh: vi.fn(), collect: vi.fn(), rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/billing/access", () => ({ getAgencyBillingAccess: mocks.access }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("@/modules/team/admin", () => ({ loadOwnModules: mocks.modules }));
vi.mock("@/modules/whatsapp-qr/server", () => ({ sendQrReply: mocks.sendQrReply, sendQrExtended: vi.fn(), sendQrReaction: vi.fn() }));
vi.mock("@/modules/whatsapp/inbox-store", () => ({ recordInboxMessage: mocks.record }));
vi.mock("@/modules/whatsapp/server", () => ({ sendReportByWhatsApp: mocks.sendReport, WhatsAppSetupError: class extends Error {}, sendOfficialReply: vi.fn(), sendOfficialReaction: vi.fn() }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: mocks.dashboardAccess }));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/client-portal/analytics-live", () => ({ getFreshClientAnalytics: mocks.fresh }));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect, refreshMetaDashboardScope: mocks.refresh, MetaSetupError: class extends Error {} }));
vi.mock("@/modules/meta/client", () => ({ MetaApiError: class extends Error {} }));

import { BillingRestrictedError, PAID_OPERATION_RESTRICTED_MESSAGE, PAID_OPERATION_UNVERIFIED_MESSAGE, billingBlockOf, ensurePaidOperation, paidOperationBlock } from "@/modules/billing/guard";
import { POST as startConversation } from "@/app/api/whatsapp/inbox/new/route";
import { POST as sendReportRoute } from "@/app/api/whatsapp/send/route";
import { generateDashboardReport } from "@/modules/client-portal/report-actions";
import { generateManualReport } from "@/modules/reports/actions";
import { collectDashboardData } from "@/modules/client-portal/analytics-actions";

const agency = "00000000-0000-4000-8000-000000000002";
const clientId = "94e033bc-1fe7-4ddb-868d-e2f07b998dae";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue("allowed");
  mocks.service.mockReturnValue({});
});

describe("guard central", () => {
  it("restrito e não confirmável bloqueiam; liberado passa; sem cliente de serviço nunca libera", async () => {
    mocks.access.mockResolvedValue("allowed");
    await expect(ensurePaidOperation(agency)).resolves.toBeUndefined();
    mocks.access.mockResolvedValue("restricted");
    await expect(ensurePaidOperation(agency)).rejects.toBeInstanceOf(BillingRestrictedError);
    expect(await paidOperationBlock(agency)).toEqual({ status: 403, error: PAID_OPERATION_RESTRICTED_MESSAGE, code: "billing_restricted" });
    mocks.access.mockResolvedValue("unknown");
    expect(await paidOperationBlock(agency)).toEqual({ status: 503, error: PAID_OPERATION_UNVERIFIED_MESSAGE, code: "billing_unverified" });
    mocks.service.mockReturnValue(null);
    expect((await paidOperationBlock(agency))?.code).toBe("billing_unverified");
    expect(billingBlockOf(new Error("outro"))).toBeNull();
  });
  it("a mensagem deixa claro que dados e histórico continuam disponíveis e aponta a regularização", () => {
    expect(PAID_OPERATION_RESTRICTED_MESSAGE).toMatch(/continuam disponíveis para consulta/);
    expect(PAID_OPERATION_RESTRICTED_MESSAGE).toMatch(/Regularize em Assinatura/);
  });
});

describe("envio manual de WhatsApp (nova conversa): bloqueado no servidor antes de qualquer envio", () => {
  const start = () => startConversation(new Request("https://app.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "86999999999", text: "Olá" }) }));
  beforeEach(() => {
    mocks.context.mockResolvedValue({ supabase: {}, agency: { id: agency }, user: { id: agency }, role: "editor" });
    mocks.modules.mockResolvedValue(["whatsapp"]);
    mocks.sendQrReply.mockResolvedValue("native-id");
    mocks.record.mockResolvedValue({ conversation_id: "c1" });
  });
  it("liberado: envia", async () => {
    expect((await start()).status).toBe(200);
    expect(mocks.sendQrReply).toHaveBeenCalledTimes(1);
  });
  it("restrito: 403, nenhuma chamada ao WhatsApp e nada gravado", async () => {
    mocks.access.mockResolvedValue("restricted");
    const response = await start();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("billing_restricted");
    expect(mocks.sendQrReply).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("estado financeiro não confirmável: 503 e nenhum envio", async () => {
    mocks.access.mockResolvedValue("unknown");
    expect((await start()).status).toBe(503);
    expect(mocks.sendQrReply).not.toHaveBeenCalled();
  });
  it("regularizada: volta a enviar", async () => {
    mocks.access.mockResolvedValue("restricted");
    expect((await start()).status).toBe(403);
    mocks.access.mockResolvedValue("allowed");
    expect((await start()).status).toBe(200);
    expect(mocks.sendQrReply).toHaveBeenCalledTimes(1);
  });
  it("outra organização não é afetada: o estado é consultado pela organização da sessão", async () => {
    mocks.access.mockImplementation(async (_service: unknown, id: string) => (id === agency ? "restricted" : "allowed"));
    expect((await start()).status).toBe(403);
    mocks.context.mockResolvedValue({ supabase: {}, agency: { id: "00000000-0000-4000-8000-0000000000bb" }, user: { id: agency }, role: "editor" });
    expect((await start()).status).toBe(200);
  });
});

describe("relatório enviado por WhatsApp (PDF gerado no navegador)", () => {
  const form = () => {
    const body = new FormData();
    body.set("clientId", clientId); body.set("reportVersionId", "10000000-0000-4000-8000-000000000001");
    body.append("recipientIds", "20000000-0000-4000-8000-000000000001"); body.set("period", "Setembro de 2026"); body.set("filename", "relatorio.pdf");
    body.set("file", new Blob(["%PDF-1.4 teste"], { type: "application/pdf" }), "relatorio.pdf");
    return new Request("https://app.test", { method: "POST", body });
  };
  beforeEach(() => {
    mocks.dashboardAccess.mockResolvedValue({ agencyMode: true, workspaceRole: "editor", access: { agencyId: agency, client: { name: "Cliente" } }, user: { id: "u" } });
    mocks.sendReport.mockResolvedValue([{ name: "x", status: "accepted" }]);
  });
  it("restrito: bloqueia antes de enviar; liberado: envia", async () => {
    mocks.access.mockResolvedValue("restricted");
    expect((await sendReportRoute(form())).status).toBe(403);
    expect(mocks.sendReport).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue("allowed");
    expect((await sendReportRoute(form())).status).toBe(200);
    expect(mocks.sendReport).toHaveBeenCalledTimes(1);
  });
});

describe("geração de relatórios (novo) bloqueada; leitura dos existentes não passa pelo guard", () => {
  it("relatório do painel (PDF salvo): restrito não lê números, não consulta a Meta e não cria versão", async () => {
    mocks.dashboardAccess.mockResolvedValue({ canManageReports: true, access: { agencyId: agency }, supabase: { rpc: mocks.rpc } });
    mocks.access.mockResolvedValue("restricted");
    const input = { clientId, dateFrom: "2026-09-29", dateTo: "2026-10-02", accountIds: ["50000000-0000-4000-8000-000000000001"], metricKeys: ["spend"], header: { name: "iGrow", details: "" }, title: "Relatório" };
    const result = await generateDashboardReport(input);
    expect(result).toEqual({ error: PAID_OPERATION_RESTRICTED_MESSAGE });
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("relatório manual da agência: restrito devolve a mensagem antes de qualquer leitura/gravação", async () => {
    mocks.context.mockResolvedValue({ role: "owner", agency: { id: agency, timezone: "America/Sao_Paulo" }, user: { id: "u" }, supabase: { rpc: mocks.rpc } });
    mocks.access.mockResolvedValue("restricted");
    const result = await generateManualReport({ agencyId: agency, clientId, dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    // Dados inválidos para o esquema também terminam em erro, mas nunca chegam ao banco.
    expect("error" in result).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("sincronização com anúncios: atualização automática pausada em silêncio, manual explicada, nada coletado", () => {
  beforeEach(() => {
    mocks.dashboardAccess.mockResolvedValue({ canCollect: true, access: { agencyId: agency }, supabase: { rpc: mocks.rpc } });
  });
  it("restrito + automática (abrir o painel): sucesso 'pausado', sem consultar nem coletar", async () => {
    mocks.access.mockResolvedValue("restricted");
    const result = await collectDashboardData({ clientId, from: "2026-09-01", to: "2026-09-30", automatic: true });
    expect(result).toEqual({ success: true, insightCount: 0, paused: true });
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("restrito + manual: mensagem de acesso restrito", async () => {
    mocks.access.mockResolvedValue("restricted");
    expect(await collectDashboardData({ clientId, from: "2026-09-01", to: "2026-09-30" })).toEqual({ error: PAID_OPERATION_RESTRICTED_MESSAGE });
    expect(mocks.collect).not.toHaveBeenCalled();
  });
});
