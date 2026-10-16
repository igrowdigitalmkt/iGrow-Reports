"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Json } from "@/types/database";
import { authorizePlatformAction } from "../guard";
import { adminRpc, billingSettingsFormSchema } from "./billing-settings";
import { parseMoneyToCents, planKeySchema, USD_LIMIT_KEYS } from "./format";

export type FormState = { error: string | null; ok: string | null };
const fail = (error: string): FormState => ({ error, ok: null });
const done = (ok: string): FormState => ({ error: null, ok });

const uuid = z.string().uuid();

/** Mensagens do banco em português (22023) aparecem como estão; o restante vira texto genérico. */
function dbMessage(error: { code?: string; message?: string }) {
  switch (error.code) {
    case "22023": return error.message ?? "Dados inválidos.";
    case "23505": return "Já existe um registro com este identificador (ou um rascunho em aberto).";
    case "23514": return "Algum valor está fora do permitido. Confira os campos.";
    case "42501": return "Sem permissão. Entre novamente e confirme a verificação em duas etapas.";
    default: return "Não foi possível concluir. Tente novamente.";
  }
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

async function definitions(supabase: Awaited<ReturnType<typeof authorizePlatformAction>> & { ok: true }) {
  const { data } = await supabase.supabase.rpc("platform_list_definitions");
  return data ?? [];
}

export async function createPlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const key = planKeySchema.safeParse(text(formData, "key"));
  const name = z.string().trim().min(2, "Informe o nome do plano (2 a 80 caracteres).").max(80).safeParse(text(formData, "name"));
  const visibility = z.enum(["public", "private"]).safeParse(text(formData, "visibility"));
  if (!key.success) return fail(key.error.issues[0].message);
  if (!name.success) return fail(name.error.issues[0].message);
  if (!visibility.success) return fail("Escolha a visibilidade do plano.");
  const { data, error } = await auth.supabase.rpc("platform_create_plan", { p_key: key.data, p_name: name.data, p_description: text(formData, "description").slice(0, 500), p_visibility: visibility.data });
  if (error || !data) return fail(dbMessage(error ?? {}));
  revalidatePath("/admin/planos");
  redirect(`/admin/planos/${data}`);
}

export async function updatePlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const id = uuid.safeParse(text(formData, "planId"));
  const name = z.string().trim().min(2, "Informe o nome do plano (2 a 80 caracteres).").max(80).safeParse(text(formData, "name"));
  const visibility = z.enum(["public", "private"]).safeParse(text(formData, "visibility"));
  const order = z.coerce.number().int().min(0).max(100000).safeParse(text(formData, "sortOrder") || "100");
  if (!id.success || !visibility.success) return fail("Solicitação inválida. Atualize a página.");
  if (!name.success) return fail(name.error.issues[0].message);
  if (!order.success) return fail("A ordem é um número inteiro (menor aparece primeiro).");
  const { error } = await auth.supabase.rpc("platform_update_plan", { p_plan_id: id.data, p_name: name.data, p_description: text(formData, "description").slice(0, 500),
    p_visibility: visibility.data, p_sellable: formData.get("sellable") === "on", p_recommended: formData.get("recommended") === "on", p_sort_order: order.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/planos", "layout");
  return done("Dados do plano salvos.");
}

export async function startDraftAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const id = uuid.safeParse(text(formData, "planId"));
  if (!id.success) return fail("Solicitação inválida.");
  const { error } = await auth.supabase.rpc("platform_start_draft", { p_plan_id: id.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/planos", "layout");
  return done("Nova versão criada como rascunho.");
}

export async function discardDraftAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const id = uuid.safeParse(text(formData, "planId"));
  if (!id.success) return fail("Solicitação inválida.");
  const { error } = await auth.supabase.rpc("platform_discard_draft", { p_plan_id: id.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/planos", "layout");
  return done("Rascunho descartado.");
}

/** Salva o rascunho; com intent=publish, publica em seguida (nova versão para quem contratar ou for atribuído depois). */
export async function saveDraftAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const id = uuid.safeParse(text(formData, "planId"));
  const trial = z.coerce.number().int().min(0).max(90).safeParse(text(formData, "trialDays") || "0");
  const monthly = parseMoneyToCents(formData.get("priceMonthly"));
  const yearly = parseMoneyToCents(formData.get("priceYearly"));
  if (!id.success) return fail("Solicitação inválida.");
  if (!trial.success) return fail("O teste gratuito vai de 0 a 90 dias.");
  if (monthly === undefined || yearly === undefined) return fail("Preço inválido. Use o formato 49,90 (ou deixe vazio se o ciclo não for oferecido).");
  const entitlements: Json[] = [];
  for (const def of await definitions(auth)) {
    if (def.kind === "feature") {
      if (formData.get(`ent_${def.key}`) === "on") entitlements.push({ key: def.key, enabled: true });
      continue;
    }
    const mode = text(formData, `mode_${def.key}`);
    if (mode === "unlimited") entitlements.push({ key: def.key, unlimited: true });
    else if (mode === "limit") {
      const raw = text(formData, `limit_${def.key}`);
      const value = USD_LIMIT_KEYS.has(def.key) ? parseMoneyToCents(raw) : /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
      if (value == null) return fail(`Informe um limite válido para "${def.label}".`);
      entitlements.push({ key: def.key, limit: value });
    }
  }
  const { error } = await auth.supabase.rpc("platform_save_draft", { p_plan_id: id.data, p_trial_days: trial.data, p_price_monthly_cents: monthly, p_price_yearly_cents: yearly, p_entitlements: entitlements });
  if (error) return fail(dbMessage(error));
  if (formData.get("intent") === "publish") {
    const published = await auth.supabase.rpc("platform_publish_draft", { p_plan_id: id.data });
    if (published.error) return fail(dbMessage(published.error));
    revalidatePath("/admin/planos", "layout");
    return done(`Versão ${published.data} publicada. Quem já usa uma versão anterior continua com as condições dela.`);
  }
  revalidatePath("/admin/planos", "layout");
  return done("Rascunho salvo. Ele só vale depois de publicado.");
}

export async function setFeatureSwitchAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const key = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/).safeParse(text(formData, "key"));
  const enable = text(formData, "enable") === "1";
  if (!key.success) return fail("Solicitação inválida.");
  if (!enable && formData.get("confirm") !== "on") return fail("Marque a confirmação: a desativação vale para todas as organizações.");
  const { error } = await auth.supabase.rpc("platform_set_feature_switch", { p_key: key.data, p_enabled: enable, p_reason: text(formData, "reason").slice(0, 300) || null });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/recursos");
  return done(enable ? "Funcionalidade reativada." : "Funcionalidade desativada para todas as organizações.");
}

