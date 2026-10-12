import { brDate as br, dec, int, money, pct, share } from "@/modules/reports/format";
import type { Change, ReportFacts } from "@/modules/reports/report-facts";

// Fatos do relatório já formatados em pt-BR para a IA. Os números são entregues como texto pronto
// (ex.: "1.384", "+14,1%") para a IA copiar sem calcular, arredondar ou reformatar.

function changeText(change: Change, format: (value: number) => string) {
  return {
    atual: change.current == null ? null : format(change.current),
    anterior: change.previous == null ? null : format(change.previous),
    variacao: pct(change.changePct),
  };
}

export function formatFactsForPrompt(facts: ReportFacts, profile?: Record<string, string> | null) {
  const currency = facts.currency;
  const adText = (ad: ReportFacts["ads"][number]) => ({
    nome: ad.name,
    campanha: ad.campaignName,
    investimento: money(ad.spend, currency),
    resultado: ad.result ? { tipo: ad.result.label, quantidade: int(ad.result.quantity) } : null,
    resultado_confirmado_pela_meta: ad.resultConfirmed,
    varios_tipos_de_resultado: ad.mixedResults,
    custo_por_resultado: ad.costPerResult == null ? null : money(ad.costPerResult, currency),
  });
  return {
    ...(profile && Object.keys(profile).length > 0 ? { perfil_do_cliente: profile } : {}),
    periodo: `${br(facts.period.from)} a ${br(facts.period.to)}`,
    periodo_anterior: facts.period.comparable ? `${br(facts.period.previousFrom)} a ${br(facts.period.previousTo)}` : null,
    comparacao_disponivel: facts.period.comparable,
    investimento: changeText(facts.spend, value => money(value, currency)),
    resultados_por_tipo: facts.results.map(result => ({
      tipo: result.label,
      quantidade: int(result.quantity),
      quantidade_periodo_anterior: result.previousQuantity == null ? null : int(result.previousQuantity),
      variacao_quantidade: pct(result.changePct),
      investimento_nas_campanhas_deste_tipo: result.spend == null ? null : money(result.spend, currency),
      custo_por_resultado: result.costPerResult == null ? null : money(result.costPerResult, currency),
      custo_por_resultado_periodo_anterior: result.previousCostPerResult == null ? null : money(result.previousCostPerResult, currency),
      variacao_custo_por_resultado: pct(result.costChangePct),
    })),
    entrega: {
      alcance: { ...changeText(facts.delivery.reach, int), estimado_entre_contas: facts.delivery.reachEstimated },
      impressoes: changeText(facts.delivery.impressions, int),
      cpm: changeText(facts.delivery.cpm, value => money(value, currency)),
      frequencia_impressoes_por_pessoa: changeText(facts.delivery.frequency, value => dec(value)),
      cliques_no_link: changeText(facts.delivery.linkClicks, int),
    },
    campanhas_com_investimento_no_periodo: int(facts.campaignsWithSpend),
    campanhas_com_maior_investimento: facts.campaigns.map(campaign => ({
      nome: campaign.name,
      investimento: money(campaign.spend, currency),
      participacao_no_investimento: share(campaign.shareOfSpend),
      resultado: campaign.result ? { tipo: campaign.result.label, quantidade: int(campaign.result.quantity) } : null,
      resultado_confirmado_pela_meta: campaign.resultConfirmed,
      varios_tipos_de_resultado: campaign.mixedResults,
      custo_por_resultado: campaign.costPerResult == null ? null : money(campaign.costPerResult, currency),
    })),
    anuncios_com_investimento_no_periodo: int(facts.adsWithSpend),
    anuncios_com_maior_investimento: facts.ads.map(adText),
    anuncios_com_menor_custo_por_resultado: facts.adHighlights.lowestCost.map(adText),
    anuncios_com_maior_custo_por_resultado: facts.adHighlights.highestCost.map(adText),
    anuncios_sem_resultado_confirmado: facts.adHighlights.unconfirmed.map(adText),
    ...(facts.commercial ? { vendas_informadas_pelo_responsavel: {
      aviso: "Informado manualmente pelo responsável; a Meta não confirma vendas.",
      vendas: int(facts.commercial.sales),
      faturamento_informado: facts.commercial.revenue == null ? null : money(facts.commercial.revenue, currency),
      custo_por_venda_investimento_total_dividido_pelas_vendas: facts.commercial.costPerSale == null ? null : money(facts.commercial.costPerSale, currency),
      faturamento_por_real_investido: facts.commercial.revenuePerSpend == null ? null : dec(facts.commercial.revenuePerSpend),
    } } : {}),
    contas: facts.accounts.map(account => ({ nome: account.name, investimento: money(account.spend, currency), participacao: share(account.shareOfSpend) })),
    limites_da_leitura: facts.limitations,
  };
}

export type PromptFacts = ReturnType<typeof formatFactsForPrompt>;
