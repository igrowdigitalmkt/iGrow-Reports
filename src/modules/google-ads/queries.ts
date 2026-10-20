// Consultas GAQL do relatório. As datas entram sempre validadas (AAAA-MM-DD).
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function range(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error("Período inválido para a consulta do Google Ads.");
  return `segments.date BETWEEN '${from}' AND '${to}'`;
}

const METRICS = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.video_trueview_views";

/** Uma linha por dia, no fuso da conta. */
export const accountDailyQuery = (from: string, to: string) =>
  `SELECT segments.date, ${METRICS} FROM customer WHERE ${range(from, to)} ORDER BY segments.date`;

/** Total do período por campanha (sem segmentar por dia). */
export const campaignQuery = (from: string, to: string) =>
  `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS} FROM campaign WHERE ${range(from, to)} AND campaign.status != 'REMOVED'`;

/** Todas as campanhas da conta (sem métricas, sem filtro de data): inclui as ativas que ainda não tiveram entrega no período. */
export const campaignListQuery = () =>
  "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'";

/** Grupos de anúncios com o total do período (só os que tiveram atividade) e a lista completa (com estado, sem métricas). */
export const adGroupQuery = (from: string, to: string) =>
  `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, campaign.name, campaign.advertising_channel_type, ${METRICS} FROM ad_group WHERE ${range(from, to)} AND ad_group.status != 'REMOVED'`;
export const adGroupListQuery = () =>
  "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'";

/** Anúncios com o total do período e a lista completa. Anúncios responsivos não têm nome: o primeiro título é usado como nome. */
export const adRowsQuery = (from: string, to: string) =>
  `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status, ad_group.id, campaign.id, campaign.advertising_channel_type, ${METRICS} FROM ad_group_ad WHERE ${range(from, to)} AND ad_group_ad.status != 'REMOVED'`;
export const adListQuery = () =>
  "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'";

/** Total do período por anúncio, só os que apareceram. */
export const adQuery = (from: string, to: string) =>
  `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group.id, ad_group.name, campaign.id, campaign.name, campaign.advertising_channel_type, ${METRICS} FROM ad_group_ad WHERE ${range(from, to)} AND metrics.impressions > 0`;
