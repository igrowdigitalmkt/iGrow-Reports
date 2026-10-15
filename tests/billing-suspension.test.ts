import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { executeAutomation, runDueAutomations, type SummaryGenerator } from "@/modules/automations/runner";
import { getAgencyBillingAccess, RESTRICTED_RUN_MESSAGE, UNVERIFIED_RETRY_WINDOW_MS, UNVERIFIED_RUN_MESSAGE } from "@/modules/billing/access";
import { parseAiEntitlement } from "@/modules/ai/guarded-text";
import type { MessageSender } from "@/modules/automations/sender";
import type { ReportAutomationRow } from "@/types/database";

type RestrictionAnswer = { data: unknown; error: { code?: string; message: string } | null };

function fakeService(tables: Record<string, unknown[]>, restriction: RestrictionAnswer | "throw" | (() => RestrictionAnswer)) {
  const updates: Record<string, Array<Record<string, unknown>>> = {};
  const rpcCalls: string[] = [];
  const builder = (table: string) => {
    let single = false;
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "report_automation_runs") return { data: { id: "run-1" }, error: null };
      const rows = tables[table] ?? [];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    for (const name of ["select", "eq", "in", "order", "limit", "lte"]) chain[name] = () => chain;
    chain.insert = () => chain;
    chain.update = (values: Record<string, unknown>) => { (updates[table] ??= []).push(values); return chain; };
    chain.single = () => { single = true; return chain; };
    chain.maybeSingle = () => { single = true; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  const rpc = async (name: string) => {
    rpcCalls.push(name);
    if (name !== "agency_billing_restricted") return { data: getDemoClientAnalytics(), error: null };
    if (restriction === "throw") throw new Error("rede");
    return typeof restriction === "function" ? restriction() : restriction;
  };
  return { service: { from: builder, rpc }, updates, rpcCalls };
}

const automation = {
  id: "auto-1", agency_id: "agency-1", client_id: "client-1", name: "Resumo", message_template: "Olá {{nome}}! Seu resumo.", period_key: "last_7d",
  frequency: "weekly", weekdays: [1], month_day: 1, send_time: "08:00:00", timezone: "America/Sao_Paulo", channel: "whatsapp",
  active: true, next_run_at: "2026-10-12T11:00:00.000Z", last_run_at: null, created_by: null, created_at: "", updated_at: "", sender: "qr", whatsapp_connection_id: null,
} as ReportAutomationRow;
const run = (trigger: "schedule" | "manual" = "schedule") => ({ scheduledFor: new Date("2026-10-12T11:00:00Z"), period: { dateFrom: "2026-10-05", dateTo: "2026-10-11" }, trigger });
const tables = {
  report_automation_targets: [{ recipient_id: "p1", group_id: null, group_name: null }],
  clients: [{ name: "Escola Horizonte", archived_at: null }],
  agencies: [{ name: "iGrow Digital" }],
  client_recipients: [{ id: "p1", name: "Maria Souza", phone: "+5586999990000", active: true, consent_status: "granted", unsubscribed_at: null }],
};
const channel = () => { const sendText = vi.fn(async () => ({ ok: true as const, messageId: "m1" })); const resolve = vi.fn(async () => ({ sendText } as MessageSender)); return { sendText, resolve }; };
const restricted: RestrictionAnswer = { data: true, error: null };
const inGoodStanding: RestrictionAnswer = { data: false, error: null };

describe("suspensão: nada é executado, nada é apagado", () => {
  it("execução agendada de organização restrita: registra como não realizada, sem ler números, sem IA e sem enviar", async () => {
    const { service, updates, rpcCalls } = fakeService(tables, restricted);
    const c = channel();
    const generateSummary = vi.fn<SummaryGenerator>();
    const outcome = await executeAutomation(service as never, automation, run(), { resolveSender: c.resolve, generateSummary, pause: () => 0 });
    expect(outcome).toMatchObject({ status: "skipped", sent: 0, failed: 0, message: RESTRICTED_RUN_MESSAGE.slice(0, 1000) });
    expect(c.sendText).not.toHaveBeenCalled();
    expect(c.resolve).not.toHaveBeenCalled();
    expect(generateSummary).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual(["agency_billing_restricted"]); // não leu os números do cliente
    expect(updates["report_automation_runs"].at(-1)).toMatchObject({ status: "skipped" });
    expect(Object.keys(updates)).toEqual(["report_automation_runs"]); // a automação, os destinatários e as configurações não foram tocados
  });
  it("envio manual e aprovação de texto também são barrados", async () => {
    for (const options of [{ trigger: "manual" as const }, { trigger: "schedule" as const, approval: { runId: "run-1", aiText: "texto" } }]) {
      const { service } = fakeService(tables, restricted);
      const c = channel();
      const outcome = await executeAutomation(service as never, automation, run(options.trigger), { resolveSender: c.resolve, pause: () => 0, ...("approval" in options ? { approval: options.approval } : {}) });
      expect(outcome).toMatchObject({ status: "skipped" });
      expect(c.sendText).not.toHaveBeenCalled();
    }
  });
  it("organização regularizada volta a enviar com as mesmas configurações", async () => {
    const { service } = fakeService(tables, inGoodStanding);
    const c = channel();
    const outcome = await executeAutomation(service as never, automation, run(), { resolveSender: c.resolve, pause: () => 0 });
    expect(outcome).toMatchObject({ status: "sent", sent: 1 });
    expect(c.sendText).toHaveBeenCalledTimes(1);
  });
  it("organização antiga sem plano continua enviando como hoje", async () => {
    const { service } = fakeService(tables, { data: false, error: null });
    const c = channel();
    expect(await executeAutomation(service as never, automation, run(), { resolveSender: c.resolve, pause: () => 0 })).toMatchObject({ status: "sent" });
  });
  it("antes da migration (função inexistente no banco) nenhuma organização pode ter assinatura: segue como hoje", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const { service } = fakeService(tables, { data: null, error: { code, message: "sem função" } });
      const c = channel();
      expect(await executeAutomation(service as never, automation, run(), { resolveSender: c.resolve, pause: () => 0 })).toMatchObject({ status: "sent" });
    }
  });
  it("estado financeiro indeterminado (falha da consulta, exceção ou resposta estranha): NÃO executa, registra falha temporária e nada é apagado", async () => {
    const cases: Array<RestrictionAnswer | "throw"> = [
      { data: null, error: { code: "XX000", message: "falha" } }, { data: null, error: { code: "57014", message: "timeout" } }, "throw",
      { data: null, error: null }, { data: "true", error: null }, { data: 1, error: null }, { data: {}, error: null },
    ];
    for (const answer of cases) {
      const { service, updates } = fakeService(tables, answer);
      const c = channel();
      const generateSummary = vi.fn<SummaryGenerator>();
      const outcome = await executeAutomation(service as never, automation, run(), { resolveSender: c.resolve, generateSummary, pause: () => 0 });
      expect(outcome).toMatchObject({ status: "failed", sent: 0, message: UNVERIFIED_RUN_MESSAGE.slice(0, 1000) });
      expect(c.sendText).not.toHaveBeenCalled();
      expect(c.resolve).not.toHaveBeenCalled();
      expect(generateSummary).not.toHaveBeenCalled();
      expect(Object.keys(updates)).toEqual(["report_automation_runs"]);
    }
  });
  it("classifica o estado: verdadeiro = restrito, falso = liberado, qualquer outra coisa = indeterminado", async () => {
    const state = (answer: RestrictionAnswer) => getAgencyBillingAccess(fakeService(tables, answer).service, "agency-1");
    expect(await state({ data: true, error: null })).toBe("restricted");
    expect(await state({ data: false, error: null })).toBe("allowed");
    for (const data of [null, undefined, "true", 1, 0, {}, []]) expect(await state({ data, error: null })).toBe("unknown");
    expect(await state({ data: null, error: { code: "PGRST202", message: "x" } })).toBe("allowed");
    expect(await state({ data: null, error: { code: "08006", message: "x" } })).toBe("unknown");
  });
});

