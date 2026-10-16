"use server";

import { revalidatePath } from "next/cache";
import { createAsaasAdminProbe } from "@/modules/billing/asaas-client";
import { asaasKeyProblem, buildAsaasConfig, type AsaasConfigProblem } from "@/modules/billing/config";
import { resolveBillingCredentials } from "@/modules/billing/credentials";
import { authorizePlatformAction } from "../guard";
import { adminRpc } from "../commercial/billing-settings";
import { accountFingerprint, asaasStateSchema, classifyAsaasFailure, CONNECTION_MESSAGES, evaluateWebhook, generateWebhookToken, keyFormSchema, webhookUrl, WEBHOOK_MESSAGES } from "./asaas";
import { z } from "zod";

// Ações do Super Admin para a integração com o Asaas. Todas: operador autenticado COM MFA (conferido aqui e de novo no banco),
// validação no servidor e auditoria no banco sem valores secretos. A chave e o token nunca são devolvidos ao navegador depois de gravados
// (o token novo aparece uma única vez, na resposta da rotação). Nenhuma ação cria cobrança, cliente, assinatura ou webhook no Asaas.
export type IntegrationFormState = { error: string | null; ok: string | null; secret?: string | null };
const fail = (error: string): IntegrationFormState => ({ error, ok: null });
const done = (ok: string, secret?: string): IntegrationFormState => ({ error: null, ok, secret: secret ?? null });

function dbMessage(error: { code?: string; message?: string }) {
  switch (error.code) {
    case "22023": return error.message ?? "Dados inválidos.";
    case "42501": return "Sem permissão. Entre novamente e confirme a verificação em duas etapas.";
    default: return "Não foi possível concluir. Tente novamente.";
  }
}

const KEY_PROBLEMS: Record<AsaasConfigProblem, string> = {
  environment_invalid: "Escolha o ambiente (Sandbox ou Produção).",
  missing_key: "Informe a chave de API do Asaas.",
  invalid_key: "Chave de API em formato inválido.",
  production_key: "Chave de produção não pode ser usada no ambiente Sandbox.",
  sandbox_key: "Em Produção, a chave precisa ser uma chave de produção do Asaas.",
  production_not_unlocked: "Chave de API em formato inválido.", // não ocorre: o desbloqueio não é avaliado aqui
};

/** Registra ou substitui a chave. A chave é validada na API do Asaas (leitura, sem efeito financeiro) ANTES de ser guardada. */
export async function saveAsaasKeyAction(_state: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const parsed = keyFormSchema.safeParse({ environment: String(formData.get("environment") ?? ""), apiKey: String(formData.get("apiKey") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { environment, apiKey } = parsed.data;
  const problem = asaasKeyProblem(environment, apiKey, true);
  if (problem) return fail(KEY_PROBLEMS[problem]);

  // Trocar o ambiente ativo exige confirmação: evita misturar operações de teste com registros reais por descuido.
  const current = asaasStateSchema.safeParse((await adminRpc(auth.supabase)("platform_asaas_get_state", { p_environment: environment })).data);
  if (current.success && current.data.environment && current.data.environment !== environment && formData.get("confirmEnvironment") !== "on") {
    return fail(`O ambiente ativo hoje é ${current.data.environment === "production" ? "Produção" : "Sandbox"}. Marque a confirmação para trocar o ambiente.`);
  }

  let accountId: string;
  try { accountId = await createAsaasAdminProbe(buildAsaasConfig(environment, apiKey)).accountId(); }
  catch (error) { return fail(classifyAsaasFailure(error) === "auth_failed" ? "O Asaas recusou esta chave. Confira se ela é do ambiente escolhido e está ativa." : "Não foi possível falar com o Asaas para validar a chave. Tente novamente."); }

  const { error } = await adminRpc(auth.supabase)("platform_asaas_save_key", {
    p_environment: environment, p_api_key: apiKey, p_account_fingerprint: accountFingerprint(environment, accountId), p_confirm_same_account: formData.get("confirmSameAccount") === "on",
  });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/integracoes/pagamentos");
  return done(environment === "production"
    ? "Chave de produção registrada e validada. Isto NÃO libera cobranças reais: elas dependem do desbloqueio e da liberação comercial, que continuam separados."
    : "Chave do Sandbox registrada e validada. Já vale para toda a operação financeira, sem novo deploy.");
}

/** Teste de conexão: consulta a conta no Asaas (somente leitura). Não cria nada e não usa a trava de produção. */
export async function testAsaasConnectionAction(_state: IntegrationFormState, _formData: FormData): Promise<IntegrationFormState> {
  void _formData;
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const credentials = await resolveBillingCredentials();
  if (!credentials?.probeConfig) return fail("Configuração incompleta: registre o ambiente e a chave de API antes de testar.");
  let result: "connected" | "auth_failed" | "unreachable" = "connected";
  try { await createAsaasAdminProbe(credentials.probeConfig).accountId(); } catch (error) { result = classifyAsaasFailure(error); }
  const { error } = await adminRpc(auth.supabase)("platform_asaas_record_check", { p_kind: "connection", p_status: result });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/integracoes/pagamentos");
  return result === "connected" ? done(CONNECTION_MESSAGES.connected) : fail(CONNECTION_MESSAGES[result]);
}

/** Confere no Asaas se o webhook está cadastrado, ativo, com token e com os eventos. Somente leitura: nunca cria nem altera webhook. */
export async function checkAsaasWebhookAction(_state: IntegrationFormState, _formData: FormData): Promise<IntegrationFormState> {
  void _formData;
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const credentials = await resolveBillingCredentials();
  if (!credentials?.probeConfig) return fail("Configuração incompleta: registre o ambiente e a chave de API antes de conferir o webhook.");
  let result;
  try { result = evaluateWebhook((await createAsaasAdminProbe(credentials.probeConfig).listWebhooks()).webhooks, webhookUrl()); }
  catch (error) { result = classifyAsaasFailure(error); }
  const { error } = await adminRpc(auth.supabase)("platform_asaas_record_check", { p_kind: "webhook", p_status: result });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/integracoes/pagamentos");
  return result === "ok" ? done(WEBHOOK_MESSAGES.ok) : fail(WEBHOOK_MESSAGES[result]);
}

/** Gera um token novo (exibido UMA vez). O anterior continua valendo pelo prazo de transição escolhido e depois deixa de valer. */
export async function rotateWebhookTokenAction(_state: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const grace = z.coerce.number().int().min(0, "A transição vai de 0 a 1440 minutos.").max(1440, "A transição vai de 0 a 1440 minutos.").safeParse(String(formData.get("graceMinutes") ?? "60"));
  if (!grace.success) return fail(grace.error.issues[0].message);
  const token = generateWebhookToken();
  const { error } = await adminRpc(auth.supabase)("platform_asaas_rotate_webhook_token", { p_token: token, p_grace_minutes: grace.data });
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/integracoes/pagamentos");
  return done("Token gerado e já em vigor. Copie-o agora: ele não será exibido novamente. Em seguida, informe-o no webhook do painel do Asaas.", token);
}

/** Encerra a transição: o token anterior deixa de valer imediatamente. */
export async function revokePreviousWebhookTokenAction(_state: IntegrationFormState, _formData: FormData): Promise<IntegrationFormState> {
  void _formData;
  const auth = await authorizePlatformAction();
  if (!auth.ok) return fail(auth.error);
  const { error } = await adminRpc(auth.supabase)("platform_asaas_revoke_previous_token");
  if (error) return fail(dbMessage(error));
  revalidatePath("/admin/integracoes/pagamentos");
  return done("Token anterior revogado. Só o token atual é aceito.");
}
