import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import { columnValue, rowKey, type ColumnDef, type CostIndex } from "../columns";
import type { CampaignRow } from "../tree";

/**
 * Exportação CSV de TODAS as linhas do resultado filtrado do nível ativo (não só da página): respeita nível, escopo da seleção, busca,
 * filtros, ordem, colunas escolhidas e moeda. Valor indisponível sai VAZIO (nunca zero). Planilhas executam fórmulas, então células de
 * texto que começam com = + - @ ou tab/CR recebem um apóstrofo (injeção de fórmulas).
 */
const SEPARATOR = ";";
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  let text = typeof value === "number" ? String(value).replace(".", ",") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(input: { level: CampaignRow["level"]; rows: CampaignRow[]; columns: ColumnDef[]; index: CostIndex; parentNames: Map<string, string> }): string {
  const { level, rows, columns, index } = input;
  const head = ["Nome", ...(level !== "campaign" ? [level === "ad" ? "Conjunto" : "Campanha"] : []), "Conta", "Moeda", "Estado", "Estado configurado", "Estado efetivo",
    ...columns.map(column => column.label)];
  const lines = [head.map(csvCell).join(SEPARATOR)];
  for (const row of rows) {
    const cells: (string | number | null)[] = [row.name, ...(level !== "campaign" ? [input.parentNames.get(`${row.accountId}|${row.level}|${row.id}`) ?? null] : []),
      row.accountName, row.currency, row.state.label, row.state.configured?.label ?? null, row.state.effective?.label ?? null];
    for (const column of columns) {
      if (column.key === "results") cells.push(resultBreakdown(row.values).map(result => `${result.label}: ${result.value}`).join(" | ") || null);
      else if (column.key === "cost_result") {
        // Custo ATRIBUÍDO por tipo (só quando confiável); tipo sem atribuição fica de fora, nunca vira zero.
        const costs = resultBreakdown(row.values).flatMap(result => { const cost = index.get(rowKey(row))?.get(result.key); return cost == null ? [] : [`${result.label}: ${String(cost).replace(".", ",")}`]; });
        cells.push(costs.join(" | ") || null);
      }
      else cells.push(columnValue(row, column.key, index) ?? null);
    }
    lines.push(cells.map(csvCell).join(SEPARATOR));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
