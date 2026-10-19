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
      const anthropic = client ?? new Anthropic();
      const response = await anthropic.messages.create({
        model: AI_MODEL, max_tokens: 2500, system,
        tools: [DECISION_TOOL], tool_choice: { type: "tool", name: DECISION_TOOL.name },
        messages: [{ role: "user", content: `Fatos confirmados (JSON):\n${factsText}` }],
      });
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
