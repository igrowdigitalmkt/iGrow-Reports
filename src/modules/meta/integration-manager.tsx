"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, CircleAlert, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { syncMetaAccounts } from "./actions";
import { FacebookLogin } from "./facebook-login";
import type { MetaAdminSnapshot } from "./types";

// Meta connection per client: list of clients with their state, details of the chosen one.
export function MetaIntegrationManager({
  agencyId,
  clients,
  initialClientId,
  snapshot,
  canManage,
  demo = false,
}: {
  demo?: boolean;
  agencyId: string;
  clients: ClientItem[];
  initialClientId?: string;
  snapshot: MetaAdminSnapshot;
  canManage: boolean;
}) {
  const router = useRouter();
  const activeClients = useMemo(() => clients.filter((client) => !client.archived_at), [clients]);
  const [clientId, setClientId] = useState(
    activeClients.some((client) => client.id === initialClientId) ? initialClientId! : activeClients[0]?.id ?? "",
  );
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const accountsOf = (id: string) => {
    const connection = snapshot.connections.find((item) => item.clientId === id);
    return connection ? snapshot.accounts.filter((account) => account.connectionId === connection.id && !account.archivedAt) : [];
  };
  const selectedClient = activeClients.find((client) => client.id === clientId);
  const connection = snapshot.connections.find((item) => item.clientId === clientId);
  const accounts = accountsOf(clientId);
  const connected = !!connection;
  const healthy = connected && accounts.length > 0;
  const loginReady = !!snapshot.serverReadiness.oauthReady && !!snapshot.serverReadiness.apiVersion;
  const visibleClients = activeClients.filter((client) => !query || client.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const connectedCount = activeClients.filter((client) => snapshot.connections.some((item) => item.clientId === client.id)).length;

  const readiness = [
    ["Banco de dados", snapshot.serverReadiness.databaseReady],
    ["Acesso do servidor", snapshot.serverReadiness.serviceRoleConfigured],
    ["Criptografia dos tokens", snapshot.serverReadiness.encryptionConfigured],
    [`Graph API ${snapshot.serverReadiness.apiVersion ?? "não configurada"}`, !!snapshot.serverReadiness.apiVersion],
  ] as const;
  const allReady = readiness.every(([, ready]) => ready);

  function select(id: string) {
    setClientId(id);
    setError("");
    setNotice("");
  }

  function sync() {
    if (!clientId) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await syncMetaAccounts({ agencyId, clientId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNotice(`${result.accountCount ?? 0} ${result.accountCount === 1 ? "conta sincronizada" : "contas sincronizadas"}.`);
      router.refresh();
    });
  }

  return (
    <section className="panel meta-manager">
      {!allReady && (
        <div className="meta-alert">
          <CircleAlert size={16} />
          <div>
            <strong>A conexão com a Meta ainda não está pronta no servidor</strong>
            <ul>{readiness.filter(([, ready]) => !ready).map(([label]) => <li key={label}>{label}</li>)}</ul>
          </div>
        </div>
      )}

      {!activeClients.length ? (
        <div className="meta-inline-note"><CircleAlert size={15} />Cadastre um cliente antes de conectar a Meta.</div>
      ) : (
        <div className="meta-manager-grid">
          <div className="meta-client-list">
            <div className="meta-client-list-head">
              <span>Clientes</span>
              <small>{connectedCount} de {activeClients.length} conectados</small>
            </div>
            {activeClients.length > 6 && (
              <label className="meta-client-search">
                <Search size={14} />
                <input className="input" placeholder="Buscar cliente" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar cliente" />
              </label>
            )}
            <ul>
              {visibleClients.map((client) => {
                const count = accountsOf(client.id).length;
                const has = snapshot.connections.some((item) => item.clientId === client.id);
                return (
                  <li key={client.id}>
                    <button type="button" className={client.id === clientId ? "is-selected" : undefined} onClick={() => select(client.id)} aria-pressed={client.id === clientId}>
                      <span className={`meta-dot ${has ? (count ? "is-on" : "is-warn") : ""}`} aria-hidden="true" />
                      <span className="meta-client-name">
                        <strong>{client.name}</strong>
                        <small>{has ? (count ? `${count} ${count === 1 ? "conta" : "contas"}` : "Sem contas") : "Não conectado"}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  </li>
                );
              })}
              {!visibleClients.length && <li className="meta-client-empty">Nenhum cliente com esse nome.</li>}
            </ul>
          </div>

          {selectedClient && (
            <div className="meta-client-detail">
              <header>
                <div>
                  <h3>{selectedClient.name}</h3>
                  <p>{connected ? `Conectado ${connection.connectedAt ? `em ${formatTimestamp(connection.connectedAt)}` : ""}` : "Ainda sem conexão com a Meta"}</p>
                </div>
                <span className={healthy ? "badge green" : connected ? "badge amber" : "badge neutral"}>
                  <span className="status-dot" />
                  {healthy ? "Conectado" : connected ? "Sem contas" : "Não conectado"}
                </span>
              </header>

              {connected ? (
                <>
                  <dl className="meta-facts">
                    <div><dt>Contas</dt><dd>{accounts.length}</dd></div>
                    <div><dt>Última sincronização</dt><dd>{connection.lastAccountsSyncAt ? formatShort(connection.lastAccountsSyncAt) : "ainda não"}</dd></div>
                    <div><dt>Permissões</dt><dd>{connection.scopes.length}</dd></div>
                  </dl>

                  <div className="meta-accounts">
                    <h4>Contas de anúncio</h4>
                    {accounts.length ? (
                      <ul>
                        {accounts.map((account) => (
                          <li key={account.id}>
                            <span className="meta-dot is-on" aria-hidden="true" />
                            <span className="meta-account-name"><strong>{account.name}</strong><small>ID {account.externalId.replace(/^act_/, "")} · {account.currency}</small></span>
                            <small className="meta-account-sync">{account.lastSyncedAt ? `dados de ${formatShort(account.lastSyncedAt)}` : "sem dados ainda"}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="meta-empty">Nenhuma conta selecionada. Use “Adicionar ou trocar contas” para escolher.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="meta-empty-state">
                  <p>Entre com o Facebook de quem administra os anúncios deste cliente e escolha as contas que o iGrow vai ler. Você pode conectar uma ou várias contas do mesmo Portfólio Empresarial.</p>
                </div>
              )}

              {demo ? (
                <div className="meta-inline-note"><ShieldCheck size={15} />Na demonstração as conexões não podem ser alteradas.</div>
              ) : canManage ? (
                <div className="meta-actions">
                  {loginReady ? (
                    <FacebookLogin key={clientId} agencyId={agencyId} clientId={clientId} apiVersion={snapshot.serverReadiness.apiVersion!} compact
                      label={connected ? "Adicionar ou trocar contas" : "Conectar com a Meta"} variant={connected ? "secondary" : "default"} />
                  ) : (
                    <p className="meta-inline-note">O login com a Meta aguarda a configuração do iGrow. As conexões existentes continuam funcionando.</p>
                  )}
                  {connected && (
                    <Button type="button" onClick={sync} disabled={pending || !snapshot.serverReadiness.ready}>
                      <RefreshCw size={15} className={pending ? "spin" : undefined} />
                      {pending ? "Sincronizando…" : "Sincronizar contas"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="meta-inline-note"><ShieldCheck size={15} />Somente proprietário ou administrador gerencia as conexões da Meta.</div>
              )}

              {error && <p role="alert" className="meta-feedback error">{error}</p>}
              {notice && <p role="status" className="meta-feedback success">{notice}</p>}

              {connected && connection.scopes.length > 0 && (
                <details className="meta-tech">
                  <summary>Permissões concedidas ({connection.scopes.length})</summary>
                  <div className="meta-permission-list">{connection.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {allReady && (
        <p className="meta-secure"><CheckCircle2 size={14} />Login oficial do Facebook · tokens criptografados no servidor · Graph API {snapshot.serverReadiness.apiVersion}</p>
      )}
    </section>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "ainda não";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

// "06/10, 06:00" in the current year, with the year otherwise.
function formatShort(value: string) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", ...(sameYear ? {} : { year: "2-digit" }), hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}
