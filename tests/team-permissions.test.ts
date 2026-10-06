import { describe, expect, it } from "vitest";
import { canOpenSection } from "@/modules/team/permissions";
import { SECTION_ROUTES } from "@/modules/operations/routes";

describe("permissões por área", () => {
  it("proprietário, administrador e quem não tem restrição abrem tudo", () => {
    expect(canOpenSection("owner", ["clientes"], "integracoes")).toBe(true);
    expect(canOpenSection("admin", [], "agendamentos")).toBe(true);
    expect(canOpenSection("editor", null, "integracoes")).toBe(true);
  });

  it("editor limitado só abre as áreas liberadas; as abas de Relatórios seguem a área Relatórios", () => {
    const modules = ["clientes", "relatorios"];
    expect(canOpenSection("editor", modules, "clientes")).toBe(true);
    expect(canOpenSection("editor", modules, "entregas")).toBe(true);
    expect(canOpenSection("editor", modules, "templates")).toBe(true);
    expect(canOpenSection("editor", modules, "agendamentos")).toBe(false);
    expect(canOpenSection("viewer", modules, "")).toBe(false);
  });

  it("configurações e equipe não dependem das áreas", () => {
    expect(canOpenSection("viewer", [], "configuracoes")).toBe(true);
    expect(canOpenSection("viewer", [], "equipe")).toBe(true);
    expect(SECTION_ROUTES.equipe).toBe("equipe");
  });
});
