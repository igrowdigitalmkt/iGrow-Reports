// Contratos do Assistente Groow na área de Campanhas. Só tipos: nenhuma comunicação com o modelo vive aqui.
// A identidade de uma entidade é sempre organização + cliente + plataforma + conta + nível + ID da plataforma; o nome é só rótulo.

export type AssistantPlatform = "meta";
export type AssistantEntityLevel = "campaign" | "adset" | "ad";
export type AssistantLevel = "client" | "account" | AssistantEntityLevel;

/** Escopo autenticado em que a tela está. Qualquer seleção de outro escopo é inválida. */
export type AssistantScope = { organizationId: string; clientId: string; platform: AssistantPlatform };

export type AssistantSelection =
  | { scope: AssistantScope; kind: "client" }
  | { scope: AssistantScope; kind: "account"; accountId: string }
  | { scope: AssistantScope; kind: "entity"; accountId: string; level: AssistantEntityLevel; entityId: string };

export type AssistantEntityRef = { level: AssistantEntityLevel; id: string; name: string };

/** Contexto ativo, já validado contra os dados atuais da tela. `key` muda sempre que a identidade muda. */
export type AssistantContext = {
  key: string;
  scope: AssistantScope;
  level: AssistantLevel;
  /** Conta do contexto de conta ou de entidade; null no contexto geral. */
  account: { id: string; name: string } | null;
  /** Contas CONSIDERADAS: no contexto geral, as selecionadas na tabela; na conta e na entidade, só ela. */
  accounts: { id: string; name: string }[];
  entity: AssistantEntityRef | null;
  /** Do pai mais próximo ao mais distante (anúncio → conjunto → campanha). */
  ancestors: AssistantEntityRef[];
  period: { dateFrom: string; dateTo: string };
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Contexto em que a mensagem foi escrita ou respondida. */
  contextKey: string;
  status: "sent" | "streaming" | "error";
};

export type ConversationState = { status: "idle" | "sending" | "error"; messages: AssistantMessage[]; error: string | null };

export type AssistantUnavailableReason =
  | "no_permission" | "not_enabled" | "integration_pending" | "feature_not_registered" | "reservation_unavailable" | "model_unavailable" | "plan" | "restricted"
  | "disabled" | "budget" | "unverifiable" | "accounting" | "metrics_pending";

export type AssistantAvailability =
  | { state: "available" }
  | { state: "unavailable"; reason: AssistantUnavailableReason; message: string };
