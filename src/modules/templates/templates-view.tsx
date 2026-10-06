"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, LayoutTemplate, Mail, MessageCircle, Paperclip, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnsavedGuard } from "@/components/ui/unsaved-guard";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { CHANNEL_LABELS, renderMessage, SYSTEM_TEMPLATES, type TemplateChannel } from "@/modules/automations/message";
import { WhatsAppPreview } from "@/modules/automations/whatsapp-preview";
import { SUGGESTED_TEMPLATE } from "@/modules/whatsapp/templates";
import type { WhatsAppSummary } from "@/modules/whatsapp/whatsapp-manager";
import { deleteMessageTemplateAction, saveMessageTemplateAction } from "./actions";
import { MessageComposer } from "./message-composer";
import type { SavedTemplate, TemplatesSnapshot } from "./types";
import "@/modules/automations/automations.css";

type EditableChannel = "whatsapp" | "email";
type Selection = { kind: "system"; id: string } | { kind: "saved"; id: string } | { kind: "new" };
type Draft = { id?: string; name: string; channel: EditableChannel; subject: string; body: string };

// Fictitious numbers for every variable: the preview always shows how each metric reads.
const SAMPLE = { clientName: "Cliente Exemplo", recipientName: "Maria", data: getDemoClientAnalytics(), balance: { funds: 1240.5, currency: "BRL", postpaid: false, due: false } };
const CHANNELS: Array<{ key: TemplateChannel; icon: typeof Mail }> = [
  { key: "whatsapp", icon: MessageCircle }, { key: "whatsapp_pdf", icon: FileText }, { key: "email", icon: Mail },
];

function firstOf(channel: EditableChannel, saved: SavedTemplate[]): Selection {
  const own = saved.find(item => item.channel === channel);
  if (own) return { kind: "saved", id: own.id };
  return { kind: "system", id: SYSTEM_TEMPLATES.find(item => item.channel === channel)!.id };
}

