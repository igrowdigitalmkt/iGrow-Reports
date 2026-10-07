"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ExternalLink, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectWhatsAppAction, listWhatsAppTemplatesAction, selectWhatsAppTemplateAction } from "./actions";
import { SUGGESTED_TEMPLATE } from "./templates";
import { EmbeddedSignupButton } from "./embedded-signup-button";

export type WhatsAppSummary = {
  displayPhone: string | null; verifiedName: string | null; qualityRating: string | null;
  templateName: string | null; templateLanguage: string | null; lastCheckedAt: string | null;
} | null;

// Connection of the workspace's WhatsApp Business number and choice of the report template.
export function WhatsAppManager({ connection, readiness, canManage, embedded }: { connection: WhatsAppSummary; readiness: { ready: boolean; missing: string[] }; canManage: boolean; embedded: { configId: string; apiVersion: string; appId: string } | null }) {
  const router = useRouter();
  // Manual IDs and token become the advanced path once Embedded Signup is configured.
  const [editing, setEditing] = useState(!connection && !embedded);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templates, setTemplates] = useState<Array<{ name: string; language: string }> | null>(null);
  const [pending, startTransition] = useTransition();
  const current = connection?.templateName ? `${connection.templateName}|${connection.templateLanguage}` : "";
  const [chosen, setChosen] = useState(current);

  function connect(form: FormData) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await connectWhatsAppAction({ wabaId: form.get("wabaId"), phoneNumberId: form.get("phoneNumberId"), accessToken: form.get("accessToken") });
      if ("error" in result) { setError(result.error ?? "Não foi possível conectar."); return; }
      setEditing(false);
      setNotice(result.template ? `Número conectado. Mensagem modelo "${result.template}" pronta para os relatórios.` : "Número conectado. Falta uma mensagem modelo aprovada com o PDF no cabeçalho (veja abaixo como criar).");
      router.refresh();
    });
  }
  function loadTemplates() {
    setError("");
    startTransition(async () => {
      const result = await listWhatsAppTemplatesAction();
      if ("error" in result) { setError(result.error ?? "Não foi possível consultar."); return; }
      setTemplates(result.usable);
      // Preselect the current template, or the first approved one when none is saved yet.
      setChosen(current || (result.usable[0] ? `${result.usable[0].name}|${result.usable[0].language}` : ""));
      if (!result.usable.length) setNotice(`Nenhuma das ${result.total} mensagens modelo da conta está aprovada com PDF no cabeçalho.`);
    });
  }
  function choose(value: string) {
    const [name, language] = value.split("|");
    startTransition(async () => {
      const result = await selectWhatsAppTemplateAction({ name, language });
      if ("error" in result) { setError(result.error ?? "Não foi possível salvar."); return; }
      setNotice("Mensagem modelo atualizada."); router.refresh();
    });
  }

  return <section className="panel whatsapp-card">
    <div className="meta-card-header">
      <span className="provider-logo whatsapp-logo"><Send size={18} /></span>
      <div className="meta-card-title"><h2>WhatsApp Business</h2><p className="muted text-sm">Envio dos relatórios em PDF para os destinatários autorizados</p></div>
      <span className={`badge ${connection ? connection.templateName ? "green" : "amber" : "neutral"}`}>{connection ? connection.templateName ? "Pronto para enviar" : "Falta a mensagem modelo" : "Não conectado"}</span>
    </div>

    {connection && <dl className="whatsapp-facts">
      <div><dt>Número</dt><dd>{connection.displayPhone ?? "—"}</dd></div>
      <div><dt>Nome exibido</dt><dd>{connection.verifiedName ?? "—"}</dd></div>
      <div><dt>Qualidade</dt><dd>{qualityLabel(connection.qualityRating)}</dd></div>
      <div><dt>Mensagem modelo</dt><dd>{connection.templateName ? `${connection.templateName} · ${connection.templateLanguage}` : "Nenhuma aprovada"}</dd></div>
    </dl>}

    {connection && canManage && <div className="whatsapp-actions">
      {templates ? <>
        <select className="input compact-select" aria-label="Mensagem modelo dos relatórios" value={chosen} onChange={event => setChosen(event.target.value)} disabled={pending || !templates.length}>
          {!templates.length && <option value="">Nenhuma aprovada com PDF</option>}
          {templates.map(item => <option key={`${item.name}|${item.language}`} value={`${item.name}|${item.language}`}>{item.name} · {item.language}</option>)}
        </select>
        {templates.length > 0 && chosen !== current && <Button className="button-sm" onClick={() => choose(chosen)} disabled={pending}>Usar esta mensagem</Button>}
      </> : <Button variant="secondary" className="button-sm" onClick={loadTemplates} disabled={pending}><RefreshCw size={14} />Atualizar mensagens modelo</Button>}
      <Button variant="ghost" className="button-sm" onClick={() => setEditing(value => !value)}>{editing ? "Cancelar" : "Trocar número ou token"}</Button>
    </div>}

    {!readiness.ready && <p className="meta-inline-note">Configuração do servidor pendente: {readiness.missing.join(", ")}.</p>}
    {!canManage && !connection && <p className="meta-inline-note">Peça a um proprietário ou administrador para conectar o WhatsApp.</p>}

    {(!connection || editing) && canManage && embedded && readiness.ready && <EmbeddedSignupButton configId={embedded.configId} apiVersion={embedded.apiVersion} appId={embedded.appId} />}
    {!connection && canManage && embedded && !editing && <button type="button" className="text-link whatsapp-advanced" onClick={() => setEditing(true)}>Conectar com IDs e token (avançado)</button>}

    {editing && canManage && <form className="whatsapp-form" action={connect}>
      <label>ID da conta do WhatsApp Business (WABA)<input className="input" name="wabaId" inputMode="numeric" required placeholder="Ex.: 102938475610293" /></label>
      <label>ID do número de telefone<input className="input" name="phoneNumberId" inputMode="numeric" required placeholder="Ex.: 110987654321098" /></label>
      <label className="whatsapp-token">Token de acesso permanente (usuário do sistema)<input className="input" name="accessToken" type="password" autoComplete="off" required placeholder="Guardado criptografado; nunca é exibido de novo" /></label>
      <Button type="submit" disabled={pending || !readiness.ready}>{pending ? "Conectando…" : connection ? "Salvar nova conexão" : "Conectar WhatsApp"}</Button>
    </form>}

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

function qualityLabel(value: string | null) {
  if (!value) return "—";
  return ({ GREEN: "Alta", YELLOW: "Média", RED: "Baixa" } as Record<string, string>)[value.toUpperCase()] ?? value;
}
