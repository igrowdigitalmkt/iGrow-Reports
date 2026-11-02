"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2, Plug, RefreshCw } from "lucide-react";
import {
  createLeadLinkAction, createLeadSourceAction, setLeadSourceActiveAction, syncLeadSourceAction, updateLeadLinkAction,
  type SettingsResult, type SettingsSnapshot,
} from "./hub-actions";
import type { BoardForm } from "./hub-types";
import "./lead-feed.css";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const when = (iso: string | null) => iso ? dateTime.format(new Date(iso)) : "nunca";

/** Fontes de leads (Páginas do Facebook) e links compartilhados do cliente. Só proprietário e administrador chegam aqui. */
export function LeadsSettings({ clientId, initial, forms }: { clientId: string; initial: SettingsSnapshot; forms: BoardForm[] }) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const addSource = (form: HTMLFormElement) => {
    const values = new FormData(form);
    run(() => createLeadSourceAction({ clientId, title: String(values.get("title") ?? ""), fbPageId: String(values.get("fbPageId") ?? "").trim(), formId: String(values.get("formId") ?? "").trim() || undefined }), () => form.reset());
  };
  const addLink = (form: HTMLFormElement) => {
    const values = new FormData(form);
    const formIds = values.getAll("forms").map(String);
    run(() => createLeadLinkAction({ clientId, name: String(values.get("name") ?? ""), formIds: formIds.length ? formIds : undefined, canUpdate: values.get("canUpdate") === "on" }), result => { setNewCode(result.code ?? null); setCopied(false); form.reset(); });
  };
  const linkUrl = (code: string) => `${window.location.origin}/leads/${code}`;
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* sem permissão da área de transferência */ } };

  return <div className="leads-settings">
    {error && <p role="alert" className="lead-error">{error}</p>}
    {notice && <p role="status" className="lead-notice-line">{notice}</p>}

    <section className="lead-panel" aria-labelledby="lead-sources-title">
      <header><div><h2 id="lead-sources-title">Páginas conectadas</h2><p>Páginas do Facebook cujos formulários de lead alimentam este menu.</p></div><Plug size={18} className="lead-muted" /></header>
      {data.sources.length === 0 ? <p className="lead-muted">Nenhuma Página conectada ainda. Cadastre abaixo a Página que recebe os leads do anúncio.</p>
        : <ul className="lead-source-list">{data.sources.map(source => <li key={source.id}>
          <div className="lead-source-main">
            <strong>{source.title}</strong>
            <small>Página {source.fbPageId}{source.formId ? ` · formulário ${source.formId}` : " · todos os formulários"}</small>
            <small>{source.leadCount} lead(s) · último lead: {when(source.lastLeadAt)} · conferido na Meta: {when(source.lastSyncedAt)}</small>
            {source.syncError ? <small className="lead-source-error">{source.syncError}</small> : source.lastSyncedAt ? <small className="lead-source-ok">Conexão com a Meta em ordem.</small> : null}
          </div>
          <div className="lead-source-actions">
            <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => syncLeadSourceAction({ clientId, sourceId: source.id }))}><RefreshCw size={14} />Verificar conexão</button>
            <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => setLeadSourceActiveAction({ clientId, sourceId: source.id, active: !source.active }))}>{source.active ? "Pausar" : "Reativar"}</button>
          </div>
        </li>)}</ul>}
      <form className="lead-form-inline" onSubmit={event => { event.preventDefault(); addSource(event.currentTarget); }}>
        <label>Nome<input name="title" required minLength={2} maxLength={160} placeholder="Ex.: Página da RM Imobiliária" disabled={pending} /></label>
        <label>ID da Página do Facebook<input name="fbPageId" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Somente números" disabled={pending} /></label>
        <label>ID do formulário <span className="lead-muted">(opcional)</span><input name="formId" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Em branco = todos" disabled={pending} /></label>
        <button type="submit" className="lead-btn is-primary" disabled={pending}>{pending ? "Conectando…" : "Conectar Página"}</button>
      </form>
    </section>

    <section className="lead-panel" aria-labelledby="lead-links-title">
      <header><div><h2 id="lead-links-title">Links compartilhados</h2><p>Para ver os leads sem entrar na plataforma. Cada link é separado e pode ser revogado a qualquer momento.</p></div><Link2 size={18} className="lead-muted" /></header>
      {newCode && <div className="lead-newlink" role="status"><strong>Link criado. Copie agora, ele não aparece de novo:</strong>
        <div><code>{linkUrl(newCode)}</code><button type="button" className="lead-btn" onClick={() => void copy(linkUrl(newCode))}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copiado" : "Copiar link"}</button></div></div>}
      {data.links.length === 0 ? <p className="lead-muted">Nenhum link criado.</p>
        : <ul className="lead-source-list">{data.links.map(link => <li key={link.id}>
          <div className="lead-source-main">
            <strong>{link.name}{!link.active && <span className="lead-badge is-off">Revogado</span>}</strong>
            <small>{link.formIds?.length ? `${link.formIds.length} formulário(s)` : "Todos os formulários"} · {link.canUpdate ? "pode atualizar status e notas" : "somente visualização"} · última abertura: {when(link.lastOpenedAt)}</small>
          </div>
          <div className="lead-source-actions">
            {link.active && <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => updateLeadLinkAction({ clientId, linkId: link.id, canUpdate: !link.canUpdate }))}>{link.canUpdate ? "Só visualizar" : "Permitir atualizar"}</button>}
            <button type="button" className="lead-btn" disabled={pending} onClick={() => { if (!link.active || window.confirm(`Revogar o link "${link.name}"? Quem tem esse endereço perde o acesso na hora.`)) run(() => updateLeadLinkAction({ clientId, linkId: link.id, active: !link.active })); }}>{link.active ? "Revogar" : "Reativar"}</button>
          </div>
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