export async function assignPlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const agency = uuid.safeParse(text(formData, "agencyId"));
  const version = uuid.safeParse(text(formData, "versionId"));
  if (!agency.success) return fail("Solicitação inválida.");
  if (!version.success) return fail("Escolha o plano.");
  const note = text(formData, "note").slice(0, 300);
  if (note.length < 3) return fail("Informe o motivo da concessão (ex.: parceiro, cortesia, organização fundadora).");
  const { data, error } = await auth.supabase.rpc("platform_assign_plan", { p_agency_id: agency.data, p_plan_version_id: version.data, p_note: note });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/organizacoes", "layout");
  const over = (data as { over_limit?: { label: string; used: number; limit: number }[] } | null)?.over_limit ?? [];
  return done(over.length
    ? `Concessão registrada. Atenção: já acima do limite (nada foi removido; só novas adições serão bloqueadas): ${over.map((item) => `${item.label} ${item.used}/${item.limit}`).join(", ")}.`
    : "Concessão registrada. As regras do plano já valem para esta organização.");
}

export async function unassignPlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const agency = uuid.safeParse(text(formData, "agencyId"));
  if (!agency.success) return fail("Solicitação inválida.");
  const { error } = await auth.supabase.rpc("platform_unassign_plan", { p_agency_id: agency.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/organizacoes", "layout");
  return done("Plano removido. A organização volta a não ter restrições comerciais.");
}

export async function grantOverrideAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const agency = uuid.safeParse(text(formData, "agencyId"));
  const key = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/).safeParse(text(formData, "key"));
  if (!agency.success || !key.success) return fail("Solicitação inválida.");
  const def = (await definitions(auth)).find((item) => item.key === key.data);
  if (!def) return fail("Recurso desconhecido.");
  const reason = text(formData, "reason");
  if (reason.length < 3) return fail("Informe o motivo da concessão.");
  const until = text(formData, "until");
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return fail("Data de validade inválida.");
  let enabled: boolean | null = null;
  let limit: number | null = null;
  let unlimited = false;
  if (def.kind === "feature") enabled = text(formData, "featureValue") !== "block";
  else if (text(formData, "limitMode") === "unlimited") unlimited = true;
  else {
    const raw = text(formData, "limitValue");
    const value = USD_LIMIT_KEYS.has(def.key) ? parseMoneyToCents(raw) : /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
    if (value == null) return fail("Informe o limite concedido (ou marque ilimitado).");
    limit = value;
  }
  const { error } = await auth.supabase.rpc("platform_grant_override", { p_agency_id: agency.data, p_key: key.data, p_enabled: enabled, p_limit: limit, p_unlimited: unlimited,
    p_expires_at: until ? `${until}T23:59:59-03:00` : null, p_reason: reason.slice(0, 300) });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/organizacoes", "layout");
  return done("Concessão registrada.");
}

export async function revokeOverrideAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const id = uuid.safeParse(text(formData, "overrideId"));
  if (!id.success) return fail("Solicitação inválida.");
  const { error } = await auth.supabase.rpc("platform_revoke_override", { p_override_id: id.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/organizacoes", "layout");
  return done("Concessão revogada.");
}

/** Configurações comerciais: teste gratuito, tolerância e validade do checkout. Nunca toca em live_enabled (decisão fora da interface). */
export async function updateBillingSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const parsed = billingSettingsFormSchema.safeParse({ trialDays: text(formData, "trialDays"), graceDays: text(formData, "graceDays"),
    checkoutMinutes: text(formData, "checkoutMinutes"), trialPlanVersionId: text(formData, "trialPlanVersionId") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { error } = await adminRpc(auth.supabase)("platform_update_billing_settings", { p_trial_days: parsed.data.trialDays,
    p_trial_plan_version_id: parsed.data.trialPlanVersionId, p_past_due_grace_days: parsed.data.graceDays, p_checkout_minutes: parsed.data.checkoutMinutes });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/comercial");
  return done("Configurações salvas. Valem para novos testes, assinaturas e checkouts; os já existentes não mudam.");
}