// Templates by channel: ready-made ones (read-only, can be copied) and the workspace's own.
export function TemplatesView({ snapshot, canEdit, demo = false, workspaceName, whatsapp = null }: {
  snapshot: TemplatesSnapshot; canEdit: boolean; demo?: boolean; workspaceName: string; whatsapp?: WhatsAppSummary;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedTemplate[]>(snapshot.items);
  const [channel, setChannel] = useState<TemplateChannel>("whatsapp");
  const [selection, setSelection] = useState<Selection>(() => firstOf("whatsapp", snapshot.items));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const canSave = demo || snapshot.ready;

  const editable = channel === "whatsapp" || channel === "email" ? channel : null;
  const system = selection.kind === "system" ? SYSTEM_TEMPLATES.find(item => item.id === selection.id) ?? null : null;
  const own = selection.kind === "saved" ? saved.find(item => item.id === selection.id) ?? null : null;
  const current: Draft | null = draft ?? (own ? { id: own.id, name: own.name, channel: own.channel === "email" ? "email" : "whatsapp", subject: own.subject ?? "", body: own.body }
    : system ? { name: system.name, channel: system.channel === "email" ? "email" : "whatsapp", subject: system.subject ?? "", body: system.body } : null);
  const dirty = !!draft && JSON.stringify(draft) !== original;

  function edit(next: Draft) { setDraft(next); setOriginal(JSON.stringify(next)); setError(""); setNotice(""); }

  async function persist(): Promise<boolean> {
    if (!draft) return true;
    setError(""); setNotice("");
    if (demo) { setError("Na demonstração nada é salvo."); return false; }
    const result = await saveMessageTemplateAction({ id: draft.id, name: draft.name, channel: draft.channel, subject: draft.channel === "email" ? draft.subject : undefined, body: draft.body });
    if ("error" in result) { setError(result.error ?? "Não foi possível salvar."); return false; }
    setSaved(list => [...list.filter(item => item.id !== result.template.id), result.template].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setSelection({ kind: "saved", id: result.template.id });
    setDraft(null);
    setNotice(draft.channel === "whatsapp" ? "Template salvo. Ele já aparece em Escolher template nos agendamentos." : "Template salvo.");
    router.refresh();
    return true;
  }
  const { guard, dialog } = useUnsavedGuard(dirty, persist);

  function pick(next: Selection) { guard(() => { setSelection(next); setDraft(null); setError(""); setNotice(""); }); }
  function switchChannel(next: TemplateChannel) {
    guard(() => {
      setChannel(next); setDraft(null); setError(""); setNotice("");
      if (next !== "whatsapp_pdf") setSelection(firstOf(next, saved));
    });
  }
  function startNew() {
    if (!editable) return;
    guard(() => { setSelection({ kind: "new" }); edit({ name: "", channel: editable, subject: editable === "email" ? "Resultados de {{cliente}} · {{periodo}}" : "", body: SYSTEM_TEMPLATES.find(item => item.channel === editable)!.body }); });
  }
  function duplicate() {
    if (!current) return;
    setSelection({ kind: "new" });
    edit({ name: `${current.name} (cópia)`, channel: current.channel, subject: current.subject, body: current.body });
  }
  function remove() {
    if (!own || !window.confirm(`Excluir o template "${own.name}"? Agendamentos que já usam este texto não mudam.`)) return;
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    start(async () => {
      const result = await deleteMessageTemplateAction({ id: own.id });
      if ("error" in result) { setError(result.error ?? "Não foi possível excluir."); return; }
      const rest = saved.filter(item => item.id !== own.id);
      setSaved(rest);
      setSelection(firstOf(own.channel === "email" ? "email" : "whatsapp", rest));
      router.refresh();
    });
  }

  const rendered = current ? renderMessage(current.body, { ...SAMPLE, workspaceName }) : "";
  const renderedSubject = current?.channel === "email" ? renderMessage(current.subject, { ...SAMPLE, workspaceName }) : "";
  const savedHere = editable ? saved.filter(item => (item.channel === "email" ? "email" : "whatsapp") === editable) : [];
  const systemHere = editable ? SYSTEM_TEMPLATES.filter(item => item.channel === editable) : [];

  return <div className="templates">
    {dialog}
    {!snapshot.ready && !demo && <div className="automation-channel"><span className="automation-channel-icon"><LayoutTemplate size={18} /></span><div><strong>Salvar templates ainda não está disponível</strong><p>O banco de dados precisa receber a atualização de templates. Os templates prontos da plataforma já podem ser usados nos agendamentos.</p></div></div>}

    <div className="segmented templates-channels" role="group" aria-label="Tipo de template">
      {CHANNELS.map(({ key, icon: Icon }) => <button key={key} type="button" aria-pressed={channel === key} onClick={() => switchChannel(key)}><Icon size={14} />{CHANNEL_LABELS[key]}{key === "email" && <span className="templates-soon">envio em breve</span>}</button>)}
    </div>

    {channel === "whatsapp_pdf" ? <section className="panel templates-pdf">
      <div><h2>Mensagem modelo aprovada pela Meta</h2>
        <p>O relatório em PDF só pode ir pela API oficial do WhatsApp, e ela exige uma mensagem modelo aprovada pela Meta antes do envio. Por isso o texto não é editado aqui: ele é criado e aprovado no Gerenciador do WhatsApp e escolhido em Integrações.</p></div>
      <dl className="templates-pdf-facts">
        <div><dt>Mensagem em uso</dt><dd>{whatsapp?.templateName ? `${whatsapp.templateName} · ${whatsapp.templateLanguage}` : "Nenhuma escolhida"}</dd></div>
        <div><dt>Número</dt><dd>{whatsapp?.displayPhone ?? "API oficial não conectada"}</dd></div>
      </dl>
      <div className="templates-pdf-sample">
        <h3>Texto sugerido para aprovar</h3>
        <pre className="templates-readonly">{SUGGESTED_TEMPLATE.body}</pre>
        <p className="automation-hint">{"{{1}}"} nome do destinatário · {"{{2}}"} cliente · {"{{3}}"} período · {"{{4}}"} nome da agência. Cabeçalho: documento (PDF). Categoria: utilidade.</p>
      </div>
      <Link className="button button-secondary" href={demo ? "/demo/integracoes" : "/dashboard/integracoes"}>Configurar em Integrações</Link>
    </section> : <div className="templates-grid">
      <aside className="panel templates-library">
        <div className="templates-library-head">
          <strong>{CHANNEL_LABELS[channel]}</strong>
          {canEdit && canSave && (editable === "whatsapp" || snapshot.channelsReady || demo) && <Button size="sm" onClick={startNew}><Plus size={14} />Novo</Button>}
        </div>
        <h3>Seus templates</h3>
        <ul>
          {savedHere.map(item => <li key={item.id}><button type="button" aria-current={selection.kind === "saved" && selection.id === item.id ? "true" : undefined} onClick={() => pick({ kind: "saved", id: item.id })}><strong>{item.name}</strong><small>{item.channel === "email" ? item.subject : "Salvo pela equipe"}</small></button></li>)}
          {selection.kind === "new" && <li><button type="button" aria-current="true"><strong>{draft?.name || "Novo template"}</strong><small>Não salvo</small></button></li>}
          {!savedHere.length && selection.kind !== "new" && <li className="templates-empty">Nenhum ainda. Copie um pronto ou crie um novo.</li>}
        </ul>
        <h3><Sparkles size={13} />Prontos da plataforma</h3>
        <ul>{systemHere.map(item => <li key={item.id}><button type="button" aria-current={selection.kind === "system" && selection.id === item.id ? "true" : undefined} onClick={() => pick({ kind: "system", id: item.id })}><strong>{item.name}</strong><small>{item.description}</small></button></li>)}</ul>
      </aside>

      {current && <section className="panel templates-editor">
        <header className="templates-editor-head">
          {draft ? <div className="templates-name-fields is-single">
            <label><span>Nome</span><input className="input" value={current.name} maxLength={80} placeholder="Ex.: Vendas semanais da loja" onChange={event => setDraft({ ...current, name: event.target.value })} /></label>
          </div> : <div><h2>{current.name}</h2><p>{CHANNEL_LABELS[current.channel]}{system ? " · pronto da plataforma" : ""}</p></div>}
          {!draft && canEdit && <div className="templates-actions">
            {own && <Button variant="secondary" size="sm" onClick={() => edit({ id: own.id, name: own.name, channel: own.channel === "email" ? "email" : "whatsapp", subject: own.subject ?? "", body: own.body })}>Editar</Button>}
            {canSave && <Button variant={system ? "default" : "ghost"} size="sm" onClick={duplicate}><Copy size={14} />{system ? "Copiar para editar" : "Duplicar"}</Button>}
            {own && <Button variant="ghost" size="sm" onClick={remove} disabled={pending}><Trash2 size={14} />Excluir</Button>}
          </div>}
        </header>

        <div className="templates-editor-body">
          <div className="templates-text">
            {current.channel === "email" && (draft
              ? <label className="templates-subject"><span>Assunto do e-mail</span><input className="input" value={current.subject} maxLength={200} onChange={event => setDraft({ ...current, subject: event.target.value })} /></label>
              : <p className="templates-subject-view"><span>Assunto</span>{current.subject}</p>)}
            {draft ? <MessageComposer value={current.body} onChange={body => setDraft({ ...current, body })} rows={16} /> : <pre className="templates-readonly">{current.body}</pre>}
            {draft && <div className="templates-save">
              <Button variant="secondary" onClick={() => { setDraft(null); if (selection.kind === "new" && editable) setSelection(firstOf(editable, saved)); }} disabled={pending}>Cancelar</Button>
              <Button onClick={() => start(async () => { await persist(); })} disabled={pending || current.name.trim().length < 2}><Save size={15} />{pending ? "Salvando…" : current.id ? "Salvar alterações" : "Salvar template"}</Button>
            </div>}
            {error && <p role="alert" className="meta-feedback error">{error}</p>}
            {notice && <p role="status" className="meta-feedback success">{notice}</p>}
          </div>
          <div className="templates-preview">
            <div className="automation-preview-head"><h3>Como vai chegar</h3><span className="badge neutral">Dados fictícios</span></div>
            {current.channel === "email" ? <div className="email-preview">
              <div className="email-preview-head"><span>Para: maria@cliente.com.br</span><strong>{renderedSubject}</strong></div>
              <div className="email-preview-body">{rendered}</div>
              <div className="email-preview-attachment"><Paperclip size={14} />relatorio-cliente-exemplo.pdf</div>
            </div> : <WhatsAppPreview text={rendered} contact="Maria" time="08:00" />}
          </div>
        </div>
      </section>}
    </div>}
  </div>;
}
