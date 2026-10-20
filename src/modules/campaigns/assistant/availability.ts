import type { AssistantAvailability } from "./contracts";

/** Nesta etapa a comunicação com o modelo ainda não existe; a disponibilidade real virá do servidor (plano, permissão e integração). */
export function getAssistantAvailability(): AssistantAvailability {
  return { state: "unavailable", reason: "integration_pending", message: "O envio será liberado após a integração do assistente com a IA." };
}
