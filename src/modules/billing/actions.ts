"use server";

import { requireAgencyContext } from "@/modules/agencies/context";
import { runCancel, type CancelActionResult } from "./cancel-flow";
import { runCheckoutStart, type CheckoutStartResult } from "./checkout-flow";
import { asBillingDb, callRpc } from "./db";
import { createBillingRuntime } from "./server";

/**
 * Inicia a contratação (somente o proprietário). Lê do navegador apenas plano, ciclo, chave de reenvio e dados de cobrança;
 * o preço vem do banco. Devolve o endereço do checkout hospedado do Asaas ou uma mensagem; nunca ativa nada.
 */
export async function startCheckoutAction(input: unknown): Promise<CheckoutStartResult> {
  const context = await requireAgencyContext();
  const deps = await createBillingRuntime();
  if (!deps) return { status: "error", message: "A contratação ainda não está disponível neste ambiente." };
  return runCheckoutStart(deps, {
    agencyId: context.agency.id, userId: context.user.id, role: context.role, origin: process.env.NEXT_PUBLIC_APP_URL,
    listOffers: () => callRpc(asBillingDb(context.supabase), "billing_list_offers", { p_agency_id: context.agency.id }),
  }, input);
}

/**
 * Cancelamento da assinatura (somente o proprietário: conferido aqui e de novo no banco). Sem parâmetros do navegador: a organização e o
 * usuário vêm da sessão. Não reembolsa, não apaga dados e não encurta o período já pago.
 */
export async function cancelSubscriptionAction(): Promise<CancelActionResult> {
  const context = await requireAgencyContext();
  const deps = await createBillingRuntime();
  if (!deps) return { status: "error", message: "O cancelamento ainda não está disponível neste ambiente." };
  return runCancel(deps, { agencyId: context.agency.id, userId: context.user.id, role: context.role });
}