describe("rotina de agendamentos durante a suspensão", () => {
  it("avança o próximo horário (não acumula nem refaz envios perdidos) e registra a execução como não realizada", async () => {
    const { service, updates } = fakeService({ ...tables, report_automations: [automation] }, restricted);
    const c = channel();
    const now = new Date("2026-10-12T11:05:00Z");
    const summary = await runDueAutomations(service as never, { resolveSender: c.resolve, pause: () => 0, now });
    expect(summary).toMatchObject({ due: 1, skipped: 1, sent: 0 });
    const advanced = updates["report_automations"][0] as { next_run_at: string };
    expect(new Date(advanced.next_run_at).getTime()).toBeGreaterThan(now.getTime());
    expect(c.sendText).not.toHaveBeenCalled();
  });
});

describe("rotina de agendamentos com estado financeiro indeterminado", () => {
  const now = new Date("2026-10-12T11:05:00Z");
  it("dentro da janela de espera o horário NÃO é consumido: sem envio, sem execução registrada, próxima rodada tenta de novo", async () => {
    const { service, updates } = fakeService({ ...tables, report_automations: [automation] }, { data: null, error: { code: "XX000", message: "falha" } });
    const c = channel();
    const summary = await runDueAutomations(service as never, { resolveSender: c.resolve, pause: () => 0, now });
    expect(summary).toMatchObject({ due: 1, unverified: 1, sent: 0, failed: 0 });
    expect(Object.keys(updates)).toEqual([]);
    expect(c.sendText).not.toHaveBeenCalled();
  });
  it("a verificação volta: a rodada seguinte executa normalmente (sem indisponibilidade permanente)", async () => {
    let healthy = false;
    const { service } = fakeService({ ...tables, report_automations: [automation] }, () => healthy ? { data: false, error: null } : { data: null, error: { code: "XX000", message: "falha" } });
    const c = channel();
    expect(await runDueAutomations(service as never, { resolveSender: c.resolve, pause: () => 0, now })).toMatchObject({ unverified: 1, sent: 0 });
    healthy = true;
    expect(await runDueAutomations(service as never, { resolveSender: c.resolve, pause: () => 0, now: new Date(now.getTime() + 5 * 60_000) })).toMatchObject({ unverified: 0, sent: 1 });
    expect(c.sendText).toHaveBeenCalledTimes(1);
  });
  it("passada a janela, o horário é registrado como falha temporária e descartado: nunca acumula nem é refeito", async () => {
    const late = new Date(new Date(automation.next_run_at!).getTime() + UNVERIFIED_RETRY_WINDOW_MS + 60_000);
    const { service, updates } = fakeService({ ...tables, report_automations: [automation] }, { data: null, error: { code: "XX000", message: "falha" } });
    const c = channel();
    const summary = await runDueAutomations(service as never, { resolveSender: c.resolve, pause: () => 0, now: late });
    expect(summary).toMatchObject({ due: 1, failed: 1, unverified: 0 });
    expect(c.sendText).not.toHaveBeenCalled();
    expect(new Date((updates["report_automations"][0] as { next_run_at: string }).next_run_at).getTime()).toBeGreaterThan(late.getTime());
    expect(updates["report_automation_runs"].at(-1)).toMatchObject({ status: "failed" });
  });
  it("organização antiga sem plano (resposta falsa) e restrita (verdadeira) seguem seus caminhos normais", async () => {
    const c = channel();
    expect(await runDueAutomations(fakeService({ ...tables, report_automations: [automation] }, { data: false, error: null }).service as never, { resolveSender: c.resolve, pause: () => 0, now })).toMatchObject({ sent: 1, unverified: 0 });
    expect(await runDueAutomations(fakeService({ ...tables, report_automations: [automation] }, { data: true, error: null }).service as never, { resolveSender: c.resolve, pause: () => 0, now })).toMatchObject({ skipped: 1, unverified: 0 });
  });
});

describe("IA durante a restrição", () => {
  it("o direito da IA informa quando a causa é a restrição financeira", () => {
    expect(parseAiEntitlement({ allowed: false, restricted: true, budget_usd: 0 })).toEqual({ allowed: false, restricted: true, budgetUsd: 0 });
    expect(parseAiEntitlement({ allowed: false, budget_usd: null })).toEqual({ allowed: false, restricted: false, budgetUsd: null });
    expect(parseAiEntitlement({ allowed: true, restricted: "sim" })).toMatchObject({ restricted: false });
    expect(parseAiEntitlement({ restricted: true })).toBeNull();
  });
});
