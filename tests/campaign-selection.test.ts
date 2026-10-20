import { describe, expect, it } from "vitest";
import { clearSelection, EMPTY_SELECTION, entityKey, parseStoredSelection, reconcileSelection, scopeDescription, scopeRows, selectionStorageKey, serializeSelection, setSelected, type NavSelection } from "@/modules/campaigns/navigation/selection";
import { structureOf, PLATFORMS, operationalPlatforms } from "@/modules/campaigns/platforms/registry";
import type { CampaignRow } from "@/modules/campaigns/tree";
import { IDS, row, vals } from "./campaign-assistant-fixtures";

// Conta A: campanhas 1 (A), 2 (B), 3 (C); conjuntos 11,12 (de A), 21 (de B), 31 (de C); anúncios por conjunto.
// Conta B: mesmo ID "1" para a campanha e "11" para o conjunto (entidades DIFERENTES).
const A = IDS.accA, B = IDS.accB;
const rows: CampaignRow[] = [
  row("campaign", "1", "Campanha A", null, A, vals(300)), row("campaign", "2", "Campanha B", null, A, vals(200)), row("campaign", "3", "Campanha C", null, A, vals(100)),
  row("adset", "11", "Conjunto A1", "1", A, vals(150)), row("adset", "12", "Conjunto A2", "1", A, vals(150)), row("adset", "21", "Conjunto B1", "2", A, vals(200)), row("adset", "31", "Conjunto C1", "3", A, vals(100)),
  row("ad", "111", "Anúncio A1-1", "11", A, vals(100)), row("ad", "112", "Anúncio A1-2", "11", A, vals(50)), row("ad", "121", "Anúncio A2-1", "12", A, vals(150)),
  row("ad", "211", "Anúncio B1-1", "21", A, vals(200)), row("ad", "311", "Anúncio C1-1", "31", A, vals(100)),
  row("campaign", "1", "Campanha A (conta B)", null, B, vals(50)), row("adset", "11", "Conjunto A1 (conta B)", "1", B, vals(50)), row("ad", "111", "Anúncio A1-1 (conta B)", "11", B, vals(50)),
].map(item => item.level === "campaign" ? item : { ...item, campaignId: item.level === "adset" ? item.parentId : { "111": "1", "112": "1", "121": "1", "211": "2", "311": "3" }[item.id]! });
const key = (level: "campaign" | "adset" | "ad", id: string, account = A) => entityKey({ accountId: account, level, id });
const names = (level: "campaign" | "adset" | "ad", selection: NavSelection) => scopeRows(level, rows, selection).map(item => item.name);
const pick = (selection: NavSelection, level: "campaign" | "adset" | "ad", ...ids: string[]) => setSelected(selection, rows, level, ids.map(id => key(level, id)), true);

