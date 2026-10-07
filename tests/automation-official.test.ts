import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { buildPeriodPdf, PeriodPdfUnavailableError } from "@/modules/automations/period-pdf";
import { executeAutomation, type OfficialPdfSender } from "@/modules/automations/runner";
import type { ReportAutomationRow } from "@/types/database";

describe("buildPeriodPdf", () => {
  it("gera o PDF do período no servidor, com nome e período", async () => {
    const data = getDemoClientAnalytics();
    const pdf = buildPeriodPdf({ clientName: "Escola Horizonte", workspaceName: "iGrow Digital", data });
    expect(pdf.filename).toBe(`Escola-Horizonte-${data.dateFrom}-${data.dateTo}.pdf`);
    expect(pdf.period).toMatch(/^\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/);
    const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("recusa período sem dados completos", () => {
    const data = getDemoClientAnalytics();
    expect(() => buildPeriodPdf({ clientName: "A", workspaceName: "B", data: { ...data, coverage: { ...data.coverage, status: "partial" } } })).toThrow(PeriodPdfUnavailableError);
  });
});

// Minimal stand-in for the Supabase client: every query resolves to the rows given per table.
function fakeService(tables: Record<string, unknown[]>, analytics: unknown) {
  const runs: Array<Record<string, unknown>> = [];
  const builder = (table: string) => {
    let single = false;
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === "report_automation_runs") return { data: { id: "run-1" }, error: null };
      const rows = tables[table] ?? [];
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    for (const name of ["select", "eq", "in", "order", "limit"]) chain[name] = () => chain;
    chain.insert = () => chain;
    chain.update = (values: Record<string, unknown>) => { if (table === "report_automation_runs") runs.push(values); return chain; };
    chain.single = () => { single = true; return chain; };
    chain.maybeSingle = () => { single = true; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  return { service: { from: builder, rpc: async () => ({ data: analytics, error: null }) }, runs };
}

const automation = {
  id: "auto-1", agency_id: "agency-1", client_id: "client-1", name: "PDF semanal", message_template: "x", period_key: "last_7d",
  frequency: "weekly", weekdays: [1], month_day: 1, send_time: "08:00:00", timezone: "America/Sao_Paulo", channel: "whatsapp",
  active: true, next_run_at: null, last_run_at: null, created_by: null, created_at: "", updated_at: "", sender: "official", whatsapp_connection_id: "number-1",
} as ReportAutomationRow;
const run = { scheduledFor: new Date("2026-10-08T11:00:00Z"), period: { dateFrom: "2026-10-01", dateTo: "2026-10-07" }, trigger: "schedule" as const };
const tables = {
  report_automation_targets: [{ recipient_id: "p1", group_id: null, group_name: null }, { recipient_id: null, group_id: "1@g.us", group_name: "Diretoria" }],
  clients: [{ name: "Escola Horizonte", archived_at: null }],
  agencies: [{ name: "iGrow Digital" }],
  client_recipients: [{ id: "p1", name: "Maria Souza", phone: "+5586999990000", active: true, consent_status: "granted", unsubscribed_at: null }],
};

describe("agendamento pelo número oficial", () => {
  it("envia o PDF só para pessoas, pelo número escolhido, e registra o resultado", async () => {
    const { service, runs } = fakeService(tables, getDemoClientAnalytics());
    const sendOfficialPdf = vi.fn<OfficialPdfSender>(async input => ({ results: input.recipients.map(person => ({ name: person.name, status: "accepted" as const })), summary: "PDF enviado" }));
    const resolveSender = vi.fn(async () => null);
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender, sendOfficialPdf });
    expect(resolveSender).not.toHaveBeenCalled();
    expect(sendOfficialPdf).toHaveBeenCalledOnce();
    const input = sendOfficialPdf.mock.calls[0][0];
    expect(input).toMatchObject({ connectionId: "number-1", clientName: "Escola Horizonte", workspaceName: "iGrow Digital", runId: "run-1" });
    expect(input.recipients.map(person => person.id)).toEqual(["p1"]);
    expect(outcome).toMatchObject({ status: "sent", sent: 1, failed: 0 });
    expect(runs.at(-1)).toMatchObject({ status: "sent", sent_count: 1, message_text: "PDF enviado" });
  });

  it("sem número (removido) não envia e explica", async () => {
    const { service } = fakeService(tables, getDemoClientAnalytics());
    const sendOfficialPdf = vi.fn<OfficialPdfSender>();
    const outcome = await executeAutomation(service as never, { ...automation, whatsapp_connection_id: null }, run, { resolveSender: async () => null, sendOfficialPdf });
    expect(sendOfficialPdf).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "skipped" });
    expect(outcome?.message).toMatch(/removido/);
  });

  it("falha de configuração (mensagem modelo) aparece com a explicação", async () => {
    const { service } = fakeService(tables, getDemoClientAnalytics());
    const error = Object.assign(new Error("A mensagem modelo escolhida não está mais aprovada."), { name: "WhatsAppSetupError" });
    const outcome = await executeAutomation(service as never, automation, run, { resolveSender: async () => null, sendOfficialPdf: async () => { throw error; } });
    expect(outcome).toMatchObject({ status: "failed", message: "A mensagem modelo escolhida não está mais aprovada." });
  });
});
