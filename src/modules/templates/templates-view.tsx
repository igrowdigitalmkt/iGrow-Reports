"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LayoutTemplate, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { previewAutomationDataAction } from "@/modules/automations/actions";
import { renderMessage, SEGMENT_LABELS, SYSTEM_TEMPLATES } from "@/modules/automations/message";
import { WhatsAppPreview } from "@/modules/automations/whatsapp-preview";
import type { MessageTemplateSegment } from "@/types/database";
import { deleteMessageTemplateAction, saveMessageTemplateAction } from "./actions";
import { MessageComposer } from "./message-composer";
import type { SavedTemplate, TemplatesSnapshot } from "./types";
import "@/modules/automations/automations.css";

type Selection = { kind: "system"; id: string } | { kind: "saved"; id: string } | { kind: "new" };
type Draft = { id?: string; name: string; segment: MessageTemplateSegment; body: string };

// Library of message templates: the platform's ready-made ones (read-only, can be copied) and the workspace's own.
export function TemplatesView({ snapshot, clients, canEdit, demo = false, workspaceName }: {
  snapshot: TemplatesSnapshot; clients: ClientItem[]; canEdit: boolean; demo?: boolean; workspaceName: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedTemplate[]>(snapshot.items);
  const [selection, setSelection] = useState<Selection>(snapshot.items[0] ? { kind: "saved", id: snapshot.items[0].id } : { kind: "system", id: SYSTEM_TEMPLATES[0].id });
  const [segment, setSegment] = useState<MessageTemplateSegment | "todos">("todos");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const [previewClient, setPreviewClient] = useState("");
  const [preview, setPreview] = useState<{ client: string; data: AnalyticsDashboardData | null } | null>(null);

  const system = selection.kind === "system" ? SYSTEM_TEMPLATES.find(item => item.id === selection.id) ?? null : null;
  const own = selection.kind === "saved" ? saved.find(item => item.id === selection.id) ?? null : null;
  const current: Draft | null = draft ?? (own ? { id: own.id, name: own.name, segment: own.segment, body: own.body } : system ? { name: system.name, segment: system.segment, body: system.body } : null);
  const editable = !!draft;
  const matches = (value: MessageTemplateSegment) => segment === "todos" || value === segment;

  useEffect(() => {
    if (!previewClient || demo) return;
    let cancelled = false;
    previewAutomationDataAction({ clientId: previewClient, periodKey: "last_7d" }).then(result => {
      if (!cancelled) setPreview({ client: previewClient, data: "data" in result ? result.data ?? null : null });
    });
    return () => { cancelled = true; };
  }, [previewClient, demo]);
  const realData = previewClient && preview?.client === previewClient ? preview.data : null;
  const loadingPreview = !!previewClient && !demo && preview?.client !== previewClient;
  const clientName = clients.find(client => client.id === previewClient)?.name ?? "Cliente Exemplo";
  const rendered = current ? renderMessage(current.body, { clientName, recipientName: "Maria", workspaceName, data: loadingPreview ? null : realData ?? getDemoClientAnalytics() }) : "";

  function pick(next: Selection) { setSelection(next); setDraft(null); setError(""); setNotice(""); }
  function startNew() { setSelection({ kind: "new" }); setDraft({ name: "", segment: "geral", body: SYSTEM_TEMPLATES[0].body }); setError(""); setNotice(""); }
  function duplicate() {
    if (!current) return;
    setSelection({ kind: "new" });
    setDraft({ name: `${current.name} (cópia)`, segment: current.segment, body: current.body });
    setNotice(""); setError("");
  }

  function save() {
    if (!draft) return;
    setError(""); setNotice("");
    if (demo) { setError("Na demonstração nada é salvo."); return; }
    start(async () => {
      const result = await saveMessageTemplateAction(draft);
      if ("error" in result) { setError(result.error ?? "Não foi possível salvar."); return; }
      setSaved(list => [...list.filter(item => item.id !== result.template.id), result.template].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setSelection({ kind: "saved", id: result.template.id });
      setDraft(null);
      setNotice("Template salvo. Ele já aparece em Escolher template nos agendamentos.");
      router.refresh();
    });
  }

  function remove() {
    if (!own || !window.confirm(`Excluir o template "${own.name}"? Agendamentos que já usam este texto não mudam.`)) return;
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    start(async () => {
      const result = await deleteMessageTemplateAction({ id: own.id });
      if ("error" in result) { setError(result.error ?? "Não foi possível excluir."); return; }
      setSaved(list => list.filter(item => item.id !== own.id));
      pick({ kind: "system", id: SYSTEM_TEMPLATES[0].id });
      router.refresh();
    });
  }

  return <div className="templates">
    {!snapshot.ready && !demo && <div className="automation-channel"><span className="automation-channel-icon"><LayoutTemplate size={18} /></span><div><strong>Salvar templates ainda não está disponível</strong><p>O banco de dados precisa receber a atualização de templates. Os templates prontos da plataforma já podem ser usados nos agendamentos.</p></div></div>}

    <div className="templates-grid">
      <aside className="panel templates-library">
        <div className="templates-library-head">
          <select className="input compact-select" aria-label="Filtrar por tipo de resultado" value={segment} onChange={event => setSegment(event.target.value as MessageTemplateSegment | "todos")}>
            <option value="todos">Todos os tipos</option>
            {Object.entries(SEGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {canEdit && (snapshot.ready || demo) && <Button size="sm" onClick={startNew}><Plus size={14} />Novo</Button>}
        </div>
        <h3>Seus templates</h3>
        <ul>
          {saved.filter(item => matches(item.segment)).map(item => <li key={item.id}>
            <button type="button" aria-current={selection.kind === "saved" && selection.id === item.id ? "true" : undefined} onClick={() => pick({ kind: "saved", id: item.id })}>
              <strong>{item.name}</strong><small>{SEGMENT_LABELS[item.segment]}</small>
            </button>
          </li>)}
          {selection.kind === "new" && <li><button type="button" aria-current="true"><strong>{draft?.name || "Novo template"}</strong><small>Não salvo</small></button></li>}
          {!saved.some(item => matches(item.segment)) && selection.kind !== "new" && <li className="templates-empty">{saved.length ? "Nenhum deste tipo." : "Você ainda não salvou nenhum. Copie um pronto ou crie um novo."}</li>}
        </ul>
        <h3><Sparkles size={13} />Prontos da plataforma</h3>
        <ul>
          {SYSTEM_TEMPLATES.filter(item => matches(item.segment)).map(item => <li key={item.id}>
            <button type="button" aria-current={selection.kind === "system" && selection.id === item.id ? "true" : undefined} onClick={() => pick({ kind: "system", id: item.id })}>
              <strong>{item.name}</strong><small>{item.description}</small>
            </button>
          </li>)}
        </ul>
      </aside>

      {current && <section className="panel templates-editor">
        <header className="templates-editor-head">
          {editable ? <div className="templates-name-fields">
            <label><span>Nome</span><input className="input" value={current.name} maxLength={80} placeholder="Ex.: Vendas semanais da loja" onChange={event => setDraft({ ...current, name: event.target.value })} /></label>
            <label><span>Tipo de resultado</span><select className="input" value={current.segment} onChange={event => setDraft({ ...current, segment: event.target.value as MessageTemplateSegment })}>
              {Object.entries(SEGMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
          </div> : <div>
            <h2>{current.name}</h2>
            <p>{SEGMENT_LABELS[current.segment]}{system ? " · pronto da plataforma" : ""}</p>
          </div>}
          {!editable && canEdit && <div className="templates-actions">
            {own && <Button variant="secondary" size="sm" onClick={() => setDraft({ id: own.id, name: own.name, segment: own.segment, body: own.body })}>Editar</Button>}
            {(snapshot.ready || demo) && <Button variant={system ? "default" : "ghost"} size="sm" onClick={duplicate}><Copy size={14} />{system ? "Copiar para editar" : "Duplicar"}</Button>}
            {own && <Button variant="ghost" size="sm" onClick={remove} disabled={pending}><Trash2 size={14} />Excluir</Button>}
          </div>}
        </header>

        <div className="templates-editor-body">
          <div className="templates-text">
            {editable ? <MessageComposer value={current.body} onChange={body => setDraft({ ...current, body })} rows={16} />
              : <pre className="templates-readonly">{current.body}</pre>}
            {editable && <div className="templates-save">
              <Button variant="secondary" onClick={() => { setDraft(null); if (selection.kind === "new") pick({ kind: "system", id: SYSTEM_TEMPLATES[0].id }); }} disabled={pending}>Cancelar</Button>
              <Button onClick={save} disabled={pending || current.name.trim().length < 2}><Save size={15} />{pending ? "Salvando…" : current.id ? "Salvar alterações" : "Salvar template"}</Button>
            </div>}
            {error && <p role="alert" className="meta-feedback error">{error}</p>}
            {notice && <p role="status" className="meta-feedback success">{notice}</p>}
          </div>
          <div className="templates-preview">
            <div className="automation-preview-head">
              <h3>Como vai chegar</h3>
              <select className="input compact-select" aria-label="Números da prévia" value={previewClient} onChange={event => setPreviewClient(event.target.value)}>
                <option value="">Números de exemplo</option>
                {!demo && clients.filter(client => !client.archived_at).map(client => <option key={client.id} value={client.id}>{client.name} · últimos 7 dias</option>)}
              </select>
            </div>
            <WhatsAppPreview text={rendered} contact="Maria" time="08:00" loading={loadingPreview} />
          </div>
        </div>
      </section>}
    </div>
  </div>;
}
