import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ statuses: vi.fn(), rpc: vi.fn() }));
vi.mock("@/modules/client-portal/analytics-live", () => ({ getFreshClientAnalytics: vi.fn() }));
vi.mock("@/modules/meta/server", () => ({ getMetaEntityStatuses: mocks.statuses }));
import { loadClientHierarchy } from "@/modules/client-portal/analytics-hierarchy-loader";
import type { LiveReadReport } from "@/modules/meta/server";

const accountId = "eca7861e-9817-4456-8758-432c747e45e6";
const analytics = { coverage: { status: "complete" }, metaAggregate: { confirmed: true }, metrics: [], accounts: [{ id: accountId, name: "Conta", currency: "BRL" }] };
const base = { supabase: { rpc: mocks.rpc } as never, agencyId: "a", clientId: "c", dateFrom: "2026-09-03", dateTo: "2026-10-02", accountIds: [accountId], analytics: analytics as never };
const catalog = (): LiveReadReport["entities"] => [
  { accountId, level: "campaign", id: "1", name: "Com gasto", parentId: null, campaignId: "1" },
  { accountId, level: "adset", id: "10", name: "Conjunto com dado", parentId: "1", campaignId: "1" },
  { accountId, level: "adset", id: "11", name: "Conjunto sem linha", parentId: "1", campaignId: "1" },
  { accountId, level: "campaign", id: "2", name: "Pausada sem gasto", parentId: null, campaignId: "2" },
  { accountId, level: "adset", id: "20", name: "Conjunto da pausada", parentId: "2", campaignId: "2" },
  { accountId, level: "ad", id: "200", name: "Anúncio da pausada", parentId: "20", campaignId: "2" },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: [
    { key: "campaign:1", id: "1", level: "campaign", accountId, name: "Com gasto", currency: "BRL", values: { spend: 100 } },
    { key: "adset:10", id: "10", level: "adset", parentId: "1", campaignId: "1", accountId, name: "Conjunto com dado", currency: "BRL", values: { spend: 100 } },
  ] });
  mocks.statuses.mockImplementation(async (_input, _thumbs, _catalog, _raw, report: LiveReadReport) => { report.entities.push(...catalog()); report.accountsRead.push(accountId); return {}; });
});

it("com catálogo completo traz conjuntos e anúncios sem movimentação, sem zero presumido", async () => {
  const report: LiveReadReport = { entities: [], accountsRead: [], accountsFailed: [] };
  const result = await loadClientHierarchy({ ...base, fullCatalog: true, report });
  const entities = "entities" in result ? result.entities ?? [] : [];
  const byId = Object.fromEntries(entities.map(entity => [`${entity.level}:${entity.id}`, entity]));
  expect(Object.keys(byId).sort()).toEqual(["ad:200", "adset:10", "adset:11", "adset:20", "campaign:1", "campaign:2"]);
  // Ausência de linha não prova zero: tudo que não veio de uma linha confirmada fica sem valores (desconhecido), em todos os níveis.
  for (const id of ["adset:11", "campaign:2", "adset:20", "ad:200"]) expect(byId[id]!.values).toEqual({});
  expect(byId["adset:11"]!.parentId).toBe("1");
  expect(byId["ad:200"]!.parentId).toBe("20");
  expect(byId["adset:10"]!.values.spend).toBe(100);
});

it("campanha do catálogo ao vivo sem linha NUNCA vira zero a partir do agregado confirmado da conta", async () => {
  mocks.statuses.mockImplementation(async (_input, _thumbs, live: Array<{ accountId: string; id: string; name: string }>) => {
    live.push({ accountId, id: "9", name: "Só no catálogo" }); return { [`${accountId}:campaign:9`]: "INACTIVE" };
  });
  const result = await loadClientHierarchy({ ...base, fullCatalog: true, analytics: { ...analytics, metrics: [] } as never });
  const entities = "entities" in result ? result.entities ?? [] : [];
  const orphan = entities.find(entity => entity.id === "9");
  expect(orphan).toBeDefined();
  expect(orphan!.values).toEqual({});
  expect(orphan!.values.spend).toBeUndefined();
});

it("sem catálogo completo mantém o comportamento do painel (apenas campanhas com gasto ou ativas)", async () => {
  const report: LiveReadReport = { entities: [], accountsRead: [], accountsFailed: [] };
  const result = await loadClientHierarchy({ ...base, report });
  const entities = "entities" in result ? result.entities ?? [] : [];
  expect(entities.map(entity => entity.id).sort()).toEqual(["1", "10"]);
});

it("somente catálogo: não exige cobertura completa, não lê métricas e entrega todas as entidades sem valores", async () => {
  const report: LiveReadReport = { entities: [], accountsRead: [], accountsFailed: [] };
  const partial = { ...analytics, coverage: { status: "partial" }, metaAggregate: { confirmed: false }, campaigns: [{ id: "9", accountId, name: "Com gasto antigo", values: { spend: 500 } }] };
  const result = await loadClientHierarchy({ ...base, analytics: partial as never, catalogOnly: true, fullCatalog: true, report });
  const entities = "entities" in result ? result.entities ?? [] : [];
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(entities.map(entity => `${entity.level}:${entity.id}`).sort()).toEqual(["ad:200", "adset:10", "adset:11", "adset:20", "campaign:1", "campaign:2"]);
  for (const entity of entities) expect(entity.values).toEqual({}); // nada de gasto presumido, nem o agregado antigo da campanha 9
  expect(entities.some(entity => entity.id === "9")).toBe(false); // entidade fora do catálogo da Meta não é inventada
  expect(entities.find(entity => entity.id === "10")!.parentId).toBe("1");
});

it("somente catálogo sem a leitura ao vivo devolve lista vazia (nunca dado antigo) e exige a identidade das contas", async () => {
  mocks.statuses.mockRejectedValue(new Error("Meta fora do ar"));
  const report: LiveReadReport = { entities: [], accountsRead: [], accountsFailed: [] };
  const partial = { ...analytics, coverage: { status: "partial" } };
  const result = await loadClientHierarchy({ ...base, analytics: partial as never, catalogOnly: true, report });
  expect("entities" in result ? result.entities : null).toEqual([]);
  const { analytics: _omit, ...withoutAnalytics } = base;
  void _omit;
  expect(await loadClientHierarchy({ ...withoutAnalytics, catalogOnly: true, report })).toHaveProperty("error");
});