describe("navegação e seleção contextual (Meta)", () => {
  it("1-2. Campanhas mostram só campanhas; 3-4. Conjuntos sem seleção mostram todos; 10-11. Anúncios sem seleção mostram todos", () => {
    expect(scopeRows("campaign", rows, EMPTY_SELECTION).every(item => item.level === "campaign")).toBe(true);
    expect(scopeRows("campaign", rows, EMPTY_SELECTION)).toHaveLength(4);
    expect(scopeRows("adset", rows, EMPTY_SELECTION)).toHaveLength(5);
    expect(scopeRows("ad", rows, EMPTY_SELECTION)).toHaveLength(6);
  });
  it("5-7. Uma campanha selecionada: Conjuntos mostram só os dela (e nada da conta B)", () => {
    const selection = pick(EMPTY_SELECTION, "campaign", "1");
    expect(names("adset", selection)).toEqual(["Conjunto A1", "Conjunto A2"]);
    expect(names("campaign", selection)).toHaveLength(4); // a seleção não filtra a própria aba
  });
  it("8-9. Várias campanhas: Conjuntos das duas", () => {
    expect(names("adset", pick(EMPTY_SELECTION, "campaign", "1", "3"))).toEqual(["Conjunto A1", "Conjunto A2", "Conjunto C1"]);
  });
  it("12-14. Campanha selecionada e Anúncios abertos direto: todos os anúncios da campanha", () => {
    expect(names("ad", pick(EMPTY_SELECTION, "campaign", "1"))).toEqual(["Anúncio A1-1", "Anúncio A1-2", "Anúncio A2-1"]);
  });
  it("15-17. Conjunto selecionado: Anúncios só desse conjunto", () => {
    expect(names("ad", pick(pick(EMPTY_SELECTION, "campaign", "1"), "adset", "12"))).toEqual(["Anúncio A2-1"]);
  });
  it("18-19. Vários conjuntos: anúncios dos selecionados; o conjunto prevalece sobre a campanha", () => {
    const selection = pick(pick(EMPTY_SELECTION, "campaign", "1", "2"), "adset", "11", "21");
    expect(names("ad", selection)).toEqual(["Anúncio A1-1", "Anúncio A1-2", "Anúncio B1-1"]);
    expect(names("ad", selection)).not.toContain("Anúncio A2-1"); // A2 pertence à campanha selecionada, mas só A1 e B1 estão selecionados
  });
  it("20-21. Trocar a campanha invalida conjuntos incompatíveis, que deixam de influenciar os anúncios", () => {
    let selection = pick(pick(EMPTY_SELECTION, "campaign", "1"), "adset", "11");
    expect(names("ad", selection)).toEqual(["Anúncio A1-1", "Anúncio A1-2"]);
    selection = setSelected(selection, rows, "campaign", [key("campaign", "1")], false);
    selection = pick(selection, "campaign", "3");
    expect(selection.adset).toEqual([]);
    expect(names("ad", selection)).toEqual(["Anúncio C1-1"]);
  });
  it("22. Limpar tudo volta ao escopo completo", () => {
    const selection = clearSelection();
    expect(selection).toEqual(EMPTY_SELECTION);
    expect(scopeRows("ad", rows, selection)).toHaveLength(6);
  });
  it("23. Trocar de conta: seleção de entidades que saíram dos dados é descartada, sem afetar a conta mantida", () => {
    const selection = pick(pick(EMPTY_SELECTION, "campaign", "1"), "adset", "11");
    const withB = setSelected(selection, rows, "campaign", [key("campaign", "1", B)], true);
    const onlyB = rows.filter(item => item.accountId === B);
    const reconciled = reconcileSelection(withB, onlyB);
    expect(reconciled.campaign).toEqual([key("campaign", "1", B)]);
    expect(reconciled.adset).toEqual([]);
  });
  it("mesmo ID em contas diferentes são entidades diferentes", () => {
    const selection = pick(EMPTY_SELECTION, "campaign", "1");
    expect(names("adset", selection)).not.toContain("Conjunto A1 (conta B)");
    expect(names("ad", selection)).not.toContain("Anúncio A1-1 (conta B)");
  });
  it("seleção de anúncios fora do escopo é removida quando o escopo muda", () => {
    let selection = pick(pick(EMPTY_SELECTION, "campaign", "1"), "ad", "111", "121");
    expect(selection.ad).toHaveLength(2);
    selection = pick(setSelected(selection, rows, "campaign", [key("campaign", "1")], false), "campaign", "2");
    expect(selection.ad).toEqual([]);
  });
  it("chaves desconhecidas e conjuntos sem campanha selecionada correspondente não sobrevivem", () => {
    const ghost = reconcileSelection({ campaign: ["x|campaign|9", key("campaign", "1")], adset: [key("adset", "21")], ad: [] }, rows);
    expect(ghost.campaign).toEqual([key("campaign", "1")]);
    expect(ghost.adset).toEqual([]);
  });
  it("seleção é isolada por cliente e organização na chave de armazenamento", () => {
    expect(selectionStorageKey("org:user", "cliente-1", "meta")).not.toBe(selectionStorageKey("org:user", "cliente-2", "meta"));
    expect(selectionStorageKey("org:user", "c", "meta")).not.toBe(selectionStorageKey("org:user", "c", "google"));
    expect(selectionStorageKey("org1:u", "c", "meta")).not.toBe(selectionStorageKey("org2:u", "c", "meta"));
  });
  it("26-27. Atualizar o navegador: o armazenamento restaura a seleção; formato inválido ou adulterado vira vazio", () => {
    const selection = pick(pick(EMPTY_SELECTION, "campaign", "1"), "adset", "12");
    expect(parseStoredSelection(serializeSelection(selection))).toEqual(selection);
    for (const bad of [null, "", "x", "[]", "{\"campaign\":\"x\"}", JSON.stringify({ campaign: ["../../x"], adset: [], ad: [] }), JSON.stringify({ campaign: [key("adset", "11")], adset: [], ad: [] })]) {
      expect(parseStoredSelection(bad as string | null)).toEqual(EMPTY_SELECTION);
    }
  });
  it("descreve o escopo aplicado", () => {
    expect(scopeDescription("adset", pick(EMPTY_SELECTION, "campaign", "1", "2"))).toBe("Conjuntos de 2 campanhas selecionadas");
    expect(scopeDescription("ad", pick(pick(EMPTY_SELECTION, "campaign", "1"), "adset", "11"))).toBe("Anúncios de 1 conjunto selecionado");
    expect(scopeDescription("ad", pick(EMPTY_SELECTION, "campaign", "1"))).toBe("Anúncios de 1 campanha selecionada");
    expect(scopeDescription("campaign", pick(EMPTY_SELECTION, "campaign", "1"))).toBeNull();
    expect(scopeDescription("ad", EMPTY_SELECTION)).toBeNull();
  });
  it("seleção múltipla é por nível e não duplica", () => {
    const selection = pick(pick(EMPTY_SELECTION, "campaign", "1"), "campaign", "1", "2");
    expect(selection.campaign).toEqual([key("campaign", "1"), key("campaign", "2")]);
    expect(setSelected(selection, rows, "campaign", [key("campaign", "2")], false).campaign).toEqual([key("campaign", "1")]);
  });
});

describe("estruturas por plataforma", () => {
  it("cada plataforma usa seus próprios níveis (sem forçar a hierarquia da Meta)", () => {
    expect(structureOf("meta").levels.map(level => level.label)).toEqual(["Campanhas", "Conjuntos de anúncios", "Anúncios"]);
    expect(structureOf("tiktok").levels.map(level => level.label)).toEqual(["Campanhas", "Grupos de anúncios", "Anúncios"]);
    expect(structureOf("google", "standard").levels.map(level => level.label)).toEqual(["Campanhas", "Grupos de anúncios", "Anúncios"]);
    expect(structureOf("google", "performance_max").levels.map(level => level.label)).toEqual(["Campanhas", "Grupos de recursos", "Recursos"]);
    expect(structureOf("linkedin").levels.map(level => level.label)).toEqual(["Grupos de campanhas", "Campanhas", "Criativos"]);
  });
  it("Performance Max e LinkedIn trazem o aviso estrutural; só a Meta é operacional", () => {
    expect(structureOf("google", "performance_max").note).toMatch(/não usa grupos de anúncios/);
    expect(structureOf("linkedin").note).toMatch(/não tem conjunto de anúncios/);
    expect(operationalPlatforms().map(item => item.id)).toEqual(["meta"]);
    for (const id of ["google", "tiktok", "linkedin"] as const) { expect(PLATFORMS[id].status).toBe("planned"); expect(PLATFORMS[id].write).toBe("none"); }
  });
});
