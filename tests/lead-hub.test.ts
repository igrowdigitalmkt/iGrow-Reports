import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { addLeadNote, changeLeadStatus, findClientLead, loadLeadEvents, queryBoard, type Service } from "@/modules/lead-pages/hub-query";
import { fallbackFormName, filtersToQuery, parseFilters, periodStart, safeSearch, EMPTY_FILTERS } from "@/modules/lead-pages/hub-types";

type Row = Record<string, unknown>;

/** Banco em memória com só o que o módulo usa: select/eq/in/gte/order/limit/or/maybeSingle, insert e update. Guarda filtros e escritas. */
function fakeService(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; value: unknown; filters: unknown[] }[] = [];
  const orFilters: string[] = [];
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const log: unknown[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let max = Infinity;
    let count = false;
    let mode: "select" | "update" | "insert" = "select";
    let payload: unknown = null;
    const run = () => {
      let rows = (tables[table] ?? []).filter(row => filters.every(test => test(row)));
      if (order) { const { column, ascending } = order; rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1)); }
      return { rows, sliced: rows.slice(0, max) };
    };
    const builder: Record<string, unknown> = {
      select: (_columns?: string, options?: { count?: string }) => { if (options?.count) count = true; return builder; },
      eq: (column: string, value: unknown) => { log.push(["eq", column, value]); filters.push(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { log.push(["in", column, values]); filters.push(row => values.includes(row[column])); return builder; },
      gte: (column: string, value: string) => { log.push(["gte", column, value]); filters.push(row => String(row[column]) >= value); return builder; },
      or: (expression: string) => { orFilters.push(expression); return builder; },
      order: (column: string, options?: { ascending?: boolean }) => { order = { column, ascending: options?.ascending ?? true }; return builder; },
      limit: (n: number) => { max = n; return builder; },
      update: (value: unknown) => { mode = "update"; payload = value; return builder; },
      insert: (value: unknown) => { mode = "insert"; payload = value; writes.push({ table, op: "insert", value, filters: log }); return builder; },
      maybeSingle: async () => ({ data: run().rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (mode === "update") { writes.push({ table, op: "update", value: payload, filters: log }); return resolve({ data: null, error: null }); }
        if (mode === "insert") return resolve({ data: null, error: null });
        const { rows, sliced } = run();
        return resolve({ data: sliced, error: null, count: count ? rows.length : null });
      },
    };
    return builder;
  };
  return { service: { from } as unknown as Service, writes, orFilters };
}

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const lead = (id: string, over: Row = {}): Row => ({ id, lead_page_id: "page-1", name: `Lead ${id}`, phone: "+5586999990001", email: null, status: "new", status_changed_at: null, form_id: "100001", channel: "form", field_data: [], created_time: "2026-11-02T12:00:00.000Z", campaign_id: "50001", campaign_name: "Campanha Terras", adset_name: "Conjunto A", ad_name: "Anúncio 1", platform: "ig", ...over });
const tables = (): Record<string, Row[]> => ({
  lead_pages: [{ id: "page-1", client_id: CLIENT }, { id: "page-2", client_id: OTHER }],
  lead_forms: [{ lead_page_id: "page-1", form_id: "100001", name: "Terras Alphaville III" }],
  leads: [
    lead("a", { created_time: "2026-11-02T15:00:00.000Z" }),
    lead("b", { status: "won", form_id: "100002", created_time: "2026-11-01T15:00:00.000Z", campaign_id: "50002", campaign_name: "Campanha Bate-papo" }),
    lead("c", { status: "contacted", created_time: "2026-10-01T15:00:00.000Z" }),
    lead("z", { lead_page_id: "page-2", form_id: "100001" }),
  ],
  lead_events: [],
});
const NOW = new Date("2026-11-02T16:00:00.000Z");

describe("filtros do menu Leads", () => {
  it("lê só valores válidos e monta a query de volta", () => {
    const filters = parseFilters(new URLSearchParams("formulario=100001,abc&status=won,hack&busca=ana&periodo=7d"));
    expect(filters).toEqual({ forms: ["100001"], campaigns: [], status: ["won"], q: "ana", period: "7d" });
    expect(filtersToQuery(filters)).toBe("formulario=100001&status=won&busca=ana&periodo=7d");
    const withCampaign = parseFilters(new URLSearchParams("campanha=50001,xx"));
    expect(withCampaign.campaigns).toEqual(["50001"]);
    expect(filtersToQuery(withCampaign)).toBe("campanha=50001");
    expect(parseFilters({ periodo: "ontem" })).toEqual(EMPTY_FILTERS);
  });
  it("busca segura e início dos períodos em horário de Brasília", () => {
    expect(safeSearch(`ana,(x)%"y*`)).toBe("ana x y");
    expect(periodStart("today", NOW)).toBe("2026-11-02T03:00:00.000Z");
    expect(periodStart("7d", NOW)).toBe("2026-10-27T03:00:00.000Z");
    expect(periodStart("all", NOW)).toBeNull();
    expect(fallbackFormName("100001")).toBe("Formulário …0001");
  });
});

describe("painel de leads do cliente", () => {
  it("conta só os leads do cliente, por status e formulário, com nome do formulário", async () => {
    const { service } = fakeService(tables());
    const board = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null }, NOW);
    expect(board).toMatchObject({ total: 3, today: 1, matching: 3, statusCounts: { new: 1, contacted: 1, won: 1, visit: 0, lost: 0 } });
    expect(board!.leads.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(board!.forms).toEqual([{ id: "100001", name: "Terras Alphaville III", count: 2 }, { id: "100002", name: "Formulário …0002", count: 1 }]);
    expect(board!.leads.map(item => item.id)).not.toContain("z");
  });
  it("lista as campanhas com contagem, mostra a origem de cada lead e filtra por campanha", async () => {
    const { service } = fakeService(tables());
    const board = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null }, NOW);
    expect(board!.campaigns).toEqual([{ id: "50001", name: "Campanha Terras", count: 2 }, { id: "50002", name: "Campanha Bate-papo", count: 1 }]);
    expect(board!.leads[0]).toMatchObject({ campaignId: "50001", campaignName: "Campanha Terras", adsetName: "Conjunto A", adName: "Anúncio 1", platform: "ig" });
    const filtered = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null, filters: { ...EMPTY_FILTERS, campaigns: ["50002"] } }, NOW);
    expect(filtered!.leads.map(item => item.id)).toEqual(["b"]);
    expect(filtered!.campaigns).toHaveLength(2);
  });
  it("filtra por formulário, status e período", async () => {
    const { service } = fakeService(tables());
    const byForm = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null, filters: { ...EMPTY_FILTERS, forms: ["100002"] } }, NOW);
    expect(byForm!.leads.map(item => item.id)).toEqual(["b"]);
    const byStatus = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null, filters: { ...EMPTY_FILTERS, status: ["contacted"] } }, NOW);
    expect(byStatus!.leads.map(item => item.id)).toEqual(["c"]);
    const byPeriod = await queryBoard(service, { clientId: CLIENT, restrictFormIds: null, filters: { ...EMPTY_FILTERS, period: "7d" } }, NOW);
    expect(byPeriod!.leads.map(item => item.id)).toEqual(["a", "b"]);
    expect(byPeriod!.total).toBe(3);
  });
  it("link com escopo só enxerga os formulários permitidos, nas contagens e na lista, mesmo que o filtro peça outro", async () => {
    const { service } = fakeService(tables());
    const scoped = await queryBoard(service, { clientId: CLIENT, restrictFormIds: ["100001"], filters: { ...EMPTY_FILTERS, forms: ["100002"] } }, NOW);
    expect(scoped!.leads).toEqual([]);
    expect(scoped!.total).toBe(2);
    expect(scoped!.forms.map(form => form.id)).toEqual(["100001"]);
    const allowed = await queryBoard(service, { clientId: CLIENT, restrictFormIds: ["100001"] }, NOW);
    expect(allowed!.leads.map(item => item.id)).toEqual(["a", "c"]);
    expect(await queryBoard(service, { clientId: CLIENT, restrictFormIds: [] }, NOW)).toMatchObject({ total: 0, leads: [] });
  });
  it("cliente sem fonte de leads recebe painel vazio; a busca vira filtro seguro", async () => {
    const empty = fakeService(tables());
    expect(await queryBoard(empty.service, { clientId: "33333333-3333-4333-8333-333333333333", restrictFormIds: null }, NOW)).toMatchObject({ total: 0, leads: [] });
    const { service, orFilters } = fakeService(tables());
    await queryBoard(service, { clientId: CLIENT, restrictFormIds: null, filters: { ...EMPTY_FILTERS, q: "ana,(x)" } }, NOW);
    expect(orFilters).toEqual(["name.ilike.%ana x%,phone.ilike.%ana x%,email.ilike.%ana x%"]);
  });
});

