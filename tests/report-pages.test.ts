import { describe, expect, it } from "vitest";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { messageValues, SYSTEM_TEMPLATES, unknownVariables } from "@/modules/automations/message";
import { isReportTab, legacyRedirect, REPORT_TABS, SECTION_PATHS, SECTION_ROUTES } from "@/modules/operations/routes";

describe("endereços de Relatórios", () => {
  it("Agendamentos tem endereço próprio e Relatórios tem abas", () => {
    expect(SECTION_ROUTES.agendamentos).toBe("agendamentos");
    expect(SECTION_ROUTES.relatorios).toBe("relatorios-visao");
    expect(SECTION_ROUTES["relatorios/pdfs"]).toBe("relatorios");
    expect(SECTION_PATHS.entregas).toBe("relatorios/entregas");
    expect(REPORT_TABS.map(tab => tab.label)).toEqual(["Visão geral", "Entregas", "Templates", "PDFs salvos"]);
    expect(isReportTab("templates")).toBe(true);
    expect(isReportTab("agendamentos")).toBe(false);
  });

  it("endereços antigos redirecionam mantendo os parâmetros", () => {
    expect(legacyRedirect("/dashboard", "relatorios/agendamentos", { cliente: "abc" })).toBe("/dashboard/agendamentos?cliente=abc");
    expect(legacyRedirect("/dashboard", "entregas", {})).toBe("/dashboard/relatorios/entregas");
    expect(legacyRedirect("/demo", "templates", {})).toBe("/demo/relatorios/templates");
    expect(legacyRedirect("/dashboard", "agendamentos", {})).toBeNull();
    expect(legacyRedirect("/dashboard", "relatorios", {})).toBeNull();
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
