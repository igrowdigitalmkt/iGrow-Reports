import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AsaasError, type AsaasWebhookInfo } from "@/modules/billing/asaas-client";

// Regras puras da área Integrações > Pagamentos (Asaas) do Super Admin: estado lido do banco (sem segredos), verificação do webhook,
// impressão digital da conta e geração do token. Nada aqui guarda ou devolve chave de API.

export const WEBHOOK_PATH = "/api/webhooks/asaas";
export const DEFAULT_APP_URL = "https://i-grow-reports.vercel.app";

/** Endereço que o Asaas deve chamar (o mesmo domínio do aplicativo deste ambiente). */
export function webhookUrl(appUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  return `${(appUrl?.trim() || DEFAULT_APP_URL).replace(/\/+$/, "")}${WEBHOOK_PATH}`;
}

/** Os 18 eventos homologados (a rotina de reconciliação cobre falhas de entrega, mas todos devem estar marcados). */
export const REQUIRED_WEBHOOK_EVENTS = [
  "PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "SUBSCRIPTION_CREATED", "SUBSCRIPTION_UPDATED", "SUBSCRIPTION_DELETED",
  "SUBSCRIPTION_INACTIVATED", "CHECKOUT_CREATED", "CHECKOUT_PAID", "CHECKOUT_CANCELED", "CHECKOUT_EXPIRED",
] as const;

export type ConnectionResult = "connected" | "auth_failed" | "unreachable";
export type WebhookCheckResult = "ok" | "missing" | "disabled" | "interrupted" | "no_token" | "incomplete_events" | "duplicate" | "unreachable" | "auth_failed";

/** 401/403 = o Asaas recusou a chave; qualquer outra falha (rede, tempo, 5xx, formato) = falha de comunicação. Nunca devolve detalhes do erro. */
export function classifyAsaasFailure(error: unknown): "auth_failed" | "unreachable" {
  return error instanceof AsaasError && (error.status === 401 || error.status === 403) ? "auth_failed" : "unreachable";
}

export const CONNECTION_MESSAGES: Record<ConnectionResult, string> = {
  connected: "Conectado: o Asaas aceitou a chave. Nenhuma cobrança, cliente ou assinatura foi criada.",
  auth_failed: "Falha de autenticação: o Asaas recusou a chave. Registre uma chave válida.",
  unreachable: "Falha de comunicação com o Asaas. Tente novamente em instantes.",
};
export const WEBHOOK_MESSAGES: Record<WebhookCheckResult, string> = {
  ok: "Webhook encontrado no Asaas, ativo, com token e com todos os eventos. (O Asaas não revela o valor do token; o recebimento real é confirmado pelo último evento recebido.)",
  missing: "Nenhum webhook com este endereço foi encontrado no Asaas. Cadastre-o manualmente (instruções abaixo).",
  disabled: "O webhook existe, mas está desativado no Asaas.",
  interrupted: "O webhook está interrompido no Asaas (muitas falhas de entrega). Corrija a causa e reative a fila no painel do Asaas.",
  no_token: "O webhook existe, mas está sem token de autenticação no Asaas. Informe o token atual.",
  incomplete_events: "O webhook não está marcado com todos os eventos necessários. Confira a lista abaixo.",
  duplicate: "Há mais de um webhook com este endereço no Asaas. Mantenha apenas um (nada foi criado ou removido por esta tela).",
  unreachable: "Falha de comunicação com o Asaas. Tente novamente em instantes.",
  auth_failed: "Falha de autenticação: o Asaas recusou a chave.",
};

export function evaluateWebhook(webhooks: readonly AsaasWebhookInfo[], url: string): WebhookCheckResult {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "").toLowerCase();
  const matches = webhooks.filter(item => normalize(item.url) === normalize(url));
  if (matches.length === 0) return "missing";
  if (matches.length > 1) return "duplicate";
  const hook = matches[0];
  if (!hook.enabled) return "disabled";
  if (hook.interrupted) return "interrupted";
  if (!hook.hasAuthToken) return "no_token";
  if (hook.events && hook.events.length > 0 && REQUIRED_WEBHOOK_EVENTS.some(event => !hook.events!.includes(event))) return "incomplete_events";
  return "ok";
}

/** Impressão digital da conta Asaas por ambiente (SHA-256 do identificador da conta; não é reversível e não é segredo). */
export function accountFingerprint(environment: "sandbox" | "production", accountId: string): string {
  return createHash("sha256").update(`igrow:asaas:${environment}:${accountId}`).digest("hex");
}

/** Token do webhook: 48 caracteres aleatórios (base64url). Atende à regra do Asaas e nunca se parece com uma chave de API. */
export function generateWebhookToken(): string {
  return randomBytes(36).toString("base64url");
}

const cronSchema = z.object({ ok: z.boolean(), flags: z.array(z.string()), last_success_at: z.string().nullable(), last_run_status: z.string().nullable(), minutes_since_success: z.number().nullable() }).passthrough();
export const asaasStateSchema = z.object({
  managed: z.boolean(), environment: z.enum(["sandbox", "production"]).nullable(),
  key_configured: z.boolean(), key_changed_at: z.string().nullable(), key_status: z.enum(["unverified", "connected", "auth_failed", "unreachable"]), key_checked_at: z.string().nullable(),
  account_registered: z.boolean(),
  webhook_token_configured: z.boolean(), webhook_token_changed_at: z.string().nullable(), previous_token_active: z.boolean(), previous_token_expires_at: z.string().nullable(),
  webhook_status: z.enum(["unknown", "ok", "missing", "disabled", "interrupted", "no_token", "incomplete_events", "duplicate", "unreachable", "auth_failed"]), webhook_checked_at: z.string().nullable(),
  live_enabled: z.boolean(),
  links: z.object({ subscriptions: z.number(), payments: z.number(), checkouts: z.number(), customers: z.number(), open_events: z.number() }),
  last_event_at: z.string().nullable(),
  events: z.object({ failed: z.number(), needs_review: z.number(), pending: z.number() }),
  cron: cronSchema,
});
export type AsaasIntegrationState = z.infer<typeof asaasStateSchema>;

export const keyFormSchema = z.object({
  environment: z.enum(["sandbox", "production"], { message: "Escolha o ambiente (Sandbox ou Produção)." }),
  apiKey: z.string().trim().min(20, "Informe a chave de API do Asaas.").max(400, "Chave de API em formato inválido.").refine(value => !/\s/.test(value), "Chave de API em formato inválido."),
});
