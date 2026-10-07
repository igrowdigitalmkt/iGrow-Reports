"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectWhatsAppAction, listWhatsAppTemplatesAction, removeWhatsAppNumberAction, renameWhatsAppNumberAction, selectWhatsAppTemplateAction } from "./actions";
import { SUGGESTED_TEMPLATE } from "./templates";
import { EmbeddedSignupButton } from "./embedded-signup-button";
import type { TokenExpiry } from "./token-expiry";

/** One official number of the workspace. `id` is null while the database keeps a single number. */
export type WhatsAppNumber = {
  id: string | null; label: string | null; coexistence: boolean;
  displayPhone: string | null; verifiedName: string | null; qualityRating: string | null;
  templateName: string | null; templateLanguage: string | null; lastCheckedAt: string | null;
  tokenExpiry?: TokenExpiry;
};
export type WhatsAppSummary = WhatsAppNumber[];

export function numberName(number: Pick<WhatsAppNumber, "label" | "verifiedName" | "displayPhone">) {
  return number.label || number.verifiedName || number.displayPhone || "Número oficial";
}

type Embedded = { configId: string; apiVersion: string; appId: string } | null;

// Official numbers of the workspace (Cloud API, with or without coexistence) and their report template.
export function WhatsAppManager({ numbers, readiness, canManage, embedded }: { numbers: WhatsAppSummary; readiness: { ready: boolean; missing: string[] }; canManage: boolean; embedded: Embedded }) {
  const router = useRouter();
  const multi = numbers.every(number => number.id);
  // Manual IDs and token become the advanced path once Embedded Signup is configured.
  const [adding, setAdding] = useState(!numbers.length);
  const [manual, setManual] = useState(!numbers.length && !embedded);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function connect(form: FormData) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await connectWhatsAppAction({ wabaId: form.get("wabaId"), phoneNumberId: form.get("phoneNumberId"), accessToken: form.get("accessToken") });
      if ("error" in result) { setError(result.error ?? "Não foi possível conectar."); return; }
      setAdding(false); setManual(false);
      setNotice(result.template ? `Número conectado. Mensagem modelo "${result.template}" pronta para os relatórios.` : "Número conectado. Falta uma mensagem modelo aprovada com o PDF no cabeçalho (veja abaixo como criar).");
      router.refresh();
    });
  }

  return <section className="panel whatsapp-card">
    <div className="meta-card-header">
      <span className="provider-logo whatsapp-logo"><Send size={18} /></span>
      <div className="meta-card-title"><h2>WhatsApp API oficial</h2><p className="muted text-sm">Números da Cloud API, com ou sem coexistência, para enviar o PDF por mensagem modelo</p></div>
      <span className={`badge ${numbers.length ? "green" : "neutral"}`}>{numbers.length ? `${numbers.length} ${numbers.length === 1 ? "número" : "números"}` : "Não conectado"}</span>
    </div>

    {numbers.map(number => <NumberCard key={number.id ?? "legacy"} number={number} canManage={canManage} embedded={embedded} ready={readiness.ready} />)}

    {!readiness.ready && <p className="meta-inline-note">Configuração do servidor pendente: {readiness.missing.join(", ")}.</p>}
    {!canManage && !numbers.length && <p className="meta-inline-note">Peça a um proprietário ou administrador para conectar o WhatsApp.</p>}

    {canManage && numbers.length > 0 && !adding && <div className="whatsapp-actions">
      <Button variant="secondary" className="button-sm" onClick={() => setAdding(true)}><Plus size={14} />Adicionar número</Button>
      {!multi && <span className="muted text-xs">Para ter mais de um número, a atualização do banco de dados precisa ser aplicada.</span>}
    </div>}

    {canManage && adding && <div className="whatsapp-add">
      {numbers.length > 0 && <div className="whatsapp-add-head"><strong>Adicionar número</strong><Button variant="ghost" className="button-sm" onClick={() => { setAdding(false); setManual(false); }}>Cancelar</Button></div>}
      {embedded && readiness.ready && <EmbeddedSignupButton configId={embedded.configId} apiVersion={embedded.apiVersion} appId={embedded.appId} />}
      {embedded && !manual && <button type="button" className="text-link whatsapp-advanced" onClick={() => setManual(true)}>Conectar com IDs e token (avançado)</button>}
      {manual && <form className="whatsapp-form" action={connect}>
        <label>ID da conta do WhatsApp Business (WABA)<input className="input" name="wabaId" inputMode="numeric" required placeholder="Ex.: 102938475610293" /></label>
        <label>ID do número de telefone<input className="input" name="phoneNumberId" inputMode="numeric" required placeholder="Ex.: 110987654321098" /></label>
        <label className="whatsapp-token">Token de acesso permanente (usuário do sistema)<input className="input" name="accessToken" type="password" autoComplete="off" required placeholder="Guardado criptografado; nunca é exibido de novo" /></label>
        <Button type="submit" disabled={pending || !readiness.ready}>{pending ? "Conectando…" : "Conectar número"}</Button>
      </form>}
    </div>}

    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}

    <details className="whatsapp-guide">
      <summary><ChevronDown size={14} />Como preparar o WhatsApp</summary>
      <ol>
        <li><strong>Número na API oficial.</strong> No Meta Business, adicione o produto WhatsApp ao seu app e registre o número (não pode estar em uso no aplicativo comum, salvo coexistência oficial).</li>
        <li><strong>Token permanente.</strong> Em Usuários do sistema, gere um token com as permissões whatsapp_business_messaging e whatsapp_business_management.</li>
        <li><strong>Mensagem modelo.</strong> No Gerenciador do WhatsApp, crie o modelo <code>{SUGGESTED_TEMPLATE.name}</code> ({SUGGESTED_TEMPLATE.language}, categoria Utilidade) com cabeçalho do tipo Documento e o texto: “{SUGGESTED_TEMPLATE.body}”. Aguarde a aprovação.</li>
        <li><strong>Avisos de entrega.</strong> No app, configure o webhook do WhatsApp com a URL <code>/api/webhooks/meta/whatsapp</code> deste site, o token de verificação e a assinatura do campo <code>messages</code>.</li>
      </ol>
      <a className="text-link" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer">Guia oficial da Meta<ExternalLink size={13} /></a>
    </details>
  </section>;
}

