"use client";

import { useState, useTransition } from "react";
import { useEffect, useRef } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, KeyRound, Link2, Loader2, Pencil, Plug, Plus, RefreshCw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import {
  adoptLeadLinkCodeAction, createLeadLinkAction, createLeadSourceAction, deleteLeadLinkAction, deleteLeadSourceAction, connectInstagramAction, getLeadLinkCodeAction, listAvailableLeadPagesAction, listInstagramAccountsAction, type InstagramAccountOption, rotateLeadLinkAction,
  setLeadSourceActiveAction, syncLeadSourceAction, updateLeadLinkAction, updateLeadSourceAction, type SettingsResult, type SettingsSnapshot,
} from "./hub-actions";
import type { BoardForm } from "./hub-types";
import { LeadsWhatsApp } from "./leads-whatsapp";
import { Dialog } from "@/components/ui/dialog";
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
  const [busy, setBusy] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<{ code: string; title: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null);
  const [removing, setRemoving] = useState<{ source: SettingsSnapshot["sources"][number]; step: 1 | 2; typed: string } | null>(null);
  const [picker, setPicker] = useState<{ pages: { id: string; name: string; category: string | null; connected: boolean }[]; query: string } | "loading" | null>(null);
  const [adopt, setAdopt] = useState<{ id: string; code: string } | null>(null);

  const formName = (id: string) => forms.find(form => form.id === id)?.name ?? `Formulário …${id.slice(-4)}`;
  const run = (action: () => Promise<SettingsResult>, after?: (result: Extract<SettingsResult, { ok: true }>) => void, label = "Salvando…", pageId: string | null = null) => {
    setError(""); setNotice(""); setBusy(label); setConnectingId(pageId);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) { setError(result.message); return; }
        setData({ sources: result.sources, links: result.links });
        if (result.warning) setError(result.warning);
        else if (result.message) setNotice(result.message);
        after?.(result);
      } catch { setError("Não foi possível concluir agora. Tente de novo em instantes."); }
      finally { setBusy(""); setConnectingId(null); }
    });
  };
  useEffect(() => { if (busy || error || notice) statusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [busy, error, notice]);
  const copy = async (value: string, key: string) => { try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? null : current), 1800); } catch { setError("O navegador não deixou copiar. Selecione o link e copie manualmente."); } };

  const [igPicker, setIgPicker] = useState<{ accounts: InstagramAccountOption[]; query: string } | "loading" | null>(null);
  const openIgPicker = () => {
    setError(""); setNotice(""); setIgPicker("loading");
    void listInstagramAccountsAction({ clientId }).then(result => {
      if (!result.ok) { setIgPicker(null); setError(result.message); return; }
      setIgPicker({ accounts: result.accounts, query: "" });
    }).catch(() => { setIgPicker(null); setError("Não foi possível buscar as contas do Instagram agora. Tente de novo."); });
  };
  const connectIg = (account: InstagramAccountOption) => run(() => connectInstagramAction({ clientId, igAccountId: account.igId }), () => setIgPicker(null), `Conectando ${account.username ? `@${account.username}` : "a conta"} e assinando as mensagens…`, account.igId);
  const openPicker = () => {
    setError(""); setNotice(""); setPicker("loading");
    void listAvailableLeadPagesAction({ clientId }).then(result => {
      if (!result.ok) { setPicker(null); setError(result.message); return; }
      setPicker({ pages: result.pages, query: "" });
    }).catch(() => { setPicker(null); setError("Não foi possível buscar as Páginas agora. Tente de novo."); });
  };
  const connectPage = (page: { id: string; name: string }) => run(() => createLeadSourceAction({ clientId, title: page.name, fbPageId: page.id }), () => setPicker(null), `Conectando “${page.name}” e conferindo na Meta…`, page.id);
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

  const confirmRemoval = () => {
    if (!removing) return;
    const { source, typed } = removing;
    setRemoving(null);
    run(() => deleteLeadSourceAction({ clientId, sourceId: source.id, confirmName: typed }), undefined, `Excluindo “${source.title}” e os leads dela…`);
  };
  const nameMatches = !!removing && removing.typed.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR") === removing.source.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

  return <div className="leads-settings">
    <Dialog open={!!removing} onOpenChange={open => { if (!open) setRemoving(null); }} title={removing?.step === 2 ? "Confirme o nome da Página" : "Excluir esta Página?"}
      description={removing ? `“${removing.source.title}”` : undefined}>
      {removing && (removing.step === 1 ? <div className="lead-delete-dialog">
        <p>Você tem certeza que deseja excluir esta Página? <strong>Com a exclusão, todos os leads dela ({removing.source.leadCount}) serão excluídos juntos</strong>, com as notas e o histórico. Isso não pode ser desfeito.</p>
        <p className="lead-muted">Para só parar de receber novos leads, use <strong>Pausar</strong>: os leads continuam no painel.</p>
        <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setRemoving(null)}>Cancelar</button><button type="button" className="lead-btn is-danger" onClick={() => setRemoving({ ...removing, step: 2 })}>Sim, continuar</button></div>
      </div> : <form className="lead-delete-dialog" onSubmit={event => { event.preventDefault(); if (nameMatches) confirmRemoval(); }}>
        <p>Para confirmar, digite o nome da Página exatamente como aparece abaixo.</p>
        <p className="lead-delete-name">{removing.source.title}</p>
        <label>Nome da Página<input value={removing.typed} onChange={event => setRemoving({ ...removing, typed: event.target.value })} autoFocus autoComplete="off" placeholder="Digite o nome da Página" aria-label="Nome da Página para confirmar" /></label>
        <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setRemoving({ ...removing, step: 1, typed: "" })}>Voltar</button><button type="submit" className="lead-btn is-danger" disabled={!nameMatches}>Excluir Página e leads</button></div>
      </form>)}
    </Dialog>
    <div ref={statusRef} className="lead-status-stack" aria-live="polite">
      {busy && <div className="lead-toast is-busy" role="status"><Loader2 size={18} className="lead-spin" aria-hidden="true" /><div><strong>Aguarde</strong><span>{busy}</span></div></div>}
      {error && <div className="lead-toast is-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><strong>Não foi possível concluir</strong><span>{error}</span></div><button type="button" onClick={() => setError("")} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {notice && <div className="lead-toast is-ok" role="status"><CheckCircle2 size={18} aria-hidden="true" /><div><strong>Pronto</strong><span>{notice}</span></div><button type="button" onClick={() => setNotice("")} aria-label="Fechar aviso"><X size={15} /></button></div>}
    </div>

    <section className="lead-panel" aria-labelledby="lead-channels-title">
      <header><div><h2 id="lead-channels-title">Canais de leads</h2><p>Os canais por onde os contatos chegam a este menu.</p></div><Plug size={18} className="lead-muted" /></header>
      <ul className="lead-channel-list">
        <li><div><strong>Formulários de anúncio</strong><small>Facebook e Instagram: o cadastro preenchido no anúncio.</small></div>
          {data.sources.some(source => source.active) ? <span className="lead-badge">Ativo</span> : <span className="lead-badge is-off">Sem fonte conectada</span>}</li>
        <li className="lead-channel-wide"><LeadsWhatsApp clientId={clientId} onMessage={(kind, text) => { if (kind === "error") { setError(text); setNotice(""); } else { setNotice(text); setError(""); } }} /></li>
        <li className="lead-channel-wide"><div className="lead-wa">
          <div className="lead-wa-head"><div><strong>Instagram Direct</strong><small>Quem manda uma mensagem direta para a conta profissional do cliente vira lead, com o usuário e a primeira mensagem. A conversa continua no Instagram.</small></div>
            {data.sources.some(source => source.kind === "instagram" && source.active) ? <span className="lead-badge">Ativo</span> : <span className="lead-badge is-off">Sem conta conectada</span>}</div>
          {igPicker === null && <div className="lead-form-actions"><button type="button" className="lead-btn is-primary" onClick={openIgPicker} disabled={pending}><Plus size={14} aria-hidden="true" />Conectar conta do Instagram</button></div>}
          {igPicker === "loading" && <div className="lead-picker is-loading" role="status"><Loader2 size={20} className="lead-spin" aria-hidden="true" /><div><strong>Buscando as contas do Instagram na Meta…</strong><small>Usamos a conexão que você já fez. Pode levar alguns segundos.</small></div></div>}
          {igPicker && igPicker !== "loading" && <div className="lead-picker">
            <div className="lead-picker-head">
              <label className="lead-picker-search"><Search size={14} aria-hidden="true" /><input value={igPicker.query} onChange={event => setIgPicker({ ...igPicker, query: event.target.value })} placeholder="Buscar conta pelo usuário ou Página" aria-label="Buscar conta do Instagram" autoFocus /></label>
              <button type="button" className="lead-btn" onClick={() => setIgPicker(null)} disabled={pending}>Fechar</button>
            </div>
            {(() => {
              const term = igPicker.query.trim().toLocaleLowerCase("pt-BR");
              const shown = igPicker.accounts.filter(item => !term || `${item.username ?? ""} ${item.name ?? ""} ${item.pageName}`.toLocaleLowerCase("pt-BR").includes(term));
              return shown.length === 0 ? <p className="lead-muted">{igPicker.accounts.length ? "Nenhuma conta com esse nome." : "A Meta não mostrou nenhuma conta profissional do Instagram ligada às suas Páginas. Confira se a conta é profissional e está ligada à Página do cliente."}</p>
                : <ul className="lead-picker-list">{shown.map(item => <li key={item.igId}>
                  <div><strong>{item.username ? `@${item.username}` : item.name ?? "Conta do Instagram"}</strong><small>Página {item.pageName} · ID {item.igId}</small></div>
                  {item.connected ? <span className="lead-badge">Conectada</span> : <button type="button" className="lead-btn is-primary" onClick={() => connectIg(item)} disabled={pending}>{pending && connectingId === item.igId ? <><Loader2 size={14} className="lead-spin" aria-hidden="true" />Conectando…</> : "Conectar"}</button>}
                </li>)}</ul>;
            })()}
          </div>}
        </div></li>
      </ul>
    </section>

    <section className="lead-panel" aria-labelledby="lead-sources-title">
      <header><div><h2 id="lead-sources-title">Fontes de leads conectadas</h2><p>Por onde os leads chegam a este menu. Hoje: Páginas do Facebook, pelos formulários de anúncio. Pausar mantém os leads. Excluir apaga a Página e todos os leads dela.</p></div><Plug size={18} className="lead-muted" /></header>
      {data.sources.length === 0 ? <p className="lead-muted">Nenhuma fonte conectada ainda. Use “Conectar nova página” para escolher a Página do Facebook que recebe os leads dos anúncios.</p>
        : <ul className="lead-source-list">{data.sources.map(source => <li key={source.id}>
          {sourceDraft?.id === source.id ? <form className="lead-form-inline lead-inline-edit" onSubmit={event => { event.preventDefault(); run(() => updateLeadSourceAction({ clientId, sourceId: source.id, title: sourceDraft.title, formId: sourceDraft.formId.trim() || null }), () => setSourceDraft(null)); }}>
            <label>Nome<input value={sourceDraft.title} onChange={event => setSourceDraft({ ...sourceDraft, title: event.target.value })} required minLength={2} maxLength={160} disabled={pending} /></label>
            {data.sources.find(item => item.id === sourceDraft.id)?.kind !== "instagram" && <label>ID do formulário <span className="lead-muted">(vazio = todos)</span><input value={sourceDraft.formId} onChange={event => setSourceDraft({ ...sourceDraft, formId: event.target.value })} inputMode="numeric" pattern="[0-9]{5,30}" disabled={pending} /></label>}
            <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setSourceDraft(null)} disabled={pending}>Cancelar</button><button type="submit" className="lead-btn is-primary" disabled={pending}>Salvar</button></div>
          </form> : <>
            <div className="lead-source-main">
              <strong>{source.title}{!source.active && <span className="lead-badge is-off">Pausada</span>}</strong>
              {source.kind === "instagram" ? <small>Instagram Direct{source.igUsername ? ` · @${source.igUsername}` : ""} · Página {source.fbPageId}</small> : <small>Página {source.fbPageId}{source.formId ? ` · formulário ${source.formId}` : " · todos os formulários"} · {source.lastSyncedAt ? `${source.formCount} formulário(s) ativo(s)${source.archivedFormCount ? `, ${source.archivedFormCount} arquivado(s)` : ""}` : "ainda não conferida"}</small>}
              <small>{source.leadCount} lead(s) · último lead: {when(source.lastLeadAt)} · conferido na Meta: {when(source.lastSyncedAt)}</small>
              {source.syncError ? <small className="lead-source-error">{source.syncError}</small> : source.lastSyncedAt ? <small className="lead-source-ok">Conexão com a Meta em ordem.</small> : null}
              {source.kind === "facebook" && !source.syncError && source.lastSyncedAt && source.formCount === 0 && <p className="lead-notice-line is-warn" role="status"><TriangleAlert size={14} />{source.archivedFormCount > 0
                ? `Esta Página só tem formulários arquivados na Meta (${source.archivedFormCount}). Nenhum formulário ativo para receber leads. Reative um formulário ou crie um novo no Gerenciador de Anúncios.`
                : source.formId ? "O formulário informado não foi encontrado nesta Página. Confira o ID do formulário ou a Página escolhida."
                  : "Nenhum formulário de anúncio encontrado nesta Página. Confira se é a Página certa ou crie um formulário instantâneo no Gerenciador de Anúncios; os leads aparecem aqui assim que houver um."}</p>}
            </div>
            <div className="lead-source-actions">
              <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => syncLeadSourceAction({ clientId, sourceId: source.id }), undefined, `Conferindo “${source.title}” na Meta…`)}><RefreshCw size={14} />Verificar conexão</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => { setNotice(""); setError(""); setSourceDraft({ id: source.id, title: source.title, formId: source.formId ?? "" }); }}><Pencil size={14} />Editar</button>
              <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => setLeadSourceActiveAction({ clientId, sourceId: source.id, active: !source.active }))}>{source.active ? "Pausar" : "Reativar"}</button>
              <button type="button" className="lead-btn is-danger" disabled={pending} onClick={() => setRemoving({ source, step: 1, typed: "" })}><Trash2 size={14} />Excluir</button>
            </div>
          </>}
        </li>)}</ul>}
      {picker === null && <div className="lead-form-actions"><button type="button" className="lead-btn is-primary" onClick={openPicker} disabled={pending}><Plus size={14} />Conectar nova página</button></div>}
      {picker === "loading" && <div className="lead-picker is-loading" role="status"><Loader2 size={20} className="lead-spin" aria-hidden="true" /><div><strong>Buscando suas Páginas na Meta…</strong><small>Estamos usando a conexão que você já fez. Pode levar alguns segundos.</small></div></div>}
      {picker && picker !== "loading" && <div className="lead-picker">
        <div className="lead-picker-head">
          <label className="lead-picker-search"><Search size={14} aria-hidden="true" /><input value={picker.query} onChange={event => setPicker({ ...picker, query: event.target.value })} placeholder="Buscar Página pelo nome" aria-label="Buscar Página" autoFocus /></label>
          <button type="button" className="lead-btn" onClick={() => setPicker(null)} disabled={pending}>Fechar</button>
        </div>
        {(() => {
          const term = picker.query.trim().toLocaleLowerCase("pt-BR");
          const shownPages = picker.pages.filter(page => !term || page.name.toLocaleLowerCase("pt-BR").includes(term));
          return shownPages.length === 0 ? <p className="lead-muted">{picker.pages.length ? "Nenhuma Página com esse nome." : "A Meta não liberou nenhuma Página para esta conexão. Use o ID manual abaixo."}</p>
            : <ul className="lead-picker-list">{shownPages.map(page => <li key={page.id}>
              <div><strong>{page.name}</strong><small>{page.category ? `${page.category} · ` : ""}ID {page.id}</small></div>
              {page.connected ? <span className="lead-badge">Conectada</span> : <button type="button" className="lead-btn is-primary" onClick={() => connectPage(page)} disabled={pending}>{pending && connectingId === page.id ? <><Loader2 size={14} className="lead-spin" aria-hidden="true" />Conectando…</> : "Conectar"}</button>}
            </li>)}</ul>;
        })()}
      </div>}
      <details className="lead-manual">
        <summary>Informar o ID da Página manualmente</summary>
      <form className="lead-form-inline" onSubmit={event => { event.preventDefault(); addSource(event.currentTarget); }}>
        <label>Nome<input name="title" required minLength={2} maxLength={160} placeholder="Ex.: Página de captação do cliente" disabled={pending} /></label>
        <label>ID da Página do Facebook<input name="fbPageId" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Somente números" disabled={pending} /></label>
        <label>ID do formulário <span className="lead-muted">(opcional)</span><input name="formId" inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Em branco = todos" disabled={pending} /></label>
        <button type="submit" className="lead-btn is-primary" disabled={pending}>{pending ? "Conectando…" : "Conectar Página"}</button>
      </form>
      </details>
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
            {forms.length > 0 && <fieldset><legend>Fontes visíveis <span className="lead-muted">(nenhum marcado = todos)</span></legend>
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
        {forms.length > 0 && <fieldset><legend>Fontes visíveis <span className="lead-muted">(nenhum marcado = todos)</span></legend>
          {forms.map(form => <label key={form.id} className="lead-check"><input type="checkbox" name="forms" value={form.id} disabled={pending} />{form.name}</label>)}</fieldset>}
        <label className="lead-check"><input type="checkbox" name="canUpdate" disabled={pending} />Permitir mudar status e escrever notas</label>
        <button type="submit" className="lead-btn is-primary" disabled={pending}>Criar link</button>
      </form>
    </section>
  </div>;
}
