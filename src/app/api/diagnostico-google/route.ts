import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadGoogleAdsClient } from "@/modules/google-ads/server";
import { linkedGoogleAccounts } from "@/modules/google-ads/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

/** DIAGNÓSTICO TEMPORÁRIO (somente leitura, só proprietário/administrador): testa consultas de saldo e cobrança do Google Ads. Será removido. */
const QUERIES: Record<string, string> = {
  customer: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status, customer.test_account, customer.pay_per_conversion_eligibility_failure_reasons, customer.optimization_score FROM customer",
  account_budget: "SELECT account_budget.id, account_budget.name, account_budget.status, account_budget.billing_setup, account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type, account_budget.adjusted_spending_limit_micros, account_budget.proposed_spending_limit_micros, account_budget.amount_served_micros, account_budget.total_adjustments_micros, account_budget.approved_start_date_time, account_budget.approved_end_date_time, account_budget.purchase_order_number, account_budget.notes FROM account_budget",
  billing_setup: "SELECT billing_setup.id, billing_setup.status, billing_setup.payments_account, billing_setup.payments_account_info.payments_account_id, billing_setup.payments_account_info.payments_account_name, billing_setup.payments_account_info.payments_profile_id, billing_setup.payments_account_info.payments_profile_name, billing_setup.start_date_time, billing_setup.end_date_time FROM billing_setup",
  account_budget_proposal: "SELECT account_budget_proposal.id, account_budget_proposal.status, account_budget_proposal.proposal_type, account_budget_proposal.proposed_spending_limit_micros FROM account_budget_proposal",
  payments_account: "SELECT payments_account.payments_account_id, payments_account.name, payments_account.currency_code, payments_account.payments_profile_id FROM payments_account",
  applied_incentive: "SELECT applied_incentive.coupon_code, applied_incentive.incentive_state, applied_incentive.redemption_date_time, applied_incentive.reward_balance_remaining_amount_micros FROM applied_incentive",
  campaign_budget: "SELECT campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.status, campaign_budget.delivery_method, campaign_budget.explicitly_shared FROM campaign_budget WHERE campaign_budget.status != 'REMOVED'",
  cost_alltime: "SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '2026-01-01' AND '2026-10-21'",
  cost_month: "SELECT metrics.cost_micros FROM customer WHERE segments.date DURING THIS_MONTH",
  campaign_cost_alltime: "SELECT campaign.id, campaign.name, campaign_budget.total_amount_micros, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '2026-10-01' AND '2026-10-21' AND campaign.status != 'REMOVED'",
};

export async function GET(request: Request) {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return Response.json({ error: "Somente proprietário ou administrador." }, { status: 403 });
  const clientId = new URL(request.url).searchParams.get("cliente") ?? "";
  const service = createSupabaseServiceClient();
  if (!service || !/^[0-9a-f-]{36}$/i.test(clientId)) return Response.json({ error: "Parâmetros inválidos." }, { status: 400 });
  const { data: owned } = await context.supabase.from("clients").select("id").eq("id", clientId).eq("agency_id", context.agency.id).maybeSingle();
  if (!owned) return Response.json({ error: "Cliente não encontrado." }, { status: 404 });
  const accounts = await linkedGoogleAccounts(service, context.agency.id, clientId);
  const { client } = await loadGoogleAdsClient(service, context.agency.id);
  const out: Record<string, unknown> = {};
  for (const account of accounts) {
    const results: Record<string, unknown> = {};
    await Promise.all(Object.entries(QUERIES).map(async ([name, query]) => {
      try { results[name] = { ok: true, rows: await client.search(account.customerId, query, { loginCustomerId: account.loginCustomerId, maxPages: 3 }) }; }
      catch (error) { results[name] = { ok: false, error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code ?? null }; }
    }));
    out[account.name] = results;
  }
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
