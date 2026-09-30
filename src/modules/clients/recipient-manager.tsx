"use client";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { loadRecipients, recordRecipientConsent, saveRecipient } from "./recipient-actions";
import { consentInputSchema, recipientInputSchema, type Recipient, type RecipientData, type RecipientResult } from "./recipient-schema";

const labels: Record<string, string> = { created: "Cadastro", updated: "Dados alterados", phone_changed: "Telefone alterado — autorização invalidada", activated: "Ativado", deactivated: "Desativado", granted: "Autorização registrada", revoked: "Descadastro registrado" };
const statusLabels = { pending: "Sem autorização", granted: "Autorização registrada", revoked: "Descadastrado" };
type Pane = { type: "edit"; recipient: Recipient | null } | { type: "grant" | "revoke" | "history"; recipient: Recipient } | null;

export function RecipientManager({ demo, agencyId, clientId, canEdit, archived }: { demo: boolean; agencyId?: string; clientId: string; canEdit: boolean; archived: boolean }) {
  const [data, setData] = useState<RecipientData>({ recipients: [], events: [] });
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pane, setPane] = useState<Pane>(null);
  const [pending, startTransition] = useTransition();
  const allowed = demo || canEdit;
  useEffect(() => {
    if (demo) return;
    let live = true;
    loadRecipients({ agencyId, clientId }).then(result => {
      if (!live) return;
      if ("error" in result) setError(result.error); else setData(result);
    }).catch(() => { if (live) setError("Não foi possível carregar. Feche e reabra este painel para tentar novamente."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [demo, agencyId, clientId]);
  function select(next: Pane) { setError(""); setNotice(""); setPane(next); }
  function complete(result: RecipientResult) {
    if ("error" in result) { setError(result.error); return; }
    setData(result); setPane(null); setError("");
    setNotice(demo ? "Simulação atualizada. Nenhuma mensagem enviada e nada gravado no banco." : "Registro salvo. Nenhuma mensagem enviada.");
  }
  function simulate(recipient: Recipient, eventType: string, source: string, occurredAt: string) {
    return { recipients: [...data.recipients.filter(item => item.id !== recipient.id), recipient], events: [{ id: crypto.randomUUID(), recipient_id: recipient.id, event_type: eventType, phone: recipient.phone, source, occurred_at: occurredAt, recorded_at: new Date().toISOString(), actor_id: null }, ...data.events] };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pane || pane.type === "history") return;
    const form = new FormData(event.currentTarget);
    const current = pane;
    setError("");
    if (current.type === "edit") {
      const parsed = recipientInputSchema.safeParse({ name: form.get("name"), phone: form.get("phone"), active: form.get("active") === "on" });
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      if (demo && data.recipients.some(item => item.phone === parsed.data.phone && item.id !== current.recipient?.id)) { setError("Este telefone já está cadastrado para o cliente."); return; }
      startTransition(async () => {
        try {
          if (!demo) { complete(await saveRecipient({ ...parsed.data, agencyId, clientId, id: current.recipient?.id ?? null })); return; }
          const previous = current.recipient;
          const changed = previous && previous.phone !== parsed.data.phone;
          const recipient: Recipient = { id: previous?.id ?? crypto.randomUUID(), consent_status: "pending", consent_at: null, consent_source: null, unsubscribed_at: null, ...previous, ...parsed.data };
          if (changed) Object.assign(recipient, { consent_status: "pending", consent_at: null, consent_source: null, unsubscribed_at: null });
          complete(simulate(recipient, !previous ? "created" : changed ? "phone_changed" : previous.active !== recipient.active ? recipient.active ? "activated" : "deactivated" : "updated", "Cadastro demonstrativo", new Date().toISOString()));
        } catch { setError("Não foi possível salvar. Confira sua conexão e tente novamente."); }
      });
    } else {
      const granted = current.type === "grant";
      if (granted && form.get("confirmed") !== "on") { setError("Confirme que existe autorização do destinatário."); return; }
      const rawDate = String(form.get("date") ?? "");
      const date = new Date(rawDate);
      const occurredAt = granted ? form.get("now") === "on" ? new Date().toISOString() : Number.isNaN(date.getTime()) ? null : date.toISOString() : null;
      const parsed = consentInputSchema.safeParse({ granted, source: form.get("source"), occurredAt });
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      if (granted && current.recipient.unsubscribed_at && occurredAt! <= current.recipient.unsubscribed_at) { setError("A nova autorização deve ser posterior ao último descadastro."); return; }
      if (granted && data.events.some(item => item.recipient_id === current.recipient.id && item.phone === current.recipient.phone && item.event_type === "revoked" && item.occurred_at >= occurredAt!)) { setError("A autorização deve ser posterior ao descadastro deste telefone."); return; }
      startTransition(async () => {
        try {
          if (!demo) { complete(await recordRecipientConsent({ ...parsed.data, agencyId, clientId, id: current.recipient.id, phone: current.recipient.phone })); return; }
          const now = new Date().toISOString();
          const recipient: Recipient = { ...current.recipient, consent_status: granted ? "granted" : "revoked", consent_at: granted ? occurredAt : current.recipient.consent_at, consent_source: granted ? parsed.data.source : current.recipient.consent_source, unsubscribed_at: granted ? null : now };
          complete(simulate(recipient, granted ? "granted" : "revoked", parsed.data.source, occurredAt ?? now));
        } catch { setError("Não foi possível registrar. Confira sua conexão e tente novamente."); }
      });
    }
  }
  return <div className="space-y-5">
    <p className="info-banner">{demo ? "Demonstração: alterações descartadas ao fechar este painel. " : ""}Cadastrar um telefone não autoriza envios. Nenhuma mensagem será enviada nesta etapa.</p>
    {loading && <p role="status">Carregando destinatários…</p>}
    {notice && <p role="status" className="text-sm muted">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    {!pane && !loading && !error && <>
      {allowed && !archived && <Button onClick={() => select({ type: "edit", recipient: null })}>Novo destinatário</Button>}
      {archived && <p className="muted text-sm">Cliente arquivado: apenas consulta e descadastro estão disponíveis.</p>}
      {!data.recipients.length && <p className="muted text-sm">Nenhum destinatário cadastrado.</p>}
      {data.recipients.map(recipient => <section className="panel p-4 space-y-3" key={recipient.id}><div className="flex justify-between items-start gap-3"><div className="min-w-0"><h3 className="font-medium break-words">{recipient.name}</h3><p className="muted font-mono text-xs mt-1">{recipient.phone}</p></div><span className={`badge ${recipient.consent_status === "granted" && recipient.active ? "green" : "neutral"}`}>{!recipient.active ? "Inativo" : statusLabels[recipient.consent_status]}</span></div><div className="flex gap-4 flex-wrap text-xs">{allowed && !archived && <button className="text-link" onClick={() => select({ type: "edit", recipient })}>Editar destinatário</button>}{allowed && !archived && recipient.active && recipient.consent_status !== "granted" && <button className="text-link" onClick={() => select({ type: "grant", recipient })}>Registrar autorização</button>}{allowed && recipient.consent_status !== "revoked" && <button className="text-link" onClick={() => select({ type: "revoke", recipient })}>Descadastrar</button>}<button className="text-link" onClick={() => select({ type: "history", recipient })}>Histórico</button></div></section>)}
    </>}
    {pane && <><button className="text-link" disabled={pending} onClick={() => select(null)}>← Voltar aos destinatários</button><h3 className="font-medium">{pane.type === "edit" ? pane.recipient ? "Editar destinatário" : "Novo destinatário" : pane.type === "grant" ? "Registrar autorização" : pane.type === "revoke" ? "Confirmar descadastro" : "Histórico de registros"}</h3>
      {pane.type === "history" ? <ol className="space-y-4">{data.events.filter(item => item.recipient_id === pane.recipient.id).map(item => <li className="border-t border-border pt-3" key={item.id}><strong className="text-sm">{labels[item.event_type] ?? item.event_type}</strong><p className="muted text-xs mt-1">{new Date(item.occurred_at).toLocaleString("pt-BR")} · {item.phone}</p><p className="muted text-xs mt-1 break-words">Origem: {item.source}</p><p className="muted text-xs mt-1 break-all">Registrado em {new Date(item.recorded_at).toLocaleString("pt-BR")} · Autor: {item.actor_id ?? "demonstração"}</p></li>)}</ol> : <form onSubmit={submit} className="space-y-4" key={`${pane.type}-${pane.recipient?.id ?? "new"}`}>
        {pane.type === "edit" ? <>
          <label className="block text-sm">Nome do destinatário<input className="input mt-2" name="name" required minLength={2} maxLength={120} defaultValue={pane.recipient?.name} disabled={pending} /></label>
          <label className="block text-sm">Telefone internacional<input className="input mt-2" name="phone" type="tel" required maxLength={16} placeholder="+5511999999999" defaultValue={pane.recipient?.phone} disabled={pending} /></label>
          <p className="muted text-xs">Use +, país, DDD e número sem espaços. A validação de formato não confirma o titular. Trocar o número exige nova autorização.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={pane.recipient?.active ?? true} disabled={pending} />Destinatário ativo</label>
        </> : <>
          <p className="muted text-sm">{pane.recipient.name} · {pane.recipient.phone}</p>
          <label className="block text-sm">{pane.type === "grant" ? "Origem e referência da autorização" : "Motivo ou origem do descadastro"}<textarea name="source" className="input mt-2" rows={3} required minLength={2} maxLength={1000} disabled={pending} placeholder={pane.type === "grant" ? "Ex.: formulário de autorização, protocolo ou referência do registro" : "Ex.: solicitação do destinatário ao gestor"} /></label>
          {pane.type === "grant" && <><label className="block text-sm">Data da autorização (horário deste navegador)<input type="datetime-local" step="1" name="date" className="input mt-2" disabled={pending} /></label><label className="flex items-center gap-2 text-sm"><input name="now" type="checkbox" disabled={pending} />A autorização foi recebida agora</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required disabled={pending} />Confirmo que o destinatário autorizou o recebimento de relatórios neste número.</label></>}
          {pane.type === "revoke" && <p className="muted text-sm">O destinatário ficará sem autorização. O histórico será preservado; reativá-lo não restabelece a autorização.</p>}
        </>}
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : pane.type === "edit" ? "Salvar destinatário" : pane.type === "grant" ? "Confirmar autorização" : "Confirmar descadastro"}</Button>
      </form>}
    </>}
  </div>;
}
