import { describe, expect, it } from "vitest";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { messageValues, SYSTEM_TEMPLATES, unknownVariables } from "@/modules/automations/message";
import { legacyRedirect, SECTION_PATHS, SECTION_ROUTES } from "@/modules/operations/routes";

describe("endereços de Relatórios", () => {
  it("as páginas de relatórios ficam dentro de /relatorios", () => {
    expect(SECTION_ROUTES["relatorios/agendamentos"]).toBe("agendamentos");
    expect(SECTION_ROUTES["relatorios/pdfs"]).toBe("relatorios");
    expect(SECTION_PATHS.entregas).toBe("relatorios/entregas");
    expect(SECTION_ROUTES.agendamentos).toBeUndefined();
  });

  it("endereços antigos redirecionam mantendo os parâmetros", () => {
    expect(legacyRedirect("/dashboard", "agendamentos", { cliente: "abc" })).toBe("/dashboard/relatorios/agendamentos?cliente=abc");
    expect(legacyRedirect("/dashboard", "relatorios", {})).toBe("/dashboard/relatorios/agendamentos");
    expect(legacyRedirect("/demo", "templates", {})).toBe("/demo/relatorios/templates");
    expect(legacyRedirect("/dashboard", "clientes", {})).toBeNull();
    expect(legacyRedirect("/dashboard", "relatorios/agendamentos", {})).toBeNull();
  });
});

describe("templates prontos", () => {
  it("cobrem os principais tipos de resultado e só usam variáveis conhecidas", () => {
    expect(new Set(SYSTEM_TEMPLATES.map(item => item.segment))).toEqual(new Set(["geral", "mensagens", "vendas", "leads", "seguidores", "trafego"]));
    for (const template of SYSTEM_TEMPLATES) {
      expect(unknownVariables(template.body)).toEqual([]);
      expect(template.body).toContain("PARAR");
    }
  });

  it("preenche receita, ROAS, seguidores e custo por resultado", () => {
    const data = getDemoClientAnalytics();
    const values = messageValues({ clientName: "C", data: { ...data, summary: { ...data.summary, attributed_revenue: 5000, spend: 1250, instagram_profile_follow: 250 } } });
    expect(values.receita).toMatch(/^R\$\s?5\.000,00$/);
    expect(values.roas).toBe("4,00x");
    expect(values.seguidores).toBe("250");
    // Cost per result only when campaign spend reconciles with the total (here the original data).
    expect(values.custo_conversa).toBe("—");
    expect(messageValues({ clientName: "C", data }).custo_conversa).toMatch(/^R\$/);
    expect(messageValues({ clientName: "C", data: null }).roas).toBe("—");
  });
});
