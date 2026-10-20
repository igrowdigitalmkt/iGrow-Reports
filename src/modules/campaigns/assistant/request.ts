import { z } from "zod";
import type { AssistantContext, AssistantMessage } from "./contracts";

export const ASSISTANT_LIMITS = { question: 1000, historyMessages: 6, historyMessageChars: 2000 };

/**
 * O que o navegador pode enviar: IDENTIFICADORES para solicitar uma análise, a pergunta e um histórico curto de texto.
 * Não existe campo de organização (vem da sessão no servidor) nem objeto de contexto pronto; campos extras são rejeitados.
 * O servidor revalida cliente, conta, entidade, nível, plataforma e período antes de usar qualquer coisa.
 */
export const askRequestSchema = z.strictObject({
  // Identificador único de CADA pergunta, gerado no navegador: o servidor só aceita cada um uma vez (evita repetição e consumo duplicado).
  requestId: z.uuid(),
  clientId: z.uuid(),
  platform: z.literal("meta"),
  period: z.strictObject({ dateFrom: z.iso.date(), dateTo: z.iso.date() }),
  target: z.discriminatedUnion("level", [
    // Contexto geral: as contas que a tela está considerando. O servidor revalida cada uma contra os vínculos autorizados do cliente.
    z.strictObject({ level: z.literal("client"), accountIds: z.array(z.uuid()).min(1).max(50) }),
    z.strictObject({ level: z.literal("account"), accountId: z.uuid() }),
    z.strictObject({ level: z.enum(["campaign", "adset", "ad"]), accountId: z.uuid(), entityId: z.string().regex(/^\d{1,30}$/) }),
  ]),
  question: z.string().trim().min(1).max(ASSISTANT_LIMITS.question),
  // Mensagens anteriores são texto NÃO verificado: o servidor nunca as trata como fatos.
  history: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().max(ASSISTANT_LIMITS.historyMessageChars) })).max(ASSISTANT_LIMITS.historyMessages).default([]),
});
export type AssistantAskRequest = z.input<typeof askRequestSchema>;
export type AssistantTarget = z.infer<typeof askRequestSchema>["target"];

/** Monta a solicitação a partir do contexto ATIVO da tela e das últimas mensagens DAQUELE contexto. */
export function buildAskRequest(context: AssistantContext, question: string, messages: AssistantMessage[], requestId: string): AssistantAskRequest {
  const target: AssistantTarget = context.level === "client" ? { level: "client", accountIds: context.accounts.map(account => account.id) }
    : context.level === "account" ? { level: "account", accountId: context.account!.id }
    : { level: context.level, accountId: context.account!.id, entityId: context.entity!.id };
  const history = messages.filter(message => message.contextKey === context.key && message.status === "sent")
    .slice(-ASSISTANT_LIMITS.historyMessages).map(message => ({ role: message.role, content: message.content.slice(0, ASSISTANT_LIMITS.historyMessageChars) }));
  return { requestId, clientId: context.scope.clientId, platform: context.scope.platform, period: { dateFrom: context.period.dateFrom, dateTo: context.period.dateTo }, target, question: question.trim(), history };
}

export type AssistantErrorCode =
  | "invalid_request" | "unauthenticated" | "forbidden" | "not_found" | "invalid_period"
  | "data_unavailable" | "assistant_unavailable" | "busy" | "duplicate_request" | "model_error" | "unverified_numbers" | "accounting_failed";

export type AssistantAskResult =
  | { ok: true; reply: { text: string; contextKey: string; factsHash: string; generatedAt: string } }
  /** `possibleCharge`: a chamada ao provedor pode ter gerado custo, mesmo sem resposta ou sem registro em ai_usage. */
  | { ok: false; code: AssistantErrorCode; message: string; possibleCharge?: boolean };
