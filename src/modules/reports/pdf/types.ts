import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

export type PdfBlockKey = "delivery" | "performance" | "analysis" | "campaigns" | "accounts" | "audience" | "balances";

export type AudienceGroup = { title: string; total: string; items: Array<{ label: string; value: number; display: string }> };
export type BalanceRow = { name: string; status: string; cells: Array<{ label: string; value: string; sub?: string }> };

export type ReportPdfInput = {
  clientName: string;
  workspaceName: string;
  analysisNote?: string;
  // Relatório de uma conta dentro de um PDF com várias contas: o nome aparece no cabeçalho.
  accountLabel?: string;
  // Plataforma da seção (aparece na capa). Sem valor, Meta Ads.
  platformLabel?: string;
  data: AnalyticsDashboardData;
  // Hierarquia do relatório salvo; as campanhas dela têm prioridade sobre `data.campaigns`.
  entityRows?: AnalyticsEntity[];
  // Blocos que dependem de dados que ainda não vêm congelados no relatório salvo: só aparecem quando informados.
  audience?: { indicator: string; groups: AudienceGroup[] };
  balances?: BalanceRow[];
  // Resumo e resultados sempre entram. Os demais blocos ficam ligados, salvo `false`.
  blocks?: Partial<Record<PdfBlockKey, boolean>>;
  brandColor?: string;
};
