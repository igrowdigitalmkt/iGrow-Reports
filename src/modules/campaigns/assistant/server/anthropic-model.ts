import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL } from "@/modules/ai/guarded-text";
import { CHAT_CALL_LIMITS } from "./gate";
import type { AssistantModel, ModelResult, PreparedTurn } from "./handler";

// Adaptador do Assistente Groow para a Anthropic. Só roda no servidor, usa a mesma credencial e o mesmo modelo da camada de IA
// existente (ANTHROPIC_API_KEY e AI_MODEL) e não conhece autorização, organização nem executor: recebe um turno já autorizado e
// com os fatos montados. Sem ferramentas, sem function calling: a saída é só texto.
// Sem retentativas automáticas do SDK (maxRetries: 0): uma tentativa que estoura o tempo depois de processada seria cobrada de novo e só o
// uso da última apareceria. Quem repete é o usuário, com uma nova solicitação.

type Messages = { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };

/** Impede que texto vindo da plataforma de anúncios (nomes) feche a marcação em que os fatos são entregues. */
const neutralize = (text: string) => text.replace(/</g, "\\u003c");

/**
 * Mensagens da chamada: histórico curto (alternando usuário/assistente, começando pelo usuário e terminando no assistente) e, por último,
 * a mensagem atual com os fatos e a pergunta. O histórico é conversa, não fonte de fatos: os números válidos são só os de <fatos>.
 */
export function buildMessages(turn: PreparedTurn): Anthropic.MessageParam[] {
  const history: Anthropic.MessageParam[] = [];
  for (const item of turn.history) {
    const content = item.content.trim();
    if (!content) continue;
    const last = history.at(-1);
    if (!last && item.role !== "user") continue;
    if (last?.role === item.role) { history[history.length - 1] = { role: item.role, content }; continue; }
    history.push({ role: item.role, content });
  }
  if (history.at(-1)?.role === "user") history.pop();
  return [...history, { role: "user", content: `<fatos>\n${neutralize(turn.factsText)}\n</fatos>\n\n<pergunta_atual>\n${neutralize(turn.question)}\n</pergunta_atual>` }];
}

export function createAnthropicChatModel(client?: { messages: Messages }): AssistantModel {
  return {
    get configured() { return !!client || !!process.env.ANTHROPIC_API_KEY; },
    async generate(turn): Promise<ModelResult> {
      if (!client && !process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "not_configured" };
      const anthropic = client ?? new Anthropic({ timeout: 45_000, maxRetries: 0 });
      let response: Anthropic.Message;
      try {
        response = await anthropic.messages.create({
          model: AI_MODEL, max_tokens: CHAT_CALL_LIMITS.maxOutputTokens, system: turn.system,
          output_config: { effort: "low" }, messages: buildMessages(turn),
        });
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: "timeout" };
        return { ok: false, reason: error instanceof Anthropic.APIError && error.status === 429 ? "rate_limited" : "provider_error" };
      }
      const usage = {
        inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        requestId: (response as { _request_id?: string | null })._request_id ?? null, model: AI_MODEL,
      };
      const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
      // Resposta cortada pelo limite de saída, recusada ou vazia nunca é entregue como se estivesse completa.
      if (response.stop_reason !== "end_turn") return { ok: false, reason: "incomplete", usage };
      if (!text) return { ok: false, reason: "empty", usage };
      return { ok: true, text, usage };
    },
  };
}
