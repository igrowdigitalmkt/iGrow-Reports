import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/whatsapp-qr/server", () => ({ createQrSender: vi.fn(async () => null), getQrStatus: vi.fn(async () => ({ configured: true, state: "connected" })) }));

import { notifyNewLead, optOutAlertRecipients, runDueLeadAlerts, sendAlertTest } from "@/modules/lead-pages/alerts-send";
import type { Service } from "@/modules/lead-pages/hub-query";
import type { MessageSender } from "@/modules/automations/sender";

type Row = Record<string, unknown>;

/** Banco em memória com as consultas dos alertas e as duas restrições únicas dos envios. */
function fakeService(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { lead_pages: [], leads: [], lead_forms: [], clients: [], lead_alert_recipients: [], lead_alert_deliveries: [], ...structuredClone(seed) };
  let counter = 0;
  const from = (table: string) => {
    const tests: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let max = Infinity;
    let sort: { column: string; ascending: boolean } | null = null;
    let returning = false;
    const rows = () => { let list = (tables[table] ?? []).filter(row => tests.every(test => test(row))); if (sort) { const { column, ascending } = sort; list = [...list].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1)); } return list.slice(0, max); };
    const unique = (row: Row) => table === "lead_alert_deliveries" && (tables[table] ?? []).some(other =>
      (row.kind === "instant" && other.kind === "instant" && other.recipient_id === row.recipient_id && other.lead_id === row.lead_id)
      || (row.kind === "digest" && other.kind === "digest" && other.recipient_id === row.recipient_id && other.slot === row.slot));
    const run = () => {
      if (mode === "insert") {
        const row = { id: `${table}-${++counter}`, created_at: "2026-11-05T13:00:00.000Z", ...payload };
        if (unique(row)) return { data: null, error: { code: "23505" } };
        tables[table] = [...(tables[table] ?? []), row];
        return { data: returning ? [row] : null, error: null };
      }
      if (mode === "update") { const hit = rows(); hit.forEach(row => Object.assign(row, payload)); return { data: returning ? hit.map(row => ({ id: row.id })) : null, error: null }; }
      return { data: rows(), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => { returning = true; return builder; },
      insert: (value: Row) => { mode = "insert"; payload = value; returning = false; return builder; },
      update: (value: Row) => { mode = "update"; payload = value; returning = false; return builder; },
      eq: (column: string, value: unknown) => { tests.push(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { tests.push(row => values.includes(row[column])); return builder; },
      gt: (column: string, value: string) => { tests.push(row => String(row[column]) > value); return builder; },
      gte: (column: string, value: string) => { tests.push(row => String(row[column]) >= value); return builder; },
      lte: (column: string, value: string) => { tests.push(row => String(row[column]) <= value); return builder; },
      is: (column: string, value: null) => { tests.push(row => (row[column] ?? null) === value); return builder; },
      order: (column: string, options?: { ascending?: boolean }) => { sort = { column, ascending: options?.ascending ?? true }; return builder; },
      limit: (n: number) => { max = n; return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => { const result = run(); return mode === "insert" ? { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error } : { data: rows()[0] ?? null, error: null }; },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { service: { from } as unknown as Service, tables };
}

const NOW = new Date("2026-11-05T13:00:00.000Z"); // 10:00 em Brasília
const AGENCY = "ag-1";
const CLIENT = "cl-1";
const recipient = (over: Row = {}): Row => ({ id: "r1", agency_id: AGENCY, client_id: CLIENT, name: "Silvio Teste", phone: "+5591980748371", mode: "instant", send_times: [], weekdays: [0, 1, 2, 3, 4, 5, 6], timezone: "America/Sao_Paulo",
  campaign_ids: null, form_ids: null, active: true, opted_out_at: null, removed_at: null, last_digest_at: null, created_at: "2026-11-04T00:00:00.000Z", ...over });
const lead = (over: Row = {}): Row => ({ id: "lead-1", lead_page_id: "p1", name: "Eduardo Melo", phone: "+5586995560428", email: null, form_id: "100001", field_data: [], created_time: "2026-11-05T12:40:00.000Z",
  campaign_id: "50001", campaign_name: "Terras Alphaville III", adset_name: "Público A", ad_name: "Vídeo 1", platform: "ig", ...over });
const base = (): Record<string, Row[]> => ({
  lead_pages: [{ id: "p1", agency_id: AGENCY, client_id: CLIENT }], clients: [{ id: CLIENT, name: "RM Imobiliária" }], lead_forms: [{ lead_page_id: "p1", form_id: "100001", name: "Terras Alphaville III" }],
  leads: [lead()], lead_alert_recipients: [recipient()],
});

function fakeSender(fail = false) {
  const sent: { phone: string; text: string }[] = [];
  const sender: MessageSender = { async sendText(destination, text) { if (fail) return { ok: false, error: "o WhatsApp não aceitou a mensagem" }; sent.push({ phone: destination.kind === "phone" ? destination.phone : "", text }); return { ok: true, messageId: "m1" }; } };
  return { sender, sent };
}
const options = (sender: MessageSender | null) => ({ resolveSender: async () => sender, now: NOW, pause: () => 0 });

describe("alerta instantâneo de lead novo", () => {
  it("avisa quem está configurado, no número cadastrado, e registra o envio", async () => {
    const { service, tables } = fakeService(base());
    const { sender, sent } = fakeSender();
    expect(await notifyNewLead(service, "lead-1", options(sender))).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe("+5591980748371");
    expect(sent[0]!.text).toContain("Eduardo Melo");
    expect(sent[0]!.text).toContain("RM Imobiliária");
    expect(tables.lead_alert_deliveries[0]).toMatchObject({ recipient_id: "r1", lead_id: "lead-1", kind: "instant", status: "sent", error: null });
  });
  it("o mesmo lead nunca gera dois avisos para a mesma pessoa (webhook repetido)", async () => {
    const { service } = fakeService(base());
    const { sender, sent } = fakeSender();
    await notifyNewLead(service, "lead-1", options(sender));
    expect(await notifyNewLead(service, "lead-1", options(sender))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });
  it("respeita filtros, pausa, PARAR, remoção e o modo em horários", async () => {
    const seed = base();
    seed.lead_alert_recipients = [
      recipient({ id: "ok", name: "Recebe" }), recipient({ id: "camp", name: "Outra campanha", phone: "+5591911110001", campaign_ids: ["50002"] }), recipient({ id: "same", name: "Mesma campanha", phone: "+5591911110002", campaign_ids: ["50001"] }),
      recipient({ id: "form", name: "Outro formulário", phone: "+5591911110003", form_ids: ["100002"] }), recipient({ id: "off", name: "Pausado", phone: "+5591911110004", active: false }),
      recipient({ id: "stop", name: "Parou", phone: "+5591911110005", opted_out_at: "2026-11-05T00:00:00Z" }), recipient({ id: "gone", name: "Removido", phone: "+5591911110006", removed_at: "2026-11-05T00:00:00Z" }),
      recipient({ id: "digest", name: "Resumo", phone: "+5591911110007", mode: "scheduled", send_times: ["18:00"] }),
    ];
    const { service } = fakeService(seed);
    const { sender, sent } = fakeSender();
    await notifyNewLead(service, "lead-1", options(sender));
    expect(sent.map(item => item.phone).sort()).toEqual(["+5591911110002", "+5591980748371"]);
  });
  it("lead antigo (achado depois na conferência com a Meta) não dispara aviso", async () => {
    const seed = base();
    seed.leads = [lead({ created_time: "2026-11-05T09:00:00.000Z" })];
    const { service, tables } = fakeService(seed);
    const { sender, sent } = fakeSender();
    expect(await notifyNewLead(service, "lead-1", options(sender))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toEqual([]);
    expect(tables.lead_alert_deliveries).toEqual([]);
  });
  it("sem o WhatsApp da Groow conectado, registra a falha com o motivo e não perde o histórico", async () => {
    const { service, tables } = fakeService(base());
    expect(await notifyNewLead(service, "lead-1", options(null))).toEqual({ sent: 0, failed: 1 });
    expect(tables.lead_alert_deliveries[0]).toMatchObject({ status: "failed" });
    expect(String(tables.lead_alert_deliveries[0]!.error)).toContain("não está conectado");
    const failing = fakeSender(true);
    const second = fakeService(base());
    expect(await notifyNewLead(second.service, "lead-1", options(failing.sender))).toEqual({ sent: 0, failed: 1 });
  });
});

describe("resumo em horários fixos", () => {
  const scheduled = (over: Row = {}): Row => recipient({ id: "d1", mode: "scheduled", send_times: ["09:00", "18:00"], weekdays: [1, 2, 3, 4, 5], ...over });
  it("às 09:00 envia um resumo com os leads novos desde o último e avança a data", async () => {
    const seed = base();
    seed.lead_alert_recipients = [scheduled()];
    seed.leads = [lead({ id: "a", name: "Ana", created_time: "2026-11-05T11:00:00.000Z" }), lead({ id: "b", name: "Bruno", created_time: "2026-11-05T12:10:00.000Z" }), lead({ id: "old", name: "Antigo", created_time: "2026-11-03T12:00:00.000Z" })];
    const { service, tables } = fakeService(seed);
    const { sender, sent } = fakeSender();
    const summary = await runDueLeadAlerts(service, options(sender));
    expect(summary).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(sent[0]!.text).toContain("2 leads novos");
    expect(sent[0]!.text).toContain("Ana");
    expect(sent[0]!.text).toContain("Bruno");
    expect(sent[0]!.text).not.toContain("Antigo");
    expect(tables.lead_alert_deliveries[0]).toMatchObject({ kind: "digest", slot: "2026-11-05 09:00", status: "sent", lead_count: 2 });
    expect(tables.lead_alert_recipients[0]!.last_digest_at).toBe(NOW.toISOString());
  });
  it("o mesmo horário não envia duas vezes, mesmo se o agendador rodar de novo", async () => {
    const seed = base();
    seed.lead_alert_recipients = [scheduled()];
    const { service } = fakeService(seed);
    const { sender, sent } = fakeSender();
    await runDueLeadAlerts(service, options(sender));
    await runDueLeadAlerts(service, options(sender));
    expect(sent).toHaveLength(1);
  });
  it("sem leads novos não manda mensagem (registra como sem leads) e respeita filtro de campanha", async () => {
    const seed = base();
    seed.lead_alert_recipients = [scheduled({ campaign_ids: ["50002"] })];
    const { service, tables } = fakeService(seed);
    const { sender, sent } = fakeSender();
    expect(await runDueLeadAlerts(service, options(sender))).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent).toEqual([]);
    expect(tables.lead_alert_deliveries[0]).toMatchObject({ status: "skipped", lead_count: 0 });
  });
  it("se o envio falhar, a data do resumo não avança: os leads entram no próximo horário", async () => {
    const seed = base();
    seed.lead_alert_recipients = [scheduled()];
    const { service, tables } = fakeService(seed);
    expect(await runDueLeadAlerts(service, options(null))).toMatchObject({ failed: 1 });
    expect(tables.lead_alert_recipients[0]!.last_digest_at).toBeNull();
  });
  it("fora do horário, em dia não escolhido ou pausado, nada é enviado", async () => {
    const seed = base();
    seed.lead_alert_recipients = [scheduled({ weekdays: [0, 6] }), scheduled({ id: "d2", phone: "+5591911110009", active: false }), scheduled({ id: "d3", phone: "+5591911110008", send_times: ["15:00"] })];
    const { service } = fakeService(seed);
    const { sender, sent } = fakeSender();
    expect(await runDueLeadAlerts(service, options(sender))).toMatchObject({ checked: 0, sent: 0 });
    expect(sent).toEqual([]);
  });
});

describe("teste e PARAR", () => {
  it("envia o teste para o número cadastrado e limita a um por minuto", async () => {
    const { service, tables } = fakeService(base());
    const { sender, sent } = fakeSender();
    expect(await sendAlertTest(service, { recipientId: "r1", clientId: CLIENT, resolveSender: async () => sender, now: NOW })).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({ phone: "+5591980748371" });
    expect(sent[0]!.text).toContain("Teste de alerta");
    expect(tables.lead_alert_deliveries[0]).toMatchObject({ kind: "test", status: "sent" });
    const again = await sendAlertTest(service, { recipientId: "r1", clientId: CLIENT, resolveSender: async () => sender, now: new Date(NOW.getTime() + 1000) });
    expect(again).toMatchObject({ ok: false });
    expect(sent).toHaveLength(1);
  });
  it("teste de pessoa de outro cliente, inexistente ou que pediu para parar é recusado", async () => {
    const seed = base();
    seed.lead_alert_recipients = [recipient(), recipient({ id: "stop", phone: "+5591911110005", opted_out_at: "2026-11-05T00:00:00Z" })];
    const { service } = fakeService(seed);
    const { sender, sent } = fakeSender();
    expect(await sendAlertTest(service, { recipientId: "r1", clientId: "outro-cliente", resolveSender: async () => sender, now: NOW })).toMatchObject({ ok: false });
    expect(await sendAlertTest(service, { recipientId: "stop", clientId: CLIENT, resolveSender: async () => sender, now: NOW })).toMatchObject({ ok: false });
    expect(sent).toEqual([]);
  });
  it("PARAR desativa os alertas daquele número na organização", async () => {
    const seed = base();
    seed.lead_alert_recipients = [recipient(), recipient({ id: "other", agency_id: "ag-2", phone: "+5591980748371" }), recipient({ id: "different", phone: "+5591911110001" })];
    const { service, tables } = fakeService(seed);
    expect(await optOutAlertRecipients(service, AGENCY, "+5591980748371")).toBe(1);
    expect(tables.lead_alert_recipients.find(item => item.id === "r1")).toMatchObject({ active: false });
    expect(tables.lead_alert_recipients.find(item => item.id === "r1")!.opted_out_at).toBeTruthy();
    expect(tables.lead_alert_recipients.find(item => item.id === "other")!.opted_out_at).toBeNull();
    expect(tables.lead_alert_recipients.find(item => item.id === "different")!.opted_out_at).toBeNull();
  });
});

beforeEach(() => { vi.clearAllMocks(); });
