import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyColumnPreference, columnPreferenceKey, moveColumn, parseColumnPreference, serializeColumnPreference } from "@/modules/campaigns/column-preferences";
import { buildColumns, DEFAULT_COLUMN_KEYS } from "@/modules/campaigns/columns";
import { ancestorsOf, findEntity, subtreeWithAncestors, trimForEntity } from "@/modules/campaigns/detail";
import { entityPath, parseEntityRoute, periodSearch } from "@/modules/campaigns/routes";
import { activeClientSection, ROUTED_SECTIONS, SECTION_SLUGS } from "@/modules/client-portal/client-sections";
import { buildChildIndex, childrenOf, indexedChildren } from "@/modules/campaigns/tree";
import { campaignsData, IDS } from "./campaign-assistant-fixtures";

const read = (path: string) => readFileSync(path, "utf8");
const ID = IDS.client;

describe("menu do cliente e barra principal", () => {
  it("Campanhas está na segunda barra e fora da barra principal", () => {
    expect(read("src/components/layout/app-shell.tsx")).not.toMatch(/key:\s*"campanhas"/);
    expect(read("src/modules/client-portal/client-menu.tsx")).toMatch(/section:\s*"campaigns",\s*label:\s*"Campanhas"/);
    expect(SECTION_SLUGS.campaigns).toBe("campanhas");
    expect(ROUTED_SECTIONS).toEqual(["campaigns"]);
  });
  it("reconhece a seção ativa também nas páginas internas de Campanhas (menu continua com Campanhas ativo)", () => {
    const base = `/clientes/${ID}`;
    expect(activeClientSection(`${base}/campanhas`)).toEqual({ base, section: "campaigns" });
    expect(activeClientSection(`${base}/campanhas/meta/${IDS.accA}/campanha/100`)).toEqual({ base, section: "campaigns" });
    expect(activeClientSection(`${base}/dashboard`)).toEqual({ base, section: "overview" });
    expect(activeClientSection(`${base}/desconhecida`)).toBeNull();
    expect(activeClientSection("/clientes")).toBeNull();
  });
  it("o menu usa o roteador do Next ao entrar ou sair de Campanhas e pushState entre seções analíticas", () => {
    const menu = read("src/modules/client-portal/client-menu.tsx");
    expect(menu).toContain("ROUTED_SECTIONS.includes(section) || ROUTED_SECTIONS.includes(current)");
    expect(menu).toContain("window.history.pushState");
  });
  it("a rota global antiga só redireciona (nunca renderiza a interface) e a nova usa o cliente da rota", () => {
    const legacy = read("src/app/(workspace)/campanhas/page.tsx");
    expect(legacy).toContain("redirect(");
    expect(legacy).not.toContain("CampaignsWorkspace");
    expect(legacy).toContain('redirect("/clientes")'); // sem cliente válido: nada é escolhido sozinho
    const page = read("src/app/(workspace)/clientes/[clientId]/campanhas/page.tsx");
    expect(page).toContain("authorizeCampaignsClient(clientId)");
    expect(page).not.toContain('"cliente"');
    expect(read("src/modules/campaigns/load.ts")).not.toMatch(/query\.cliente/);
  });
  it("a lista de clientes abre o painel pelo endereço do cliente (/clientes/ID)", () => {
    expect(read("src/modules/clients/client-manager.tsx")).toContain("href={`/clientes/${client.id}`}");
  });
  it("a autorização valida UUID, organização da sessão e responde 404 sem cair em outro cliente", () => {
    const access = read("src/modules/campaigns/access.ts");
    expect(access).toContain("if (!UUID.test(clientId)) notFound()");
    expect(access).toContain('.eq("agency_id", context.agency.id)');
    expect(access).toContain("if (!client) notFound()");
    expect(access).not.toMatch(/\[0\]|first\(|limit\(1\)/); // nunca "o primeiro cliente"
  });
});

describe("endereços das entidades", () => {
  it("monta o endereço com cliente, plataforma, conta, nível e identificador (nunca o nome)", () => {
    expect(entityPath(ID, { accountId: IDS.accA, level: "campaign", id: "100" })).toBe(`/clientes/${ID}/campanhas/meta/${IDS.accA}/campanha/100`);
    expect(entityPath(ID, { accountId: IDS.accA, level: "adset", id: "200" })).toContain("/conjunto/200");
    expect(entityPath(ID, { accountId: IDS.accA, level: "ad", id: "300" })).toContain("/anuncio/300");
    // Mesmo ID em contas diferentes ⇒ endereços diferentes.
    expect(entityPath(ID, { accountId: IDS.accA, level: "campaign", id: "100" })).not.toBe(entityPath(ID, { accountId: IDS.accB, level: "campaign", id: "100" }));
  });
  it("valida os segmentos e recusa qualquer desvio", () => {
    const ok = { platform: "meta", accountId: IDS.accA, level: "campanha", entityId: "120210" };
    expect(parseEntityRoute(ok)).toEqual({ platform: "meta", accountId: IDS.accA, level: "campaign", entityId: "120210" });
    expect(parseEntityRoute({ ...ok, platform: "google" })).toBeNull();
    expect(parseEntityRoute({ ...ok, accountId: "nao-e-uuid" })).toBeNull();
    expect(parseEntityRoute({ ...ok, level: "campaign" })).toBeNull(); // o segmento é em português
    expect(parseEntityRoute({ ...ok, level: "conjuntos" })).toBeNull();
    for (const entityId of ["", "1 2", "1;drop", "../x", "%E0%A4%A", "a".repeat(65), "1/2"]) expect(parseEntityRoute({ ...ok, entityId })).toBeNull();
    expect(parseEntityRoute({ platform: "meta" })).toBeNull();
  });
  it("preserva o período ao abrir e voltar", () => {
    expect(periodSearch({ period: "last_30d", dateFrom: "2026-09-19", dateTo: "2026-10-18" })).toBe("?periodo=last_30d");
    expect(periodSearch({ period: "custom", dateFrom: "2026-09-19", dateTo: "2026-10-18" })).toBe("?periodo=custom&from=2026-09-19&to=2026-10-18");
  });
});

describe("entidade, ancestrais e subárvore", () => {
  const data = campaignsData();
  it("acha a entidade por conta + nível + ID; o mesmo ID em outra conta é outra entidade", () => {
    expect(findEntity(data.rows, { accountId: IDS.accA, level: "campaign", entityId: "100" })?.accountName).toBe("Conta A");
    expect(findEntity(data.rows, { accountId: IDS.accB, level: "campaign", entityId: "100" })?.accountName).toBe("Conta B");
    expect(findEntity(data.rows, { accountId: IDS.accOther, level: "campaign", entityId: "100" })).toBeNull();
    expect(findEntity(data.rows, { accountId: IDS.accA, level: "adset", entityId: "100" })).toBeNull(); // nível errado nunca é "o mais parecido"
    expect(findEntity(data.rows, { accountId: IDS.accA, level: "campaign", entityId: "999" })).toBeNull();
  });
  it("encadeia os ancestrais do mais próximo ao mais distante", () => {
    const ad = findEntity(data.rows, { accountId: IDS.accA, level: "ad", entityId: "300" })!;
    expect(ancestorsOf(ad, data.rows).map(item => item.id)).toEqual(["200", "100"]);
    expect(ancestorsOf(findEntity(data.rows, { accountId: IDS.accA, level: "campaign", entityId: "100" })!, data.rows)).toEqual([]);
  });
  it("a página recebe só a entidade, seus ancestrais e descendentes (nada de irmãos nem de outras contas)", () => {
    const adset = findEntity(data.rows, { accountId: IDS.accA, level: "adset", entityId: "200" })!;
    expect(subtreeWithAncestors(adset, data.rows).map(item => `${item.accountId === IDS.accA ? "A" : "B"}:${item.id}`)).toEqual(["A:100", "A:200", "A:300"]);
    const campaign = findEntity(data.rows, { accountId: IDS.accA, level: "campaign", entityId: "100" })!;
    expect(trimForEntity(data, campaign).rows.map(item => item.id)).toEqual(["100", "200", "201", "300"]);
    expect(trimForEntity(data, campaign).rows.some(item => item.accountId === IDS.accB)).toBe(false);
  });
});

describe("preferência de colunas", () => {
  const catalog = buildColumns(campaignsData().metrics, [{ key: "lead", label: "Leads" }]);
  it("valida o texto salvo e ignora formatos antigos ou corrompidos", () => {
    expect(parseColumnPreference(serializeColumnPreference(["spend", "results"]))).toEqual(["spend", "results"]);
    for (const raw of [null, "", "não é json", "{}", "[]", '["ok", 1]', '[{"a":1}]', JSON.stringify(Array.from({ length: 81 }, (_, i) => `k${i}`)), '["com espaço"]', '["<script>"]']) expect(parseColumnPreference(raw)).toBeNull();
    expect(parseColumnPreference('["spend","spend"]')).toEqual(["spend"]);
  });
  it("respeita a ordem escolhida, ignora colunas removidas e volta ao padrão se nada sobrar", () => {
    expect(applyColumnPreference(catalog, ["impressions", "spend", "coluna_removida"]).map(column => column.key)).toEqual(["impressions", "spend"]);
    expect(applyColumnPreference(catalog, ["coluna_removida"]).map(column => column.key)).toEqual(DEFAULT_COLUMN_KEYS.filter(key => catalog.some(column => column.key === key)));
  });
  it("move colunas sem sair do intervalo; guarda só chaves (nenhum dado)", () => {
    expect(moveColumn(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveColumn(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(serializeColumnPreference(["spend"])).toBe('["spend"]');
    expect(columnPreferenceKey("org:user")).toBe("groow.campaigns.columns.v1:org:user");
  });
});

describe("índice de filhos da tabela", () => {
  it("devolve os mesmos filhos da varredura completa, sem misturar contas com o mesmo ID", () => {
    const { rows } = campaignsData();
    const index = buildChildIndex(rows);
    for (const row of rows) expect(indexedChildren(row, index).map(item => item.key + item.accountId)).toEqual(childrenOf(row, rows).map(item => item.key + item.accountId));
    const accA = rows.find(row => row.id === "100" && row.accountId === IDS.accA)!;
    const accB = rows.find(row => row.id === "100" && row.accountId === IDS.accB)!;
    expect(indexedChildren(accA, index).map(item => item.id)).toEqual(["200", "201"]);
    expect(indexedChildren(accB, index)).toEqual([]);
  });
});
