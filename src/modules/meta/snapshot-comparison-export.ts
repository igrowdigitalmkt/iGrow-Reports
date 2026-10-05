import type { EntityLevel } from "../integrations/data-contract";
import type { MetaSnapshotView } from "./snapshot-view";
import { compareSnapshotIndicator,resolveSnapshotComparison } from "./snapshot-comparison";

export function exportSnapshotComparisonJson(current: MetaSnapshotView,previous: MetaSnapshotView,account: string,level: EntityLevel) {
  const scopes = resolveSnapshotComparison(current,previous,account,level);
  const comparisons = scopes.current.entities.map(entity => ({ entityId: entity.id,indicators: entity.indicators.map(metric => ({ key: metric.key,...compareSnapshotIndicator(metric,entity,scopes.previousEntities.get(entity.id)) })) }));
  return { filename: `meta-${account}-${level}-${scopes.current.identity.dateFrom}-${scopes.current.identity.dateTo}-comparacao.json`,entityCount: scopes.current.entities.length,
    content: JSON.stringify({ formatVersion: 1,status: current.status === "stale" || previous.status === "stale" ? "stale" : "ready",percentDecimalPlaces: 6,
      current: scopes.current,previous: scopes.previous,comparisons },null,2) + "\n" };
}
export function exportSnapshotComparisonCsv(current: MetaSnapshotView,previous: MetaSnapshotView,account: string,level: EntityLevel) {
  const scopes = resolveSnapshotComparison(current,previous,account,level);
  const rows: string[][] = [["tipo_linha","periodo","situacao","conta_id","nivel","inicio","fim","snapshot_id","coletado_em","entidade_id","entidade_nome","moeda","fuso","indicador","valor_exato","disponibilidade","unidade","valor_anterior_exato","diferenca_exata","variacao_percentual_6_casas","motivo_comparacao","cliente_id","conexao_id","provedor","versao_api","versao_contrato","chave_nativa","regra_agregacao","janela_atribuicao","entidade_pai_id","campanha_id","conjunto_id"]];
  for (const [period,scope,view] of [["atual",scopes.current,current],["anterior",scopes.previous,previous]] as const) {
    const provenance = [period,view.status,account,level,scope.identity.dateFrom,scope.identity.dateTo,scope.snapshotId,scope.collectedAt];
    const origin = [scope.identity.clientId,scope.identity.connectionId,scope.identity.provider,scope.identity.apiVersion,String(scope.identity.contractVersion)];
    rows.push(["escopo",...provenance,...Array<string>(12).fill(""),...origin,...Array<string>(6).fill("")]);
    for (const entity of scope.entities) for (const metric of entity.indicators) {
      const result = period === "atual" ? compareSnapshotIndicator(metric,entity,scopes.previousEntities.get(entity.id)) : null;
      rows.push(["indicador",...provenance,entity.id,entity.name,entity.currency ?? "",entity.timezone,metric.key,metric.value ?? "",metric.state,metric.unit,
        result?.previousValue ?? "",result?.absoluteChange ?? "",result?.percentChange ?? "",result?.reason ?? "",...origin,metric.nativeKey,metric.aggregationRule,
        entity.attributionWindow ?? "",entity.hierarchy?.parentId ?? "",entity.hierarchy?.campaignId ?? "",entity.hierarchy?.adsetId ?? ""]);
    }
  }
  const cell = (value: string) => `"${(/^[\s\uFEFF]*[=+@-]/u.test(value) ? "'"+value : value).replaceAll('"','""')}"`;
  return { filename: `meta-${account}-${level}-${scopes.current.identity.dateFrom}-${scopes.current.identity.dateTo}-comparacao.csv`,entityCount: scopes.current.entities.length,
    content: "\uFEFF"+rows.map(row => row.map(cell).join(";")).join("\r\n")+"\r\n" };
}
