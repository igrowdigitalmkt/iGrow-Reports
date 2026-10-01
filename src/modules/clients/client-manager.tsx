"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Archive, ArrowUpRight, DatabaseZap, Plus, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { demoClients } from "@/modules/operations/demo-data";
import { saveClient, setClientArchived } from "./actions";
import { clientInputSchema, type ClientItem, type ClientResult } from "./schema";
import { RecipientManager } from "./recipient-manager";
import { ClientAccessManager } from "@/modules/client-portal/client-access-manager";
import type { ClientPortalAdminAccess } from "@/modules/client-portal/types";
import { ClientMetaManager } from "@/modules/meta/client-meta-manager";
import type { MetaAdminSnapshot } from "@/modules/meta/types";

const samples: ClientItem[] = demoClients.map((client, index) => ({ id: `demo-${index}`, name: client.name, notes: client.segment, archived_at: null, updated_at: "2026-09-30T12:00:00Z" }));

export function ClientManager({ demo, initialClients = [], agencyId, canEdit = false, canManageClientAccess = false, clientPortalAdminReady = false, portalAccesses = [], metaSnapshot = { accounts: [], links: [], mappings: [], integration: null, serverReadiness: { databaseReady: false, serviceRoleConfigured: false, encryptionConfigured: false, apiVersion: null, ready: false } }, search }: { demo: boolean; initialClients?: ClientItem[]; agencyId?: string; canEdit?: boolean; canManageClientAccess?: boolean; clientPortalAdminReady?: boolean; portalAccesses?: ClientPortalAdminAccess[]; metaSnapshot?: MetaAdminSnapshot; search: string }) {
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
    <Dialog open={!!accessClient} onOpenChange={open => { if (!open) setAccessClient(null); }} title={`Acesso do cliente · ${accessClient?.name ?? ""}`} description="Gerencie quem pode entrar na Área do Cliente.">{accessClient && agencyId && <ClientAccessManager key={accessClient.id} agencyId={agencyId} clientId={accessClient.id} clientName={accessClient.name} archived={!!accessClient.archived_at} initialAccesses={portalAccesses.filter(access => access.clientId === accessClient.id)} />}</Dialog>
    <Dialog open={!!metaClient} onOpenChange={open => { if (!open) setMetaClient(null); }} title={`Dados Meta · ${metaClient?.name ?? ""}`} description="Associe contas e configure o resultado principal.">{metaClient && agencyId && <ClientMetaManager key={metaClient.id} agencyId={agencyId} clientId={metaClient.id} clientName={metaClient.name} archived={!!metaClient.archived_at} ready={metaSnapshot.serverReadiness.databaseReady} accounts={metaSnapshot.accounts} initialLinks={metaSnapshot.links.filter(link => link.clientId === metaClient.id)} initialMapping={metaSnapshot.mappings.find(mapping => mapping.clientId === metaClient.id) ?? null} integration={metaSnapshot.integration} />}</Dialog>
    <div className="section-toolbar"><label className="muted flex items-center gap-3 text-sm">Exibir<select className="input compact-select" aria-label="Estado dos clientes" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select><span>{filtered.length} cliente(s)</span></label>{allowed && <Button onClick={() => { setError(""); setEditing("new"); }}><Plus size={16} />Novo cliente</Button>}</div>
    {demo && <p className="info-banner">Teste o cadastro com dados fictícios. As alterações são temporárias e desaparecem ao sair ou recarregar esta página.</p>}
    {!allowed && <p className="info-banner">Seu perfil é Leitor: você pode consultar os clientes, mas não alterar seus dados.</p>}
    {notice && <p role="status" className="info-banner">{notice}</p>}
    <div className="client-grid">{filtered.map(client => <section className="panel client-card" key={client.id}><div className="flex items-center justify-between"><span className="client-avatar large violet">{client.name.split(" ").slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span className="badge neutral">{client.archived_at ? "Arquivado" : demo ? "Fictício" : "Ativo"}</span></div><h2>{client.name}</h2><p className="muted text-sm mt-3 whitespace-pre-wrap break-words line-clamp-3">{client.notes || "Sem observações."}</p><div className="client-details"><span className="muted text-xs">{metaSnapshot.serverReadiness.databaseReady ? "Configure as contas Meta e o resultado principal deste cliente." : "Fundação Meta preparada; aguardando habilitação no banco de produção."}</span></div><div className="flex gap-4 flex-wrap"><button className="text-link" onClick={() => setRecipientClient(client)}>Destinatários</button>{canManageClientAccess && clientPortalAdminReady && !demo && <button className="text-link" onClick={() => setAccessClient(client)}><ShieldCheck size={14} />Acesso do cliente</button>}{canEdit && !demo && <button className="text-link" onClick={() => setMetaClient(client)}><DatabaseZap size={14} />Dados Meta</button>}<button className="text-link" onClick={() => { setError(""); setEditing(client); }}>{allowed && !client.archived_at ? "Editar cliente" : "Ver detalhes"}<ArrowUpRight size={14} /></button>{allowed && <button className="text-link" onClick={() => { setError(""); setArchiving(client); }}>{client.archived_at ? <RotateCcw size={14} /> : <Archive size={14} />}{client.archived_at ? "Reativar" : "Arquivar"}</button>}</div></section>)}</div>
    {!filtered.length && <section className="panel empty-state"><Users size={28} /><h3>Nenhum cliente encontrado</h3><p>{search ? "Ajuste sua busca ou o filtro de estado." : "Cadastre seu primeiro cliente ou consulte os arquivados."}</p></section>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !pending) setEditing(null); }} title={editing === "new" ? "Novo cliente" : "Dados do cliente"} description={demo ? "Demonstração temporária, sem persistência no banco." : "Dados pertencentes à agência selecionada."}>
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