function NumberCard({ number, canManage, embedded, ready }: { number: WhatsAppNumber; canManage: boolean; embedded: Embedded; ready: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templates, setTemplates] = useState<Array<{ name: string; language: string }> | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = number.templateName ? `${number.templateName}|${number.templateLanguage}` : "";
  const [chosen, setChosen] = useState(current);
  const connectionId = number.id;

  function run(task: () => Promise<{ error?: string } | { success: true }>, done: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await task();
      if ("error" in result && result.error) { setError(result.error); return; }
      setNotice(done); router.refresh();
    });
  }
  function loadTemplates() {
    setError("");
    startTransition(async () => {
      const result = await listWhatsAppTemplatesAction({ connectionId });
      if ("error" in result) { setError(result.error ?? "Não foi possível consultar."); return; }
      setTemplates(result.usable);
      // Preselect the current template, or the first approved one when none is saved yet.
      setChosen(current || (result.usable[0] ? `${result.usable[0].name}|${result.usable[0].language}` : ""));
      if (!result.usable.length) setNotice(`Nenhuma das ${result.total} mensagens modelo da conta está aprovada com PDF no cabeçalho.`);
    });
  }
  function rename(form: FormData) {
    if (!connectionId) return;
    run(async () => {
      const result = await renameWhatsAppNumberAction({ connectionId, label: String(form.get("label") ?? "") });
      if (!("error" in result)) setRenaming(false);
      return result;
    }, "Nome atualizado.");
  }

  return <article className="whatsapp-number">
    <header className="whatsapp-number-head">
      <div><strong>{numberName(number)}</strong><span className="muted text-sm">{number.displayPhone ?? "—"}{number.coexistence ? " · coexistência com o app" : " · somente API"}</span></div>
      <span className={`badge ${number.templateName ? "green" : "amber"}`}>{number.templateName ? "Pronto para enviar" : "Falta a mensagem modelo"}</span>
    </header>

    <dl className="whatsapp-facts">
      <div><dt>Nome exibido</dt><dd>{number.verifiedName ?? "—"}</dd></div>
      <div><dt>Qualidade</dt><dd>{qualityLabel(number.qualityRating)}</dd></div>
      <div><dt>Mensagem modelo</dt><dd>{number.templateName ? `${number.templateName} · ${number.templateLanguage}` : "Nenhuma aprovada"}</dd></div>
      <div><dt>Autorização</dt><dd>{number.tokenExpiry ? `Válida até ${number.tokenExpiry.expiresAt.slice(0, 10).split("-").reverse().join("/")}` : "Sem vencimento registrado"}</dd></div>
    </dl>

    {number.tokenExpiry && number.tokenExpiry.level !== "ok" && <div role="alert" className={`meta-feedback ${number.tokenExpiry.level === "expired" ? "error" : "warning"} whatsapp-expiry`}>
      <span>{number.tokenExpiry.level === "expired"
        ? "A autorização da Meta para este número venceu. Os envios pela API oficial param até você reconectar."
        : `A autorização da Meta para este número vence em ${number.tokenExpiry.daysLeft} ${number.tokenExpiry.daysLeft === 1 ? "dia" : "dias"}. Reconecte para continuar enviando sem interrupção.`}</span>
      {canManage && embedded && <Button variant="secondary" className="button-sm" onClick={() => setReconnecting(true)}><RefreshCw size={14} />Reconectar</Button>}
    </div>}

    {canManage && <div className="whatsapp-actions">
      {templates ? <>
        <select className="input compact-select" aria-label={`Mensagem modelo de ${numberName(number)}`} value={chosen} onChange={event => setChosen(event.target.value)} disabled={pending || !templates.length}>
          {!templates.length && <option value="">Nenhuma aprovada com PDF</option>}
          {templates.map(item => <option key={`${item.name}|${item.language}`} value={`${item.name}|${item.language}`}>{item.name} · {item.language}</option>)}
        </select>
        {templates.length > 0 && chosen !== current && <Button className="button-sm" disabled={pending}
          onClick={() => { const [name, language] = chosen.split("|"); run(() => selectWhatsAppTemplateAction({ connectionId, name, language }), "Mensagem modelo atualizada."); }}>Usar esta mensagem</Button>}
      </> : <Button variant="secondary" className="button-sm" onClick={loadTemplates} disabled={pending}><RefreshCw size={14} />Atualizar mensagens modelo</Button>}
      {connectionId && <Button variant="ghost" className="button-sm" onClick={() => setRenaming(value => !value)}><Pencil size={14} />Renomear</Button>}
      {embedded && ready && <Button variant="ghost" className="button-sm" onClick={() => setReconnecting(value => !value)}><RefreshCw size={14} />Reconectar</Button>}
      {connectionId && <Button variant="ghost" className="button-sm whatsapp-remove" disabled={pending}
        onClick={() => { if (window.confirm(`Remover ${numberName(number)} da iGrow? O número continua funcionando no WhatsApp, mas os agendamentos que usam este número param até você escolher outro.`)) run(() => removeWhatsAppNumberAction({ connectionId }), "Número removido."); }}><Trash2 size={14} />Remover</Button>}
    </div>}

    {renaming && <form className="whatsapp-rename" action={rename}>
      <input className="input" name="label" maxLength={60} defaultValue={number.label ?? ""} placeholder="Ex.: Relatórios, Atendimento" aria-label="Nome do número na iGrow" autoFocus />
      <Button type="submit" className="button-sm" disabled={pending}>Salvar</Button>
    </form>}
    {reconnecting && embedded && <EmbeddedSignupButton configId={embedded.configId} apiVersion={embedded.apiVersion} appId={embedded.appId} />}

    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
  </article>;
}

function qualityLabel(value: string | null) {
  if (!value) return "—";
  return ({ GREEN: "Alta", YELLOW: "Média", RED: "Baixa" } as Record<string, string>)[value.toUpperCase()] ?? value;
}
