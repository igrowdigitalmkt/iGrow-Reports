import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { executeAutomation, type SummaryGenerator } from "@/modules/automations/runner";
import { messageValues, usedVariables } from "@/modules/automations/message";
import type { MessageSender } from "@/modules/automations/sender";
import type { ReportAutomationRow } from "@/types/database";

function fakeService(tables: Record<string, unknown[]>, analytics: unknown, claimable = true) {
  const updates: Array<Record<string, unknown>> = [];
  const builder = (table: string) => {
    let single = false;
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "report_automation_runs") return { data: claimable ? { id: "run-1" } : null, error: null };
      const rows = tables[table] ?? [];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    for (const name of ["select", "eq", "in", "order", "limit"]) chain[name] = () => chain;
    chain.insert = () => chain;
    chain.update = (values: Record<string, unknown>) => { if (table === "report_automation_runs") updates.push(values); return chain; };
    chain.single = () => { single = true; return chain; };
    chain.maybeSingle = () => { single = true; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  return { service: { from: builder, rpc: async () => ({ data: analytics, error: null }) }, updates };
}

const automation = {
  id: "auto-1", agency_id: "agency-1", client_id: "client-1", name: "Resumo", message_template: "Olá {{nome}}!\n{{analise_ia}}", period_key: "last_7d",
  frequency: "weekly", weekdays: [1], month_day: 1, send_time: "08:00:00", timezone: "America/Sao_Paulo", channel: "whatsapp",
  active: true, next_run_at: null, last_run_at: null, created_by: null, created_at: "", updated_at: "", sender: "qr", whatsapp_connection_id: null,
} as ReportAutomationRow;
const run = { scheduledFor: new Date("2026-10-08T11:00:00Z"), period: { dateFrom: "2026-10-01", dateTo: "2026-10-07" }, trigger: "schedule" as const };
const tables = {
  report_automation_targets: [{ recipient_id: "p1", group_id: null, group_name: null }],
  clients: [{ name: "Escola Horizonte", archived_at: null }],
  agencies: [{ name: "iGrow Digital" }],
  client_recipients: [{ id: "p1", name: "Maria Souza", phone: "+5586999990000", active: true, consent_status: "granted", unsubscribed_at: null }],
};
const sender = () => { const sendText = vi.fn(async () => ({ ok: true as const, messageId: "m1" })); return { sendText, resolve: async () => ({ sendText } as MessageSender) }; };

describe("variável {{analise_ia}}", () => {
  it("é reconhecida e mostra um aviso na prévia", () => {
    expect(usedVariables("a {{analise_ia}}")).toContain("analise_ia");
    expect(messageValues({ clientName: "A", workspaceName: null, data: getDemoClientAnalytics(), recipientName: "B" }).analise_ia).toMatch(/aprovação/);
  });
});

describe("envio com análise da IA", () => {
  it("escreve o texto, segura o envio e espera a aprovação", async () => {
    const { service, updates } = fakeService(tables, getDemoClientAnalytics());
    const channel = sender();
    const generateSummary = vi.fn<SummaryGenerator>(async () => ({ ok: true, text: "Texto da IA.", costUsd: 0.01 }));
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender: channel.resolve, generateSummary, pause: () => 0 });
    expect(outcome).toMatchObject({ status: "awaiting_approval", sent: 0, runId: "run-1" });
    expect(channel.sendText).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: "awaiting_approval", ai_text: "Texto da IA." });
    expect(String(updates.at(-1)?.message_text)).toContain("Texto da IA.");
  });

  it("se a IA falha, nada é enviado e o motivo fica registrado", async () => {
    const { service, updates } = fakeService(tables, getDemoClientAnalytics());
    const channel = sender();
    const generateSummary = vi.fn<SummaryGenerator>(async () => ({ ok: false, reason: "budget", message: "O orçamento mensal de IA desta organização foi atingido." }));
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender: channel.resolve, generateSummary, pause: () => 0 });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(channel.sendText).not.toHaveBeenCalled();
    expect(String(updates.at(-1)?.error_message)).toContain("orçamento");
  });

  it("depois da aprovação envia o texto aprovado, sem gerar de novo", async () => {
    const { service, updates } = fakeService(tables, getDemoClientAnalytics());
    const channel = sender();
    const generateSummary = vi.fn<SummaryGenerator>();
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender: channel.resolve, generateSummary, pause: () => 0, approval: { runId: "run-1", aiText: "Texto revisado." } });
    expect(generateSummary).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "sent", sent: 1 });
    expect(channel.sendText).toHaveBeenCalledOnce();
    expect(String((channel.sendText.mock.calls[0] as unknown[])[1])).toContain("Texto revisado.");
    expect(updates[0]).toMatchObject({ status: "running", ai_text: "Texto revisado." });
  });

  it("uma segunda aprovação da mesma execução não envia nada", async () => {
    const { service } = fakeService(tables, getDemoClientAnalytics(), false);
    const channel = sender();
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender: channel.resolve, pause: () => 0, approval: { runId: "run-1", aiText: "x" } });
    expect(outcome).toBeNull();
    expect(channel.sendText).not.toHaveBeenCalled();
  });
});

