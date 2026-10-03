import { describe, expect, it } from "vitest";
import { aggregateResults, resultBreakdown, resultCostBreakdown } from "@/modules/client-portal/analytics-results";

describe("resultados automáticos", () => {
  it("mantém ações secundárias sem inventar o resultado escolhido pela Meta", () => {
    const values = aggregateResults({ spend: 500, "action:onsite_conversion.messaging_conversation_started_7d": 150, instagram_profile_visits: 50, "action:lead": 50 }, true);
    expect(values.primary_results).toBeNull();
    expect(values.cost_per_result).toBeNull();
    expect(values).toMatchObject({ "result:messages": 150, "result:profile_visits": 50, "result:leads": 50 });
    expect(resultBreakdown(values)).toEqual([]);
  });
  it("não soma aliases, curtidas, bloqueios ou respostas adicionais", () => {
    const values = aggregateResults({ "action:lead": 50, "action:onsite_conversion.lead_grouped": 50, "action:offsite_conversion.fb_pixel_lead": 50, "action:omni_purchase": 10, "action:purchase": 10, "action:like": 300, "action:onsite_conversion.messaging_block": 3 }, true);
    expect(values.primary_results).toBeNull();
    expect(values).toMatchObject({ "result:leads": 50, "result:purchases": 10 });
  });
  it("preserva ausência de coleta e não inventa custo com moedas diferentes", () => {
    expect(aggregateResults({}, false).primary_results).toBeNull();
    expect(aggregateResults({}, true).primary_results).toBeNull();
    expect(aggregateResults({ "result:provider_known": 1 }, true).primary_results).toBe(0);
    expect(aggregateResults({ spend: null, "action:lead": 5 }, true).cost_per_result).toBeNull();
  });
  it("usa distribuição calculada em cada entidade sem recontar aliases agregados", () => {
    expect(aggregateResults({ "result:leads": 70, "action:lead": 20, "action:onsite_conversion.lead_grouped": 50 }, true)["result:leads"]).toBe(70);
  });
  it("calcula custo por tipo usando somente o investimento das entidades daquele resultado", () => {
    const summary = {
      spend: 850,
      "result:provider_known": 1,
      "result:provider:action:post_engagement": 300,
      "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 50,
    };
    const rows = resultCostBreakdown(summary, [
      { values: { spend: 600, "result:provider_known": 1, "result:provider:action:post_engagement": 300 } },
      { values: { spend: 250, "result:provider_known": 1, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 50 } },
    ]);
    expect(rows.find(row => row.key.endsWith("post_engagement"))?.cost).toBe(2);
    expect(rows.find(row => row.key === "messages")?.cost).toBe(5);
  });
  it("reconcilia aliases equivalentes de visita ao perfil ao calcular custo", () => {
    const rows = resultCostBreakdown({
      spend: 20,
      "result:provider_known": 1,
      "result:provider:instagram_profile_visits": 10,
    }, [
      { values: { spend: 20, "result:provider_known": 1, "result:provider:action:instagram_profile_visit": 10 } },
    ]);
    expect(rows[0]?.cost).toBe(2);
  });
  it("não usa investimento geral quando faltam fontes por tipo de resultado", () => {
    const rows = resultCostBreakdown({
      spend: 100,
      "result:provider_known": 1,
      "result:provider:action:link_click": 25,
    }, []);
    expect(rows[0]).toMatchObject({ label: "Cliques no link", cost: null });
  });
  it("traduz indicadores de resultado sem prefixo retornados pela Meta", () => {
    const rows = resultBreakdown({
      "result:provider_known": 1,
      "result:provider:profile_visit_view": 15,
    });
    expect(rows[0]).toMatchObject({ label: "Visitas ao perfil do Instagram", value: 15 });
  });
  it("consolida aliases de visita ao perfil retornados como resultados separados", () => {
    const rows = resultBreakdown({
      "result:provider_known": 1,
      "result:provider:profile_visit_view": 15,
      "result:provider:instagram_profile_visits": 45_013,
    });
    expect(rows).toEqual([{ key: "profile_visits", label: "Visitas ao perfil do Instagram", value: 45_028 }]);
  });
  it("inclui o investimento das campanhas de mensagem com zero resultado confirmado", () => {
    const rows = resultCostBreakdown({ spend: 200, "result:provider_known": 1,
      "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 10 }, [
      { values: { spend: 100, "result:provider_known": 1, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 10 } },
      { values: { spend: 100, "result:provider_known": 1, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 0 } },
    ]);
    expect(rows[0].cost).toBe(20);
  });
  it("bloqueia custo quando os resultados ou o investimento das fontes não conciliam", () => {
    const summary = { spend: 200, "result:provider_known": 1, "result:provider:action:lead": 10 };
    expect(resultCostBreakdown(summary, [{ values: { spend: 100, "result:provider_known": 1, "result:provider:action:lead": 10 } }])[0].cost).toBeNull();
    expect(resultCostBreakdown(summary, [{ values: { spend: 200, "result:provider_known": 1, "result:provider:action:lead": 5 } }])[0].cost).toBeNull();
    expect(resultCostBreakdown(summary, [{ values: { spend: 100, "result:provider_known": 1, "result:provider:action:lead": 10 } }, { values: { spend: 100 } }])[0].cost).toBeNull();
  });
  it("não calcula custo geral para objetivos diferentes", () => {
    const values = aggregateResults({ spend: 200, "result:provider_known": 1,
      "result:provider:action:lead": 10, "result:provider:instagram_profile_visits": 40 }, true);
    expect(values.primary_results).toBeNull();
    expect(values.cost_per_result).toBeNull();
  });
  it("não publica resultado parcial, inválido ou de período incompleto", () => {
    expect(aggregateResults({ "result:provider_known": 1, "result:provider:action:lead": null }, true).primary_results).toBeNull();
    expect(aggregateResults({ "result:provider_known": 1, "result:provider:action:lead": -5 }, true).primary_results).toBeNull();
    expect(aggregateResults({ "result:provider_known": 1, "result:provider:action:lead": 10 }, false).primary_results).toBeNull();
  });
  it("não duplica campanha com seus conjuntos e anúncios em relatórios", () => {
    const values = { spend: 100, "result:provider_known": 1, "result:provider:action:lead": 10 };
    expect(resultCostBreakdown(values, [
      { level: "campaign", id: "c", accountId: "a", values },
      { level: "adset", id: "s", campaignId: "c", accountId: "a", values },
      { level: "ad", id: "d", campaignId: "c", parentId: "s", accountId: "a", values },
    ])[0].cost).toBe(10);
  });
});
