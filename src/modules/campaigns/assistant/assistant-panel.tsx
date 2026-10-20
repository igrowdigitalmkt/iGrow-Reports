"use client";

import { useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, Send, Sparkles, TriangleAlert, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { AssistantAvailability, AssistantContext, AssistantLevel, ConversationState } from "./contracts";

const LEVEL_LABELS: Record<AssistantLevel, string> = { client: "Cliente", account: "Conta de anúncios", campaign: "Campanha", adset: "Conjunto de anúncios", ad: "Anúncio" };
const ENTITY_LABELS = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" } as const;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const shortDate = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`));

/** Texto do contexto ativo. Os identificadores reais ficam no contrato; aqui só o rótulo legível. */
export function describeContext(context: AssistantContext, clientName: string) {
  const title = context.level === "client" ? clientName : context.level === "account" ? context.account?.name ?? "" : context.entity?.name ?? "";
  const names = context.accounts.map(account => account.name);
  const place = context.level === "client"
    ? `Meta Ads · ${names.length <= 3 ? names.join(", ") : `${names.length} contas`}`
    : `Meta Ads · ${context.account?.name ?? ""}`;
  return { kind: LEVEL_LABELS[context.level], title, place, path: context.ancestors.map(item => `${ENTITY_LABELS[item.level]}: ${item.name}`).join(" › ") };
}

export function AssistantRail({ contextActive, onOpen }: { contextActive: boolean; onOpen: () => void }) {
  return <button type="button" className="assistant-rail" onClick={onOpen} aria-label="Abrir Assistente Groow" title="Abrir Assistente Groow">
    <PanelRightOpen size={16} /><Sparkles size={16} />
    <span>Assistente Groow</span>
    {contextActive && <i aria-label="Há uma entidade em análise" />}
  </button>;
}

export function AssistantPanel({ context, clientName, accounts, conversation, availability, onSelectAccount, onClearContext, onCollapse, onSend }: {
  context: AssistantContext; clientName: string; accounts: { id: string; name: string }[]; conversation: ConversationState; availability: AssistantAvailability;
  onSelectAccount: (accountId: string | null) => void; onClearContext: () => void; onCollapse: () => void; onSend?: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const info = describeContext(context, clientName);
  const available = availability.state === "available";
  const scopedAccounts = accounts.length > 1 && (context.level === "client" || context.level === "account");

  useEffect(() => {
    const el = input.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }
  }, [draft]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [conversation.messages.length, conversation.status]);

  const submit = () => {
    const text = draft.trim();
    if (!available || !text || conversation.status === "sending" || !onSend) return;
    onSend(text);
    setDraft("");
  };

  return <aside className="assistant-panel" aria-label="Assistente Groow">
    <header className="assistant-head">
      <span className="assistant-mark" aria-hidden="true"><Sparkles size={15} /></span>
      <div><strong>Assistente Groow</strong><span className="assistant-badge" title="Inteligência artificial">IA</span></div>
      <button type="button" className="assistant-icon-button" onClick={onCollapse} aria-label="Recolher o Assistente Groow" title="Recolher"><PanelRightClose size={17} /></button>
    </header>

    <section className="assistant-context" aria-label="Contexto em análise">
      <span className="assistant-context-label">Analisando:</span>
      <div className="assistant-context-body">
        <small>{info.kind}</small>
        <strong title={info.title}>{info.title}</strong>
        <span>{info.place}</span>
        {info.path && <span className="assistant-context-path" title={info.path}>{info.path}</span>}
        {context.level === "client" && <span>{shortDate(context.period.dateFrom)} a {shortDate(context.period.dateTo)}</span>}
      </div>
      {scopedAccounts && <label className="assistant-scope"><span>Escopo</span>
        <Select className="compact-select" value={context.account?.id ?? ""} aria-label="Escopo do assistente" onChange={event => onSelectAccount(event.target.value || null)}>
          <option value="">{`Todas as contas selecionadas (${accounts.length})`}</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </Select></label>}
      {context.level !== "client" && <button type="button" className="assistant-clear" onClick={onClearContext}><X size={13} />Voltar ao contexto geral</button>}
      {context.level === "client" && <p className="assistant-hint">Selecione uma campanha, um conjunto ou um anúncio na tabela para focar a análise.</p>}
    </section>

    <div className="assistant-log" ref={log} role="log" aria-live="polite" aria-label="Conversa">
      {conversation.messages.length === 0 && conversation.status !== "sending" && <div className="assistant-empty">
        <span aria-hidden="true"><Sparkles size={20} /></span>
        <strong>Nenhuma conversa ainda</strong>
        <p>{available
          ? "Pergunte sobre o contexto acima. As respostas usam somente os dados confirmados desta tela e o assistente não altera nada nas suas campanhas."
          : "Quando o assistente estiver disponível, as perguntas serão respondidas com base no contexto acima e nos dados confirmados desta tela."}</p>
      </div>}
      {conversation.messages.map(message => <article key={message.id} className={`assistant-message is-${message.role}${message.status === "error" ? " is-error" : ""}`}>
        {message.role === "assistant" && <span className="assistant-message-who"><Sparkles size={11} />Assistente Groow</span>}
        <div className="assistant-message-text">{message.content}</div>
      </article>)}
      {conversation.status === "sending" && <div className="assistant-typing" role="status"><span /><span /><span /><em className="sr-only">O assistente está respondendo</em></div>}
      {conversation.status === "error" && <p className="assistant-error" role="alert"><TriangleAlert size={14} />{conversation.error ?? "Não foi possível obter a resposta do assistente."}</p>}
    </div>

    <footer className="assistant-composer">
      {!available && <p className="assistant-unavailable" role="status"><TriangleAlert size={13} />{availability.message}</p>}
      <div className="assistant-composer-row">
        <textarea ref={input} rows={2} value={draft} disabled={!available} onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
          placeholder={available ? "Pergunte sobre este contexto…" : "Disponível após a integração com a IA"} aria-label="Mensagem para o Assistente Groow" />
        <button type="button" className="assistant-send" disabled={!available || !draft.trim() || conversation.status === "sending"} onClick={submit} aria-label="Enviar mensagem" title={available ? "Enviar" : "Envio indisponível"}><Send size={16} /></button>
      </div>
      <small>A IA pode errar: confira as informações importantes. Nenhuma alteração é feita sem as autorizações do sistema.</small>
    </footer>
  </aside>;
}
