import "server-only";
import { requireAgencyContext } from "@/modules/agencies/context";
import { asBillingDb, callRpc } from "./db";
import { parseOffers, type Offer } from "./offers";
import { resolveBillingCredentials } from "./credentials";
import type { BillingEnvironment } from "./config";
import { createBillingRuntime } from "./server";
import { parseBillingSnapshot, type BillingSnapshot } from "./status-view";

export type SubscriptionPageData = {
  configured: boolean; canView: boolean; role: string; agencyName: string;
  billing: BillingSnapshot | null; offers: Offer[]; hasBillingData: boolean; environment?: BillingEnvironment;
};

/** Dados da tela de assinatura, lidos com a sessão do usuário (o banco confere papel e organização). */
export async function loadSubscriptionPage(): Promise<SubscriptionPageData> {
  const context = await requireAgencyContext();
  const credentials = await resolveBillingCredentials();
  const runtime = await createBillingRuntime(credentials);
  const base = { configured: Boolean(runtime), environment: credentials?.environment, role: context.role, agencyName: context.agency.name };
  if (context.role !== "owner" && context.role !== "admin") return { ...base, canView: false, billing: null, offers: [], hasBillingData: false };
  const db = asBillingDb(context.supabase);
  const [billing, offers] = await Promise.all([
    callRpc(db, "get_agency_billing", { p_agency_id: context.agency.id }).then(parseBillingSnapshot, () => null),
    callRpc(db, "billing_list_offers", { p_agency_id: context.agency.id }).then(parseOffers, () => [] as Offer[]),
  ]);
  const hasBillingData = runtime ? Boolean(await callRpc<string | null>(runtime.db, "billing_get_customer", { p_agency_id: context.agency.id, p_environment: runtime.environment }).catch(() => null)) : false;
  return { ...base, canView: true, billing, offers, hasBillingData };
}
