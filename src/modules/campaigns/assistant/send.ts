import type { AssistantContext, AssistantMessage } from "./contracts";
import type { ConversationsAction } from "./conversation";
import { buildAskRequest } from "./request";
import type { AssistantTransport } from "./transport";

const newMessage = (role: AssistantMessage["role"], content: string, contextKey: string, createdAt = new Date().toISOString()): AssistantMessage =>
  ({ id: crypto.randomUUID(), role, content, createdAt, contextKey, status: "sent" });

/**
 * Orquestra uma pergunta do contexto ATIVO. Tudo que acontece depois (resposta, falha, resposta atrasada) é registrado no contexto de
 * ORIGEM, mesmo que o usuário já tenha trocado de entidade, conta, período ou cliente: uma resposta nunca aparece em outro contexto.
 * Uma resposta cuja chave verificada pelo servidor difere da de origem (organização, cliente, conta, entidade ou período) é descartada.
 */
export async function sendQuestion(input: {
  context: AssistantContext; text: string; history: AssistantMessage[]; transport: AssistantTransport; dispatch: (action: ConversationsAction) => void;
}): Promise<{ suspended: string | null }> {
  const { context, text, history, transport, dispatch } = input;
  const origin = context.key;
  const request = buildAskRequest(context, text, history, crypto.randomUUID());
  dispatch({ contextKey: origin, action: { type: "user_sent", message: newMessage("user", text, origin) } });
  let result;
  try { result = await transport.send(request); }
  // Sem resposta do servidor não se sabe se a chamada foi processada: a mensagem diz isso e o reenvio gera nova solicitação.
  catch { result = { ok: false as const, code: "model_error" as const, possibleCharge: true, message: "Não foi possível confirmar a resposta e a chamada pode ter sido processada. Aguarde um instante antes de tentar de novo." }; }
  if (!result.ok) {
    dispatch({ contextKey: origin, action: { type: "failed", error: result.message } });
    // Contabilização comprometida ou assistente indisponível: o envio fica suspenso nesta tela até a página ser recarregada.
    return { suspended: result.code === "accounting_failed" || result.code === "assistant_unavailable" ? result.message : null };
  }
  if (result.reply.contextKey !== origin) { dispatch({ contextKey: origin, action: { type: "failed", error: "A resposta não corresponde a este contexto e foi descartada." } }); return { suspended: null }; }
  dispatch({ contextKey: origin, action: { type: "assistant_replied", message: newMessage("assistant", result.reply.text, origin, result.reply.generatedAt) } });
  return { suspended: null };
}
