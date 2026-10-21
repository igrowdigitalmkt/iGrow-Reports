"use server";

import { billingBlockOf } from "@/modules/billing/guard";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { creditInputSchema, creditRemoveSchema } from "./credit-balance";
import { linkedGoogleAccounts } from "./provider";

export type CreditActionResult = { ok: true } | { ok: false; message: string };

// Quem pode informar créditos: os mesmos papéis que alteram vínculos de contas do Google Ads.
const canEdit = (role: string) => role === "owner" || role === "admin" || role === "editor";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Registra um crédito (depósito) informado manualmente para uma conta do Google Ads do cliente. Não escreve nada no Google: só guarda o
 * valor para a estimativa de saldo. Confere papel, organização do cliente e vínculo da conta; o valor nunca é alterado depois (só removido).
 */
export async function addGoogleCreditAction(input: unknown): Promise<CreditActionResult> {
  const parsed = creditInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message === "Use no máximo duas casas decimais." ? "Use no máximo duas casas decimais." : "Confira o valor e a data do depósito." };
  const { clientId, accountId, amount, depositedOn, note } = parsed.data;
  if (depositedOn > today()) return { ok: false, message: "A data do depósito não pode ser futura." };
  const context = await requireAgencyContext();
  if (!canEdit(context.role)) return { ok: false, message: "Seu perfil não pode informar créditos. Peça a um editor, administrador ou proprietário." };
  const service = createSupabaseServiceClient();
  if (!service) return { ok: false, message: "Não foi possível salvar agora." };
  try {
    const { data: client } = await context.supabase.from("clients").select("id").eq("id", clientId).eq("agency_id", context.agency.id).maybeSingle();
    if (!client) return { ok: false, message: "Cliente não encontrado." };
    const account = (await linkedGoogleAccounts(service, context.agency.id, clientId)).find(item => item.id === accountId);
    if (!account) return { ok: false, message: "Esta conta do Google Ads não está vinculada ao cliente." };
    const { error } = await service.from("google_account_credits").insert({
      agency_id: context.agency.id, google_ad_account_id: account.id, amount, currency: account.currency.toUpperCase(), deposited_on: depositedOn,
      note: note || null, created_by: context.user.id,
    });
    if (error) return { ok: false, message: "Não foi possível salvar o crédito. Tente novamente." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: billingBlockOf(error)?.error ?? "Não foi possível salvar o crédito. Tente novamente." };
  }
}

/** Remove (marca como removido, sem apagar o histórico) um crédito informado. */
export async function removeGoogleCreditAction(input: unknown): Promise<CreditActionResult> {
  const parsed = creditRemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Crédito inválido." };
  const context = await requireAgencyContext();
  if (!canEdit(context.role)) return { ok: false, message: "Seu perfil não pode remover créditos." };
  const service = createSupabaseServiceClient();
  if (!service) return { ok: false, message: "Não foi possível remover agora." };
  try {
    const { data: credit } = await service.from("google_account_credits").select("id,google_ad_account_id,removed_at").eq("id", parsed.data.creditId).eq("agency_id", context.agency.id).maybeSingle();
    if (!credit || credit.removed_at) return { ok: false, message: "Crédito não encontrado." };
    // O crédito precisa ser de uma conta vinculada ao cliente da tela.
    const linked = (await linkedGoogleAccounts(service, context.agency.id, parsed.data.clientId)).some(account => account.id === credit.google_ad_account_id);
    if (!linked) return { ok: false, message: "Crédito não encontrado." };
    const { error } = await service.from("google_account_credits").update({ removed_at: new Date().toISOString(), removed_by: context.user.id }).eq("id", credit.id).is("removed_at", null);
    if (error) return { ok: false, message: "Não foi possível remover o crédito." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Não foi possível remover o crédito." };
  }
}

