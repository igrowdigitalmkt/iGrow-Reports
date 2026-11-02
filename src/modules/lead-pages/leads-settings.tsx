"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Link2, Pencil, Plug, RefreshCw, Trash2 } from "lucide-react";
import {
  adoptLeadLinkCodeAction, createLeadLinkAction, createLeadSourceAction, deleteLeadLinkAction, deleteLeadSourceAction, getLeadLinkCodeAction, rotateLeadLinkAction,
  setLeadSourceActiveAction, syncLeadSourceAction, updateLeadLinkAction, updateLeadSourceAction, type SettingsResult, type SettingsSnapshot,
} from "./hub-actions";
import type { BoardForm } from "./hub-types";
import "./lead-feed.css";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const when = (iso: string | null) => iso ? dateTime.format(new Date(iso)) : "nunca";
const linkUrl = (code: string) => `${window.location.origin}/leads/${code}`;

type LinkDraft = { id: string; name: string; formIds: string[]; canUpdate: boolean };
type SourceDraft = { id: string; title: string; formId: string };

/** Fontes de leads (Páginas do Facebook) e links compartilhados do cliente: criar, editar, ativar/desativar, copiar, trocar código e excluir. */
export function LeadsSettings({ clientId, initial, forms }: { clientId: string; initial: SettingsSnapshot; forms: BoardForm[] }) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState<{ code: string; title: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null);
  const [adopt, setAdopt] = useState<{ id: string; code: string } | null>(null);

  const formName = (id: string) => forms.find(form => form.id === id)?.name ?? `Formulário …${id.slice(-4)}`;
  const run = (action: () => Promise<SettingsResult>, after?: (result: Extract<SettingsResult, { ok: true }>) => void) => {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) { setError(result.message); return; }
      setData({ sources: result.sources, links: result.links });
      if (result.message) setNotice(result.message);
      after?.(result);
    });
  };
  const copy = async (value: string, key: string) => { try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? null : current), 1800); } catch { setError("O navegador não deixou copiar. Selecione o link e copie manualmente."); } };

  const addSource = (form: HTMLFormElement) => {
    const values = new FormData(form);
    run(() => createLeadSourceAction({ clientId, title: String(values.get("title") ?? ""), fbPageId: String(values.get("fbPageId") ?? "").trim(), formId: String(values.get("formId") ?? "").trim() || undefined }), () => form.reset());
  };
  const addLink = (form: HTMLFormElement) => {
    const values = new FormData(form);
    const formIds = values.getAll("forms").map(String);
    const name = String(values.get("name") ?? "");
    run(() => createLeadLinkAction({ clientId, name, formIds: formIds.length ? formIds : undefined, canUpdate: values.get("canUpdate") === "on" }), result => { if (result.code) setShown({ code: result.code, title: name }); form.reset(); });
  };
  const copyLink = (link: SettingsSnapshot["links"][number]) => {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await getLeadLinkCodeAction({ clientId, linkId: link.id });
      if (result.ok) { await copy(linkUrl(result.code), link.id); setNotice(`Link “${link.name}” copiado.`); }
      else if (result.needsCode) setAdopt({ id: link.id, code: "" });
      else setError(result.message);
    });
  };

  return <div className="leads-settings">
    {error && <p role="alert" className="lead-error">{error}</p>}
    {notice && <p role="status" className="lead-notice-line">{notice}</p>}

    <section className="lead-panel" aria-labelledby="lead-sources-title">
      <header><div><h2 id="lead-sources-title">Páginas conectadas</h2><p>Páginas do Facebook cujos formulários de lead alimentam este menu. Pausar mantém os leads; remover só é possível antes de receber o primeiro lead.</p></div><Plug size={18} className="lead-muted" /></header>
      {data.sources.length === 0 ? <p className="lead-muted">Nenhuma Página conectada ainda. Cadastre abaixo a Página que recebe os leads do anúncio.</p>
        : <ul className="lead-source-list">{data.sources.map(source => <li key={source.id}>
          {sourceDraft?.id === source.id ? <form className="lead-form-inline lead-inline-edit" onSubmit={event => { event.preventDefault(); run(() => updateLeadSourceAction({ clientId, sourceId: source.id, title: sourceDraft.title, formId: sourceDraft.formId.trim() || null }), () => setSourceDraft(null)); }}>
            <label>Nome<input value={sourceDraft.title} onChange={event => setSourceDraft({ ...sourceDraft, title: event.target.value })} required minLength={2} maxLength={160} disabled={pending} /></label>
            <label>ID do formulário <span className="lead-muted">(vazio = todos)</span><input value={sourceDraft.formId} onChange={event => setSourceDraft({ ...sourceDraft, formId: event.target.value })} inputMode="numeric" pattern="[0-9]{5,30}" disabled={pending} /></label>
            <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setSourceDraft(null)} disabled={pending}>Cancelar</button><button type="submit" className="lead-btn is-primary" disabled={pending}>Salvar</button></div>
          </form> : <>
            <div className="lead-source-main">
              <strong>{source.title}{!source.active && <span className="lead-badge is-off">Pausada</span>}</strong>
              <small>Página {source.fbPageId}{source.formId ? ` · formulário ${source.formId}` : " · todos os formulários"}</small>
              <small>{source.leadCount} lead(s) · último lead: {when(source.lastLeadAt)} · conferido na Meta: {when(source.lastSyncedAt)}</small>
              {source.syncError ? <small className="lead-source-error">{source.syncError}</small> : source.lastSyncedAt ? <small className="lead-source-ok">Conexão com a Meta em ordem.</small> : null}
            </div>
            <div className="lead-source-actions">
              <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => syncLeadSourceAction({ clientId, sourceId: source.id }))}><RefreshCw size={14} />Verificar conexão</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => { setNotice(""); setError(""); setSourceDraft({ id: source.id, title: source.title, formId: source.formId ?? "" }); }}><Pencil size={14} />Editar</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => setLeadSourceActiveAction({ clientId, sourceId: source.id, active: !source.active }))}>{source.active ? "Pausar" : "Reativar"}</button>
              <button type="button" className="lead-btn is-danger" disabled={pending} onClick={() => { if (window.confirm(`Remover a Página “${source.title}”? Só é possível se ela nunca recebeu leads.`)) run(() => deleteLeadSourceAction({ clientId, sourceId: source.id })); }}><Trash2 size={14} />Remover</button>
            </div>
          </>}
        </li>)}</ul>}
      <form className="lead-form-inline" onSubmit={event => { event.preventDefault(); addSource(event.currentTarget); }}>
        <label>Nome<input name="title" required minLength={2} maxLength={160} placeholder="Ex.: Página da RM Imobiliária" disabled={pending} /></label>
        <label>ID da Página do Facebook<input name="fbPageId" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Somente números" disabled={pending} /></label>
        <label>ID do formulário <span className="lead-muted">(opcional)</span><input name="formId" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Em branco = todos" disabled={pending} /></label>
        <button type="submit" className="lead-btn is-primary" disabled={pending}>{pending ? "Conectando…" : "Conectar Página"}</button>
      </form>
    </section>

    <section className="lead-panel" aria-labelledby="lead-links-title">
      <header><div><h2 id="lead-links-title">Links compartilhados</h2><p>Para ver os leads sem entrar na plataforma. Cada link é separado: dá para copiar, editar, desativar, trocar o código ou excluir.</p></div><Link2 size={18} className="lead-muted" /></header>
      {shown && <div className="lead-newlink" role="status"><strong>{shown.title ? `Link “${shown.title}”:` : "Link:"} copie e envie à equipe.</strong>
        <div><code>{linkUrl(shown.code)}</code><button type="button" className="lead-btn" onClick={() => void copy(linkUrl(shown.code), "shown")}>{copied === "shown" ? <Check size={14} /> : <Copy size={14} />}{copied === "shown" ? "Copiado" : "Copiar link"}</button>
          <button type="button" className="lead-btn" onClick={() => setShown(null)}>Fechar</button></div></div>}
      {data.links.length === 0 ? <p className="lead-muted">Nenhum link criado.</p>
        : <ul className="lead-source-list">{data.links.map(link => <li key={link.id}>
          {linkDraft?.id === link.id ? <form className="lead-form-inline lead-inline-edit" onSubmit={event => { event.preventDefault(); run(() => updateLeadLinkAction({ clientId, linkId: link.id, name: linkDraft.name, formIds: linkDraft.formIds.length ? linkDraft.formIds : null, canUpdate: linkDraft.canUpdate }), () => setLinkDraft(null)); }}>
            <label>Nome do link<input value={linkDraft.name} onChange={event => setLinkDraft({ ...linkDraft, name: event.target.value })} required minLength={2} maxLength={80} disabled={pending} /></label>
            {forms.length > 0 && <fieldset><legend>Formulários visíveis <span className="lead-muted">(nenhum marcado = todos)</span></legend>
              {forms.map(form => <label key={form.id} className="lead-check"><input type="checkbox" checked={linkDraft.formIds.includes(form.id)} onChange={() => setLinkDraft({ ...linkDraft, formIds: linkDraft.formIds.includes(form.id) ? linkDraft.formIds.filter(id => id !== form.id) : [...linkDraft.formIds, form.id] })} />{form.name}</label>)}</fieldset>}
            <label className="lead-check"><input type="checkbox" checked={linkDraft.canUpdate} onChange={event => setLinkDraft({ ...linkDraft, canUpdate: event.target.checked })} />Permitir mudar status e escrever notas</label>
            <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setLinkDraft(null)} disabled={pending}>Cancelar</button><button type="submit" className="lead-btn is-primary" disabled={pending}>Salvar</button></div>
          </form> : <>
            <div className="lead-source-main">
              <strong>{link.name}{!link.active && <span className="lead-badge is-off">Desativado</span>}</strong>
              <small>{link.formIds?.length ? link.formIds.map(formName).join(", ") : "Todas as fontes"} · {link.canUpdate ? "pode atualizar status e notas" : "somente visualização"} · última abertura: {when(link.lastOpenedAt)}</small>
              {adopt?.id === link.id && <form className="lead-adopt" onSubmit={event => { event.preventDefault(); run(() => adoptLeadLinkCodeAction({ clientId, linkId: link.id, code: adopt.code }), () => { setAdopt(null); void copy(linkUrl(adopt.code), link.id); }); }}>
                <small>Este link é anterior à cópia. Cole o código atual (a parte final do endereço) para guardá-lo, ou gere um novo código.</small>
                <div><input value={adopt.code} onChange={event => setAdopt({ ...adopt, code: event.target.value })} placeholder="Código do link" aria-label="Código do link" disabled={pending} />
                  <button type="submit" className="lead-btn is-primary" disabled={pending || adopt.code.trim().length < 16}>Guardar e copiar</button><button type="button" className="lead-btn" onClick={() => setAdopt(null)}>Cancelar</button></div></form>}
            </div>
            <div className="lead-source-actions">
              <button type="button" className="lead-btn" disabled={pending} onClick={() => copyLink(link)}>{copied === link.id ? <Check size={14} /> : <Copy size={14} />}{copied === link.id ? "Copiado" : "Copiar link"}</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => { setNotice(""); setError(""); setLinkDraft({ id: link.id, name: link.name, formIds: link.formIds ?? [], canUpdate: link.canUpdate }); }}><Pencil size={14} />Editar</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => updateLeadLinkAction({ clientId, linkId: link.id, active: !link.active }))}>{link.active ? "Desativar" : "Ativar"}</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => { if (window.confirm(`Gerar um novo código para “${link.name}”? O endereço atual deixa de funcionar na hora.`)) run(() => rotateLeadLinkAction({ clientId, linkId: link.id }), result => { if (result.code) setShown({ code: result.code, title: link.name }); }); }}><KeyRound size={14} />Novo código</button>
              <button type="button" className="lead-btn is-danger" disabled={pending} onClick={() => { if (window.confirm(`Excluir o link “${link.name}” para sempre? Quem tem o endereço perde o acesso e ele não volta. Os leads não são apagados.`)) run(() => deleteLeadLinkAction({ clientId, linkId: link.id })); }}><Trash2 size={14} />Excluir</button>
            </div>
          </>}
        </li>)}</ul>}
      <form className="lead-form-inline" onSubmit={event => { event.preventDefault(); addLink(event.currentTarget); }}>
        <label>Nome do link<input name="name" required minLength={2} maxLength={80} placeholder="Ex.: Equipe comercial" disabled={pending} /></label>
        {forms.length > 0 && <fieldset><legend>Formulários visíveis <span className="lead-muted">(nenhum marcado = todos)</span></legend>
          {forms.map(form => <label key={form.id} className="lead-check"><input type="checkbox" name="forms" value={form.id} disabled={pending} />{form.name}</label>)}</fieldset>}
        <label className="lead-check"><input type="checkbox" name="canUpdate" disabled={pending} />Permitir mudar status e escrever notas</label>
        <button type="submit" className="lead-btn is-primary" disabled={pending}>Criar link</button>
      </form>
    </section>
  </div>;
}