describe("status e notas", () => {
  it("muda o status e registra no histórico; o mesmo status não gera evento", async () => {
    const { service, writes } = fakeService(tables());
    const base = { clientId: CLIENT, leadId: "a", restrictFormIds: null, actor: "Silvio", userId: null };
    expect(await changeLeadStatus(service, { ...base, status: "contacted" })).toBe("ok");
    expect(writes.map(write => `${write.table}:${write.op}`)).toEqual(["leads:update", "lead_events:insert"]);
    expect(writes[1]!.value).toMatchObject({ lead_id: "a", kind: "status", status: "contacted", actor: "Silvio" });
    const same = fakeService(tables());
    expect(await changeLeadStatus(same.service, { ...base, status: "new" })).toBe("same");
    expect(same.writes).toEqual([]);
  });
  it("nunca altera lead de outro cliente nem fora do escopo do link", async () => {
    const { service, writes } = fakeService(tables());
    expect(await changeLeadStatus(service, { clientId: CLIENT, leadId: "z", restrictFormIds: null, status: "won", actor: "x", userId: null })).toBe("not_found");
    expect(await changeLeadStatus(service, { clientId: CLIENT, leadId: "b", restrictFormIds: ["100001"], status: "won", actor: "x", userId: null })).toBe("not_found");
    expect(await addLeadNote(service, { clientId: CLIENT, leadId: "z", restrictFormIds: null, body: "oi", actor: "x", userId: null })).toBe("not_found");
    expect(await loadLeadEvents(service, { clientId: CLIENT, leadId: "z", restrictFormIds: null })).toBeNull();
    expect(await findClientLead(service, { clientId: CLIENT, leadId: "a", restrictFormIds: ["100001"] })).toMatchObject({ id: "a" });
    expect(writes).toEqual([]);
  });
  it("nota vazia ou longa demais é recusada; nota válida é gravada com o autor", async () => {
    const { service, writes } = fakeService(tables());
    const base = { clientId: CLIENT, leadId: "a", restrictFormIds: null, actor: "Link: Equipe", userId: null };
    expect(await addLeadNote(service, { ...base, body: "   " })).toBe("error");
    expect(await addLeadNote(service, { ...base, body: "x".repeat(2001) })).toBe("error");
    expect(await addLeadNote(service, { ...base, body: " Liguei, vai visitar sábado " })).toBe("ok");
    expect(writes[0]!.value).toMatchObject({ kind: "note", body: "Liguei, vai visitar sábado", actor: "Link: Equipe" });
  });
});
