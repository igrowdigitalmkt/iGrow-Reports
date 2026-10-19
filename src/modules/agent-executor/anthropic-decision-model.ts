import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL } from "@/modules/ai/guarded-text";
import { DECISION_TOOL } from "./decision-contract";
import type { DecisionModel } from "./decision-engine";

type Messages = { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };

/** Saida estruturada por tool use forcado; qualquer desvio vira erro (nunca texto livre como comando). */
export function createAnthropicDecisionModel(client?: { messages: Messages }): DecisionModel {
  return {
    async decide({ system, factsText }) {
      // Erros viram codigos curtos e seguros (sem chave, URL ou conteudo): ajudam o diagnostico na tela.
      if (!client && !process.env.ANTHROPIC_API_KEY) throw new Error("no_api_key");
      const anthropic = client ?? new Anthropic();
      let response: Anthropic.Message;
      try {
        response = await anthropic.messages.create({
          // Claude Sonnet 5.5 rejeita tool_choice forcado (400): usa `auto` e a instrucao no prompt.
          // A saida continua nao confiavel: o validador do servidor confere tudo.
          model: AI_MODEL, max_tokens: 8000, system: `${system}
Responda SEMPRE chamando a ferramenta ${DECISION_TOOL.name}, sem texto livre.`,
          output_config: { effort: "medium" },
          tools: [DECISION_TOOL], tool_choice: { type: "auto" },
          messages: [{ role: "user", content: `Fatos confirmados (JSON):\n${factsText}` }],
        });
      } catch (error) {
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        throw new Error(`anthropic_http_${typeof status === "number" ? status : "network"}`);
      }
      const block = response.content.find(b => b.type === "tool_use" && b.name === DECISION_TOOL.name);
      if (response.stop_reason !== "tool_use" || !block || block.type !== "tool_use") throw new Error("no_structured_output");
      return {
        output: block.input,
        usage: { inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0 },
        requestId: (response as { _request_id?: string | null })._request_id ?? null,
      };
    },
  };
}
