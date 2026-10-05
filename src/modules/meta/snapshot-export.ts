import type { EntityLevel } from "../integrations/data-contract";
import { accountCampaignResults,type MetaSnapshotView } from "./snapshot-view";

export const CAMPAIGN_RESULTS_RULE = "soma_das_campanhas_por_tipo";
export const CAMPAIGN_COST_RULE = "gasto_das_campanhas_do_tipo_dividido_pelos_resultados_6_casas";

const headers = ["tipo_linha","situacao_analise","conta_id","nivel","periodo_inicio","periodo_fim",
  "snapshot_id","coletado_em","api_versao","contrato_versao","entidade_id","entidade_nome",
  "campanha_id","conjunto_id","moeda","fuso","indicador","indicador_nativo","rotulo",
  "valor_exato","disponibilidade","unidade","regra_agregacao"];

// Quoting alone does not prevent spreadsheet formulas. Neutralize text cells
// beginning with a formula prefix, including prefixes hidden behind whitespace.
function cell(value: string) {
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"','""')}"`;
}

export function confirmedMetaSnapshotScope(view: MetaSnapshotView,externalAccountId: string,level: EntityLevel) {
  if (view.status === "pending" || view.missing.length) throw new Error("A análise completa ainda não está disponível para exportação.");
  const scopes = view.scopes.filter(scope => scope.identity.externalAccountId === externalAccountId && scope.identity.level === level);
  if (scopes.length !== 1) throw new Error("O escopo da exportação não foi confirmado.");
  const scope = scopes[0];
  if (!scope.snapshotId || !scope.collectedAt || scope.identity.provider !== "meta") throw new Error("O escopo da exportação não foi confirmado.");
  return scope;
}

export function exportMetaSnapshotJson(view: MetaSnapshotView,externalAccountId: string,level: EntityLevel) {
  const scope = confirmedMetaSnapshotScope(view,externalAccountId,level);
  return {
    filename: `meta-${externalAccountId}-${level}-${scope.identity.dateFrom}-${scope.identity.dateTo}.json`,
    content: JSON.stringify({ formatVersion: 1,status: view.status,identity: scope.identity,
      snapshotId: scope.snapshotId,collectedAt: scope.collectedAt,entities: scope.entities,
      ...(level === "account" ? derivedJson(view,externalAccountId) : {}) },null,2) + "\n",
    entityCount: scope.entities.length,
  };
}

export function exportMetaSnapshotCsv(view: MetaSnapshotView,externalAccountId: string,level: EntityLevel) {
  const scope = confirmedMetaSnapshotScope(view,externalAccountId,level);
  const identity = scope.identity;
  const provenance = [view.status,externalAccountId,level,identity.dateFrom,identity.dateTo,
    scope.snapshotId,scope.collectedAt,identity.apiVersion,String(identity.contractVersion)];
  const rows: string[][] = [headers];
  // A manifest also records a confirmed empty collection; no synthetic entity
  // or metric is introduced to make an empty export look populated.
  rows.push(["escopo",...provenance,...Array<string>(13).fill("")]);
  for (const entity of scope.entities) {
    const details = [entity.id,entity.name,entity.hierarchy?.campaignId ?? "",entity.hierarchy?.adsetId ?? "",entity.currency ?? "",entity.timezone];
    for (const indicator of entity.indicators) {
      rows.push(["indicador",...provenance,...details,indicator.key,indicator.nativeKey,indicator.label,
        indicator.value ?? "",indicator.state,indicator.unit,indicator.aggregationRule]);
    }
  }
  const derived = level === "account" ? accountCampaignResults(view,externalAccountId) : null;
  const account = scope.entities[0];
  if (derived && account) {
    // Derived rows are labelled as such; the stored Meta values above stay untouched.
    const details = [account.id,account.name,"","",account.currency ?? "",account.timezone];
    for (const item of derived.breakdown) {
      rows.push(["resultado_derivado",...provenance,...details,`campaign_results:${item.key}`,item.key,`Resultado somado das campanhas: ${item.label}`,
        item.value,"available","count",CAMPAIGN_RESULTS_RULE]);
      if (item.cost != null) rows.push(["resultado_derivado",...provenance,...details,`campaign_cost_per_result:${item.key}`,item.key,`Custo por resultado das campanhas: ${item.label}`,
        item.cost,"available","currency",CAMPAIGN_COST_RULE]);
    }
  }
  return {
    filename: `meta-${externalAccountId}-${level}-${identity.dateFrom}-${identity.dateTo}.csv`,
    content: "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n") + "\r\n",
    entityCount: scope.entities.length,
  };
}

function derivedJson(view: MetaSnapshotView,externalAccountId: string) {
  const derived = accountCampaignResults(view,externalAccountId);
  return derived ? { campaignDerivedResults: {
    note: "A Meta não informa resultados no total da conta; valores somados das campanhas, separadamente por tipo.",
    resultsRule: CAMPAIGN_RESULTS_RULE,costRule: CAMPAIGN_COST_RULE,
    results: derived.breakdown.map(item => ({ nativeKey: item.key,label: item.label,value: item.value,costPerResult: item.cost ?? null })),
    primaryResults: derived.primary,costPerResult: derived.cost,
  } } : {};
}
