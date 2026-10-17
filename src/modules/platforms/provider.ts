import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { PlatformKey } from "./registry";

// O que um conector de plataforma entrega ao Groow Ads. Todo relatório (dashboard, PDF, mensagem) é montado a partir
// destas seções, uma por plataforma e, dentro dela, uma por conta de anúncios. Um conector novo só precisa
// preencher `AnalyticsDashboardData` (mesmo formato da Meta) para a conta; o resto da plataforma não muda.
export type PlatformAccountSection = { id: string; name: string; data: AnalyticsDashboardData };
export type PlatformSection = { platform: PlatformKey; accounts: PlatformAccountSection[] };

export interface AdPlatformProvider {
  readonly platform: PlatformKey;
  /** Números de cada conta de anúncios do cliente no período (uma seção por conta, nunca somados entre contas). */
  loadAccountSections(input: { agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds?: string[] }): Promise<PlatformAccountSection[]>;
}
