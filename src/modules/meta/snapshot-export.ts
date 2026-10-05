import type { EntityLevel } from "../integrations/data-contract";
import type { MetaSnapshotView } from "./snapshot-view";

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
      snapshotId: scope.snapshotId,collectedAt: scope.collectedAt,entities: scope.entities },null,2) + "\n",
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
  return {
    filename: `meta-${externalAccountId}-${level}-${identity.dateFrom}-${identity.dateTo}.csv`,
    content: "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n") + "\r\n",
    entityCount: scope.entities.length,
  };
}
