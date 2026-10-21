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

/** Uma linha por campanha e dia, só das campanhas escolhidas (seleção de campanhas do Dashboard). Os identificadores entram validados (só dígitos). */
export const campaignDailyQuery = (from: string, to: string, campaignIds: string[]) => {
  if (!campaignIds.length || campaignIds.length > 200 || !campaignIds.every(id => /^\d{1,20}$/.test(id))) throw new Error("Seleção de campanhas inválida para a consulta do Google Ads.");
  return `SELECT segments.date, campaign.id, ${METRICS} FROM campaign WHERE ${range(from, to)} AND campaign.id IN (${campaignIds.join(", ")}) ORDER BY segments.date`;
};

/** Total do período por campanha (sem segmentar por dia). */
export const campaignQuery = (from: string, to: string) =>
  `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS} FROM campaign WHERE ${range(from, to)} AND campaign.status != 'REMOVED'`;

/** Fontes de pagamento e gasto da conta (somente leitura). Cada uma é consultada em separado: a falha de uma não derruba as outras. */
export const accountBudgetQuery = () =>
  "SELECT account_budget.status, account_budget.name, account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type, account_budget.adjusted_spending_limit_micros, account_budget.adjusted_spending_limit_type, account_budget.total_adjustments_micros, account_budget.amount_served_micros, account_budget.approved_start_date_time, account_budget.approved_end_date_time, account_budget.approved_end_time_type FROM account_budget";
export const billingSetupQuery = () =>
  "SELECT billing_setup.id, billing_setup.status, billing_setup.payments_account_info.payments_account_id, billing_setup.payments_account_info.payments_account_name, billing_setup.payments_account_info.payments_profile_id, billing_setup.payments_account_info.payments_profile_name FROM billing_setup";
/** Gasto da conta entre duas datas (AAAA-MM-DD, validadas). */
export const spendBetweenQuery = (from: string, to: string) => `SELECT metrics.cost_micros FROM customer WHERE ${range(from, to)}`;
export const monthCostQuery = () => "SELECT metrics.cost_micros FROM customer WHERE segments.date DURING THIS_MONTH";
/** Campanhas ativas com orçamento diário, orçamento total e gasto acumulado (sem filtro de data = desde o início). */
export const campaignBudgetsQuery = () =>
  "SELECT campaign.id, campaign.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, metrics.cost_micros FROM campaign WHERE campaign.status = 'ENABLED'";

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
