import type { AssistantMessage, ConversationState } from "./contracts";

export const initialConversation: ConversationState = { status: "idle", messages: [], error: null };

/**
 * Política de continuidade (primeira versão): cada contexto (organização, cliente, plataforma, conta, entidade e período) tem a sua
 * própria conversa, guardada só na memória da página. Trocar de contexto mostra a conversa daquele contexto, nunca a de outro; uma
 * resposta que chega depois da troca fica no contexto de origem. Trocar de cliente remonta a tela e descarta tudo. Nada é persistido.
 */
export const CONVERSATION_LIMITS = { messagesPerContext: 20, contexts: 8 };

export type ConversationAction =
  | { type: "user_sent"; message: AssistantMessage }
  | { type: "assistant_replied"; message: AssistantMessage }
  | { type: "failed"; error: string }
  | { type: "reset" };

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  const cap = (messages: AssistantMessage[]) => messages.slice(-CONVERSATION_LIMITS.messagesPerContext);
  switch (action.type) {
    case "user_sent": return { status: "sending", messages: cap([...state.messages, action.message]), error: null };
    case "assistant_replied": return { status: "idle", messages: cap([...state.messages, action.message]), error: null };
    case "failed": return { ...state, status: "error", error: action.error };
    case "reset": return initialConversation;
  }
}

export type ConversationsState = { byContext: Record<string, ConversationState>; order: string[] };
export const initialConversations: ConversationsState = { byContext: {}, order: [] };
export type ConversationsAction = { contextKey: string; action: ConversationAction };

/** Conversas por contexto, com no máximo `contexts` contextos na memória (o menos recente sai primeiro). */
export function conversationsReducer(state: ConversationsState, { contextKey, action }: ConversationsAction): ConversationsState {
  const next = conversationReducer(state.byContext[contextKey] ?? initialConversation, action);
  const order = [...state.order.filter(key => key !== contextKey), contextKey].slice(-CONVERSATION_LIMITS.contexts);
  const byContext: Record<string, ConversationState> = {};
  for (const key of order) byContext[key] = key === contextKey ? next : state.byContext[key]!;
  return { byContext, order };
}

export const conversationOf = (state: ConversationsState, contextKey: string): ConversationState => state.byContext[contextKey] ?? initialConversation;
