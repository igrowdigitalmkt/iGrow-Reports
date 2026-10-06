"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Archive, ArrowUpRight, DatabaseZap, Mail, Pencil, Plus, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { RowMenu, type RowMenuItem } from "@/components/ui/row-menu";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { demoClients } from "@/modules/operations/demo-data";
import { saveClient, setClientArchived } from "./actions";
import { clientInputSchema, type ClientItem, type ClientResult } from "./schema";
import { RecipientManager } from "./recipient-manager";
import { ClientAccessManager } from "@/modules/client-portal/client-access-manager";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "@/modules/client-portal/types";
import { ClientMetaManager } from "@/modules/meta/client-meta-manager";
import type { MetaAdminSnapshot } from "@/modules/meta/types";

const samples: ClientItem[] = demoClients.map((client, index) => ({ id: `demo-${index}`, name: client.name, notes: client.segment, archived_at: null, updated_at: "2026-09-30T12:00:00Z" }));

export function ClientManager({ demo, initialClients = [], agencyId, canEdit = false, canManageClientAccess = false, clientPortalAdminReady = false, portalAccesses = [], portalInvitations = [], metaSnapshot = { accounts: [], links: [], mappings: [], integration: null, connections: [], serverReadiness: { databaseReady: false, serviceRoleConfigured: false, encryptionConfigured: false, apiVersion: null, ready: false } }, search }: { demo: boolean; initialClients?: ClientItem[]; agencyId?: string; canEdit?: boolean; canManageClientAccess?: boolean; clientPortalAdminReady?: boolean; portalAccesses?: ClientPortalAdminAccess[]; portalInvitations?: ClientPortalPendingInvitation[]; metaSnapshot?: MetaAdminSnapshot; search: string }) {
  const [rows, setRows] = useState(demo ? samples : initialClients);
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<ClientItem | "new" | null>(null);
  const [archiving, setArchiving] = useState<ClientItem | null>(null);
  const [recipientClient, setRecipientClient] = useState<ClientItem | null>(null);
  const [accessClient, setAccessClient] = useState<ClientItem | null>(null);
  const [metaClient, setMetaClient] = useState<ClientItem | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const allowed = demo || canEdit;
  const filtered = rows.filter(row => (filter === "all" || (filter === "archived" ? !!row.archived_at : !row.archived_at)) && `${row.name} ${row.notes ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  function apply(result: ClientResult, message: string) {
    if ("error" in result) { setError(result.error); return; }
    setRows(previous => [result.client, ...previous.filter(row => row.id !== result.client.id)].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setEditing(null); setArchiving(null); setError("");
    setNotice(demo ? `${message} Simulação apenas nesta página; nada foi gravado no banco.` : message);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = clientInputSchema.safeParse({ name: form.get("name"), notes: form.get("notes") });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError("");
    startTransition(async () => {
      try {
        const existing = editing && editing !== "new" ? editing : null;
        const result = demo ? { client: { ...parsed.data, id: existing?.id ?? crypto.randomUUID(), archived_at: null, updated_at: new Date().toISOString() } }
          : await saveClient({ ...parsed.data, id: existing?.id, agencyId });
        apply(result, existing ? "Cliente atualizado." : "Cliente cadastrado.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }
  function archive() {
    if (!archiving) return;
    setError("");
    startTransition(async () => {
      try {
        const archived = !archiving.archived_at;
        const result = demo ? { client: { ...archiving, archived_at: archived ? new Date().toISOString() : null } }
          : await setClientArchived({ id: archiving.id, agencyId, archived });
        apply(result, archived ? "Cliente arquivado. Histórico preservado." : "Cliente reativado.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }
  return <>
    <Dialog open={!!recipientClient} onOpenChange={open => { if (!open) setRecipientClient(null); }} title={`Destinatários · ${recipientClient?.name ?? ""}`} description="Cadastro, autorização de recebimento e histórico.">{recipientClient && <RecipientManager key={recipientClient.id} demo={demo} agencyId={agencyId} clientId={recipientClient.id} canEdit={canEdit} archived={!!recipientClient.archived_at} />}</Dialog>
    <Dialog open={!!accessClient} onOpenChange={open => { if (!open) setAccessClient(null); }} title={`Acesso do cliente · ${accessClient?.name ?? ""}`} description="Gerencie quem pode entrar na Área do Cliente.">{accessClient && agencyId && <ClientAccessManager key={accessClient.id} agencyId={agencyId} clientId={accessClient.id} clientName={accessClient.name} archived={!!accessClient.archived_at} initialAccesses={portalAccesses.filter(access => access.clientId === accessClient.id)} initialInvitations={portalInvitations.filter(invitation => invitation.clientId === accessClient.id)} />}</Dialog>
    <Dialog open={!!metaClient} onOpenChange={open => { if (!open) setMetaClient(null); }} title={`Dados Meta · ${metaClient?.name ?? ""}`} description="Associe as contas de anúncios deste cliente.">{metaClient && agencyId && <ClientMetaManager key={metaClient.id} agencyId={agencyId} clientId={metaClient.id} clientName={metaClient.name} archived={!!metaClient.archived_at} ready={metaSnapshot.serverReadiness.databaseReady} accounts={metaSnapshot.accounts.filter(account => metaSnapshot.connections.some(connection => connection.clientId === metaClient.id && connection.id === account.connectionId))} initialLinks={metaSnapshot.links.filter(link => link.clientId === metaClient.id)} initialMapping={metaSnapshot.mappings.find(mapping => mapping.clientId === metaClient.id) ?? null} connected={metaSnapshot.connections.some(connection => connection.clientId === metaClient.id)} />}</Dialog>
    <div className="section-toolbar">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="segmented" role="group" aria-label="Estado dos clientes">{[["active", "Ativos"], ["archived", "Arquivados"], ["all", "Todos"]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
        <span className="muted text-sm">{filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}</span>
      </div>
      {allowed && <Button onClick={() => { setError(""); setEditing("new"); }}><Plus size={16} />Novo cliente</Button>}
    </div>
    {demo && <p className="info-banner">Teste o cadastro com dados fictícios. As alterações são temporárias e desaparecem ao sair ou recarregar esta página.</p>}
    {!allowed && <p className="info-banner">Seu perfil é Leitor: você pode consultar os clientes, mas não alterar seus dados.</p>}
    {notice && <p role="status" className="info-banner">{notice}</p>}
    {filtered.length > 0 && <section className="panel" style={{ overflow: "hidden" }}><div className="table-scroll"><table className="data-table client-table">
      <caption className="sr-only">Clientes do espaço de trabalho</caption>
      <thead><tr><th scope="col">Cliente</th><th scope="col">Meta Ads</th><th scope="col">Situação</th><th scope="col">Atualizado</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
      <tbody>{filtered.map(client => {
        const linked = demo ? 2 : metaSnapshot.links.filter(link => link.clientId === client.id && link.active).length;
        const initials = client.name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
        const items: RowMenuItem[] = [
          { label: "Destinatários", icon: <Mail size={15} />, onSelect: () => setRecipientClient(client) },
          ...(canManageClientAccess && clientPortalAdminReady && !demo ? [{ label: "Acesso do cliente", icon: <ShieldCheck size={15} />, onSelect: () => setAccessClient(client) }] : []),
          ...(canEdit && !demo ? [{ label: "Contas Meta", icon: <DatabaseZap size={15} />, onSelect: () => setMetaClient(client) }] : []),
          { label: allowed && !client.archived_at ? "Editar cliente" : "Ver detalhes", icon: <Pencil size={15} />, onSelect: () => { setError(""); setEditing(client); }, separatorBefore: true },
          ...(allowed ? [{ label: client.archived_at ? "Reativar" : "Arquivar", icon: client.archived_at ? <RotateCcw size={15} /> : <Archive size={15} />, onSelect: () => { setError(""); setArchiving(client); }, danger: !client.archived_at }] : []),
        ];
        return <tr key={client.id} className="client-row">
          <th scope="row" style={{ fontWeight: 400 }}><div className="client-cell">
            <span className="client-avatar blue">{initials}</span>
            <div style={{ minWidth: 0 }}>{demo ? <strong>{client.name}</strong> : <Link href={`/dashboard/clientes/${client.id}`}><strong>{client.name}</strong></Link>}<small>{firstLine(client.notes) || "Sem observações"}</small></div>
          </div></th>
          <td>{linked ? `${linked} ${linked === 1 ? "conta" : "contas"}` : <span className="muted">Sem contas</span>}</td>
          <td>{client.archived_at ? <span className="badge neutral">Arquivado</span> : linked ? <span className="badge green"><span className="status-dot" />Ativo</span> : <span className="badge amber"><span className="status-dot" />Configurar Meta</span>}</td>
          <td className="muted">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(client.updated_at))}</td>
          <td><div className="row-actions">
            {!demo && !client.archived_at && <Link className="button button-ghost button-sm" href={`/dashboard/clientes/${client.id}`}>Abrir painel<ArrowUpRight size={14} /></Link>}
            <RowMenu label={`Mais ações para ${client.name}`} items={items} />
          </div></td>
        </tr>;
      })}</tbody>
    </table></div></section>}
    {!filtered.length && <section className="panel empty-state"><Users size={22} /><h3>Nenhum cliente encontrado</h3><p>{search ? "Ajuste sua busca ou o filtro de estado." : "Cadastre seu primeiro cliente ou consulte os arquivados."}</p></section>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !pending) setEditing(null); }} title={editing === "new" ? "Novo cliente" : "Dados do cliente"} description={demo ? "Demonstração temporária, sem persistência no banco." : "Dados pertencentes ao espaço de trabalho selecionado."}>
      <form onSubmit={submit} key={editing === "new" ? "new" : editing?.id}>
        <label className="block text-sm" htmlFor="client-name">Nome do cliente</label><input id="client-name" name="name" className="input mt-2" required minLength={2} maxLength={160} defaultValue={editing && editing !== "new" ? editing.name : ""} disabled={pending || !allowed || !!(editing && editing !== "new" && editing.archived_at)} />
        <label className="block text-sm mt-5" htmlFor="client-notes">Observações <span className="muted">(opcional)</span></label><textarea id="client-notes" name="notes" className="input mt-2" rows={5} maxLength={10000} defaultValue={editing && editing !== "new" ? editing.notes ?? "" : ""} disabled={pending || !allowed || !!(editing && editing !== "new" && editing.archived_at)} />
        {error && <p role="alert" className="mt-4 text-rose-400 text-sm">{error}</p>}
        {allowed && !(editing && editing !== "new" && editing.archived_at) && <Button className="mt-6 w-full" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar cliente"}</Button>}
      </form>
    </Dialog>
    <Dialog open={!!archiving} onOpenChange={open => { if (!open && !pending) setArchiving(null); }} title={archiving?.archived_at ? "Reativar cliente?" : "Arquivar cliente?"} description={`${archiving?.name ?? ""} · O histórico será preservado.`}><p className="muted text-sm">{archiving?.archived_at ? "O cliente voltará à lista de ativos." : "O cliente sairá da lista de ativos. Você poderá reativá-lo depois."}</p>{error && <p role="alert" className="mt-4 text-rose-400 text-sm">{error}</p>}<Button className="mt-6 w-full" onClick={archive} disabled={pending}>{pending ? "Atualizando…" : archiving?.archived_at ? "Confirmar reativação" : "Confirmar arquivamento"}</Button></Dialog>
  </>;
}

function firstLine(value: string | null | undefined) {
  return value?.trim().split(String.fromCharCode(10))[0]?.trim() ?? "";
}
