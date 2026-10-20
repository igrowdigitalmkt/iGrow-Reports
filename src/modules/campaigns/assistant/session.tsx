"use client";

import { createContext, useContext, useMemo, useReducer, useState, type Dispatch, type ReactNode } from "react";
import type { AssistantAvailability, AssistantContext, AssistantScope, AssistantSelection } from "./contracts";
import { resolveContext, type ContextData } from "./context";
import { conversationOf, conversationsReducer, initialConversations, type ConversationsAction, type ConversationsState } from "./conversation";
import { useHydrated, useLocalPreference, writeLocalPreference } from "../local-preference";
import { sendQuestion } from "./send";
import { serverTransport } from "./server-transport";
import type { AssistantTransport } from "./transport";

const STORAGE_KEY = "groow.campaigns.assistant";
/** Sem preferência salva, o painel abre só quando a janela tem largura para a tabela e o painel juntos (a barra principal recolhida e o menu do cliente já ocupam ~300 px). */
const WIDE_ENOUGH = 1680;
const NARROW = 900;

type Store = {
  conversations: ConversationsState; dispatch: Dispatch<ConversationsAction>;
  suspended: string | null; setSuspended: (reason: string) => void;
  open: boolean; ready: boolean; toggle: (next: boolean) => void;
};
const SessionContext = createContext<Store | null>(null);

/**
 * Estado do Assistente Groow compartilhado entre a lista de Campanhas e as telas de detalhes do MESMO cliente: conversas (uma por contexto),
 * painel aberto/fechado e suspensão por falha de contabilização. Fica no layout da área; a troca de cliente remonta o layout (a página
 * também passa `key`), então nada de um cliente é reaproveitado em outro. Os dados e a seleção pertencem a cada página.
 */
export function AssistantSessionProvider({ children }: { children: ReactNode }) {
  const [conversations, dispatch] = useReducer(conversationsReducer, initialConversations);
  const [suspended, setSuspendedState] = useState<string | null>(null);
  // Até a hidratação, em largura pequena o painel não aparece (evita um flash da gaveta sobre o conteúdo).
  const ready = useHydrated();
  const stored = useLocalPreference(STORAGE_KEY);
  const [override, setOverride] = useState<boolean | null>(null);
  // Em tela estreita o painel é uma gaveta sobre o conteúdo: só abre por ação do usuário, nunca por preferência de outra janela.
  const narrow = ready && window.innerWidth < NARROW;
  const open = override ?? (narrow ? false : stored === "open" ? true : stored === "closed" ? false : !ready || window.innerWidth >= WIDE_ENOUGH);
  const store = useMemo<Store>(() => ({
    conversations, dispatch, suspended, setSuspended: setSuspendedState, open, ready,
    toggle: next => { setOverride(next); writeLocalPreference(STORAGE_KEY, next ? "open" : "closed"); },
  }), [conversations, suspended, open, ready]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export type AssistantSession = {
  scope: AssistantScope; selection: AssistantSelection | null; setSelection: (selection: AssistantSelection | null) => void;
  context: AssistantContext; conversation: ReturnType<typeof conversationOf>; availability: AssistantAvailability;
  send: (text: string) => void; open: boolean; ready: boolean; toggle: (next: boolean) => void; general: AssistantSelection;
};

/**
 * Liga uma página ao assistente: resolve a seleção contra os dados ATUAIS da página (seleção que saiu do escopo é descartada) e envia
 * somente quando o servidor declara o assistente disponível. `initialSelection` define o contexto inicial (ex.: a entidade aberta).
 */
export function useAssistantSession({ scope, data, availability, initialSelection = null, transport = serverTransport }: {
  scope: AssistantScope; data: ContextData; availability: AssistantAvailability; initialSelection?: AssistantSelection | null; transport?: AssistantTransport;
}): AssistantSession {
  const store = useContext(SessionContext);
  if (!store) throw new Error("AssistantSessionProvider ausente.");
  const [selection, setSelection] = useState<AssistantSelection | null>(initialSelection);
  const { context, invalidated } = resolveContext(selection, scope, data);
  if (selection && invalidated) setSelection(null);
  const conversation = conversationOf(store.conversations, context.key);
  // Sem métricas confirmadas o servidor também recusa; aqui o painel já explica o motivo antes de qualquer envio.
  const effective: AssistantAvailability = store.suspended ? { state: "unavailable", reason: "accounting", message: store.suspended }
    : availability.state === "available" && data.metricsState === "pending"
      ? { state: "unavailable", reason: "metrics_pending", message: "As métricas deste período ainda estão sendo atualizadas. O assistente analisa somente dados confirmados." } : availability;
  const send = (text: string) => {
    if (effective.state !== "available" || conversation.status === "sending") return;
    void sendQuestion({ context, text, history: conversation.messages, transport, dispatch: store.dispatch }).then(result => { if (result.suspended) store.setSuspended(result.suspended); });
  };
  return { scope, selection, setSelection, context, conversation, availability: effective, send, open: store.open, ready: store.ready, toggle: store.toggle, general: { scope, kind: "client" } };
}
