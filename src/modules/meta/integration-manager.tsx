"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { BookOpen, CheckCircle2, CircleAlert, ExternalLink, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { connectMetaIntegration, syncMetaAccounts } from "./actions";
import type { MetaAdminSnapshot } from "./types";

export function MetaIntegrationManager({
  agencyId, clients, snapshot, canManage,
}: {
  agencyId: string;
  clients: ClientItem[];
  snapshot: MetaAdminSnapshot;
  canManage: boolean;
}) {
  const activeClients = useMemo(() => clients.filter((client) => !client.archived_at), [clients]);
  const [clientId, setClientId] = useState(activeClients[0]?.id ?? "");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedClient = activeClients.find((client) => client.id === clientId);
  const connection = snapshot.connections.find((item) => item.clientId === clientId);
  const accounts = connection
    ? snapshot.accounts.filter((account) => account.connectionId === connection.id && !account.archivedAt)
    : [];
  const connected = !!connection;

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await connectMetaIntegration({ agencyId, clientId, accessToken: token });
      if ("error" in result) { setError(result.error); return; }
      setToken("");
      setNotice(`Conexão de ${selectedClient?.name ?? "cliente"} validada. ${result.accountCount ?? 0} conta(s) sincronizada(s).`);
    });
  }

  function sync() {
    if (!clientId) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await syncMetaAccounts({ agencyId, clientId });
      if ("error" in result) { setError(result.error); return; }
      setNotice(`${result.accountCount ?? 0} conta(s) Meta sincronizada(s) para este cliente.`);
    });
  }

  const readiness = [
    ["Fundação Meta no banco", snapshot.serverReadiness.databaseReady],
    ["Acesso privilegiado ao banco", snapshot.serverReadiness.serviceRoleConfigured],
    ["Criptografia AES-256-GCM", snapshot.serverReadiness.encryptionConfigured],
    [`Graph API ${snapshot.serverReadiness.apiVersion ?? "não configurada"}`, !!snapshot.serverReadiness.apiVersion],
  ] as const;

  return (
    <section className="panel integration-card meta-operational-card">
      <div className="flex items-start justify-between gap-4">
        <span className="provider-large blue">∞</span>
        <span className={connected ? "badge green" : "badge neutral"}>
          {connected ? "Cliente conectado" : "Cliente não conectado"}
        </span>
      </div>
      <h2>Meta Ads por cliente</h2>
      <span className="eyebrow text-[11px]">MARKETING API · PORTFÓLIO EMPRESARIAL OBRIGATÓRIO</span>
      <p>Cada cliente possui sua própria conexão Meta. Uma conexão pode importar uma ou várias contas de anúncios do Portfólio Empresarial desse cliente.</p>

      <div className="meta-readiness">
        {readiness.map(([label, ready]) => <div key={label}>
          {ready ? <CheckCircle2 size={15} className="text-emerald-500" /> : <CircleAlert size={15} className="text-amber-400" />}
          <span>{label}</span>
        </div>)}
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-5">
        <label className="text-sm font-medium" htmlFor="meta-client">Cliente</label>
        <select
          id="meta-client"
          className="input mt-2"
          value={clientId}
          onChange={(event) => { setClientId(event.target.value); setError(""); setNotice(""); setToken(""); }}
        >
          {!activeClients.length && <option value="">Cadastre um cliente primeiro</option>}
          {activeClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </div>

      {selectedClient && connected && (
        <>
          <div className="meta-connection-summary mt-4">
            <div><span>Cliente</span><strong>{selectedClient.name}</strong></div>
            <div><span>Contas encontradas</span><strong>{accounts.length}</strong></div>
            <div><span>Última sincronização</span><strong>{formatTimestamp(connection.lastAccountsSyncAt)}</strong></div>
          </div>
          <div className="planned-note mt-3"><ShieldCheck size={15} />Permissões: {connection.scopes.length ? connection.scopes.join(", ") : "não informadas"}</div>
          {accounts.length > 0 && <div className="mt-3 text-xs muted">{accounts.map((account) => account.name).join(" · ")}</div>}
        </>
      )}

      {canManage && selectedClient ? (
        <form onSubmit={connect} className="mt-5 border-t border-[var(--border)] pt-5">
          <label className="text-sm font-medium" htmlFor="meta-access-token">
            {connected ? `Atualizar conexão de ${selectedClient.name}` : `Conectar Meta de ${selectedClient.name}`}
          </label>
          <p className="muted mt-1 text-xs leading-5">
            O token deve pertencer ao Portfólio Empresarial deste cliente e possuir <strong>ads_read</strong>.
            Contas de anúncios sem Portfólio Empresarial não são aceitas na V1.
          </p>

          <details className="meta-token-guide mt-4">
            <summary><span><BookOpen size={15} />Como obter o token deste cliente</span><span className="muted text-xs">passo a passo</span></summary>
            <div className="meta-token-guide-body">
              <ol>
                <li><strong>Abra o Portfólio Empresarial do cliente.</strong><span>Confirme que você está no portfólio do cliente selecionado acima. Se a conta de anúncios ainda não pertence a um Portfólio Empresarial, organize-a na Meta antes de continuar.</span></li>
                <li><strong>Acesse Usuários → Usuários do sistema.</strong><span>Crie ou selecione um usuário do sistema exclusivo para integrações.</span></li>
                <li><strong>Atribua as contas de anúncios do cliente.</strong><span>Selecione somente os ativos que pertencem a este cliente e conceda acesso de leitura de desempenho.</span></li>
                <li><strong>Gere o token.</strong><span>Escolha o aplicativo da integração e marque obrigatoriamente <code>ads_read</code>.</span></li>
                <li><strong>Copie e cole diretamente no iGrow.</strong><span>Não envie o token por WhatsApp, e-mail ou chat. O iGrow o armazena criptografado e não o exibe novamente.</span></li>
              </ol>
              <div className="meta-token-guide-links">
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">Abrir Usuários do sistema <ExternalLink size={13} /></a>
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Abrir apps da Meta <ExternalLink size={13} /></a>
              </div>
              <div className="planned-note mt-3"><CircleAlert size={15} />O iGrow não aceita, nesta versão, contas avulsas sem Portfólio Empresarial.</div>
            </div>
          </details>

          <input id="meta-access-token" type="password" className="input mt-3" autoComplete="off" placeholder="Token de acesso Meta deste cliente" value={token} onChange={(event) => setToken(event.target.value)} disabled={pending || !snapshot.serverReadiness.ready} required minLength={20} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !snapshot.serverReadiness.ready || token.trim().length < 20}>
              <KeyRound size={15} />{pending ? "Validando…" : connected ? "Atualizar credencial" : "Validar e conectar"}
            </Button>
            {connected && <Button type="button" variant="secondary" onClick={sync} disabled={pending || !snapshot.serverReadiness.ready}><RefreshCw size={15} />Sincronizar contas</Button>}
          </div>
        </form>
      ) : !selectedClient ? (
        <div className="planned-note mt-5"><CircleAlert size={15} />Cadastre um cliente antes de criar uma conexão Meta.</div>
      ) : (
        <div className="planned-note mt-5"><ShieldCheck size={15} />Somente proprietário ou administrador pode gerenciar credenciais Meta.</div>
      )}

      {!snapshot.serverReadiness.ready && <div className="planned-note mt-4"><ShieldCheck size={15} />Complete as variáveis de servidor antes de inserir uma credencial.</div>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-500">{notice}</p>}
    </section>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "Ainda não";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