describe("contas separadas", () => {
  const demo = getDemoClientAnalytics();
  it("renderSeparatedMessage repete só o miolo com números, com o nome de cada conta", async () => {
    const { renderSeparatedMessage } = await import("@/modules/automations/message");
    const template = "Olá, {{nome}}!\n\nResumo de {{cliente}}:\n\nInvestimento: {{investimento}}\n\nQualquer dúvida, chame.";
    const text = renderSeparatedMessage(template, { clientName: "RM", recipientName: "Maria" }, [
      { name: "Conta Ronaldo", data: { ...demo, summary: { ...demo.summary, spend: 100 } } },
      { name: "Conta Imobiliária", data: { ...demo, summary: { ...demo.summary, spend: 200 } } },
    ]);
    expect(text.match(/Olá, Maria!/g)).toHaveLength(1);
    expect(text.match(/Qualquer dúvida/g)).toHaveLength(1);
    expect(text).toContain("Conta: Conta Ronaldo");
    expect(text).toMatch(/Conta Ronaldo\*\nInvestimento: R\$\s100,00/);
    expect(text).toMatch(/Conta Imobiliária\*\nInvestimento: R\$\s200,00/);
  });

  it("por padrão o envio usa um bloco por conta e consolidar volta ao total único", async () => {
    const run2 = { ...run };
    const separated = fakeService(tables, demo); const ch1 = sender();
    await executeAutomation(separated.service as never, { ...automation, message_template: "Investimento: {{investimento}}" } as ReportAutomationRow, run2, { resolveSender: ch1.resolve, pause: () => 0, approval: { runId: "run-1", aiText: "x" } });
    expect(String((ch1.sendText.mock.calls[0] as unknown[])[1])).toContain("Conta:");
    const merged = fakeService(tables, demo); const ch2 = sender();
    await executeAutomation(merged.service as never, { ...automation, message_template: "Investimento: {{investimento}}", consolidate_accounts: true } as ReportAutomationRow, run2, { resolveSender: ch2.resolve, pause: () => 0, approval: { runId: "run-1", aiText: "x" } });
    expect(String((ch2.sendText.mock.calls[0] as unknown[])[1])).not.toContain("Conta:");
  });
});

describe("conta sem investimento", () => {
  it("vira uma linha curta com o saldo, sem zeros", async () => {
    const { renderSeparatedMessage } = await import("@/modules/automations/message");
    const demo = getDemoClientAnalytics();
    const text = renderSeparatedMessage("Resumo\n\nInvestimento: {{investimento}}\nSaldo: {{saldo}}", { clientName: "RM" }, [
      { name: "Parada", data: { ...demo, summary: { ...demo.summary, spend: 0 } }, balance: { funds: 387.94, currency: "BRL", postpaid: false, due: false } },
      { name: "Ativa", data: demo },
    ]);
    expect(text).toMatch(/Conta: Parada\*\nSem investimento neste período\.\n🏦 Saldo disponível: R\$\s387,94/);
    expect(text).not.toMatch(/Parada\*[\s\S]*Investimento: R\$\s0,00/);
  });
});

describe("mais de uma plataforma", () => {
  it("cada plataforma ganha o seu título e as contas ficam sob ela", async () => {
    const { renderSeparatedMessage } = await import("@/modules/automations/message");
    const demo = getDemoClientAnalytics();
    const text = renderSeparatedMessage("Resumo\n\nInvestimento: {{investimento}}", { clientName: "RM" }, [
      { name: "Conta A", platform: "Meta Ads", data: demo },
      { name: "Conta B", platform: "Meta Ads", data: demo },
      { name: "Conta G", platform: "Google Ads", data: demo },
    ]);
    expect(text.match(/\*Meta Ads\*/g)).toHaveLength(1);
    expect(text.match(/\*Google Ads\*/g)).toHaveLength(1);
    expect(text.indexOf("*Meta Ads*")).toBeLessThan(text.indexOf("Conta: Conta A"));
    expect(text.indexOf("Conta: Conta B")).toBeLessThan(text.indexOf("*Google Ads*"));
  });
  it("com uma só plataforma não repete o título", async () => {
    const { renderSeparatedMessage } = await import("@/modules/automations/message");
    const demo = getDemoClientAnalytics();
    const text = renderSeparatedMessage("Resumo\n\nInvestimento: {{investimento}}", { clientName: "RM" }, [
      { name: "A", platform: "Meta Ads", data: demo }, { name: "B", platform: "Meta Ads", data: demo },
    ]);
    expect(text).not.toContain("*Meta Ads*");
  });
});

describe("cliente com Meta e Google", () => {
  const demo = getDemoClientAnalytics();
  const google = { sections: [{ id: "g1", name: "Conta Google", data: demo }], failures: [] };
  it("a mensagem traz um título por plataforma e o bloco da conta do Google", async () => {
    const { service } = fakeService(tables, demo); const ch = sender();
    await executeAutomation(service as never, { ...automation, message_template: "Olá!\n\nInvestimento: {{investimento}}" } as ReportAutomationRow, run, {
      resolveSender: ch.resolve, pause: () => 0, approval: { runId: "run-1", aiText: "x" }, loadGoogle: async () => google as never,
    });
    const text = String((ch.sendText.mock.calls[0] as unknown[])[1]);
    expect(text).toContain("*Meta Ads*");
    expect(text).toContain("*Google Ads*");
    expect(text).toContain("Conta: Conta Google");
    expect(text.indexOf("*Meta Ads*")).toBeLessThan(text.indexOf("*Google Ads*"));
  });
  it("conta do Google com falha vira um aviso e o resto do relatório sai", async () => {
    const { service } = fakeService(tables, demo); const ch = sender();
    await executeAutomation(service as never, { ...automation, message_template: "Investimento: {{investimento}}" } as ReportAutomationRow, run, {
      resolveSender: ch.resolve, pause: () => 0, approval: { runId: "run-1", aiText: "x" }, loadGoogle: async () => ({ sections: [], failures: [{ name: "Conta Quebrada", message: "x" }] }) as never,
    });
    const text = String((ch.sendText.mock.calls[0] as unknown[])[1]);
    expect(text).toContain("Investimento:");
    expect(text).toContain("Não foi possível ler o Google Ads agora (Conta Quebrada)");
  });
});
