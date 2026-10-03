"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { syncMetaAccounts } from "./actions";
import { FacebookLogin } from "./facebook-login";
import type { MetaAdminSnapshot } from "./types";

export function MetaIntegrationManager({
  agencyId,
  clients,
  initialClientId,
  snapshot,
  canManage,
}: {
  agencyId: string;
  clients: ClientItem[];
  initialClientId?: string;
  snapshot: MetaAdminSnapshot;
  canManage: boolean;
}) {
  const activeClients = useMemo(
    () => clients.filter((client) => !client.archived_at),
    [clients],
  );
  const [clientId, setClientId] = useState(
    activeClients.some((client) => client.id === initialClientId)
      ? initialClientId!
      : activeClients[0]?.id ?? "",
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedClient = activeClients.find((client) => client.id === clientId);
  const connection = snapshot.connections.find((item) => item.clientId === clientId);
  const accounts = connection
    ? snapshot.accounts.filter(
        (account) => account.connectionId === connection.id && !account.archivedAt,
      )
    : [];
  const connected = !!connection;
  const healthyConnection = connected && accounts.length > 0;

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
      setNotice(
        `${result.accountCount ?? 0} conta(s) Meta sincronizada(s) para este cliente.`,
      );
    });
  }

  const readiness = [
    ["Fundação Meta no banco", snapshot.serverReadiness.databaseReady],
    ["Acesso privilegiado", snapshot.serverReadiness.serviceRoleConfigured],
    ["Criptografia AES-256-GCM", snapshot.serverReadiness.encryptionConfigured],
    [
      `Graph API ${snapshot.serverReadiness.apiVersion ?? "não configurada"}`,
      !!snapshot.serverReadiness.apiVersion,
    ],
  ] as const;

  return (
    <section className="panel integration-card meta-operational-card">
      <div className="meta-card-header">
        <span className="provider-large blue">∞</span>
        <div className="meta-card-title">
          <h2>Meta Ads por cliente</h2>
          <span className="eyebrow text-[11px]">
            LOGIN OFICIAL DO FACEBOOK
          </span>
        </div>
        <span
          className={
            healthyConnection
              ? "badge green"
              : connected
                ? "badge amber"
                : "badge neutral"
          }
        >
          {healthyConnection
            ? "Conectado"
            : connected
              ? "Conectado · sem contas"
              : "Não conectado"}
        </span>
      </div>

      <p className="meta-card-description">
        Cada cliente possui sua própria conexão Meta. Uma conexão pode importar uma ou
        várias contas de anúncios do Portfólio Empresarial desse cliente.
      </p>

      <div className="meta-readiness">
        {readiness.map(([label, ready]) => (
          <div key={label}>
            {ready ? (
              <CheckCircle2 size={15} className="text-emerald-500" />
            ) : (
              <CircleAlert size={15} className="text-amber-400" />
            )}
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="meta-client-section">
        <label className="meta-field-label" htmlFor="meta-client">
          Cliente
        </label>
        <select
          id="meta-client"
          className="input"
          value={clientId}
          onChange={(event) => {
            setClientId(event.target.value);
            setError("");
            setNotice("");
          }}
        >
          {!activeClients.length && (
            <option value="">Cadastre um cliente primeiro</option>
          )}
          {activeClients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      {selectedClient && connected && (
        <div className="meta-connection-block">
          <div className="meta-connection-summary">
            <div>
              <span>Cliente</span>
              <strong>{selectedClient.name}</strong>
            </div>
            <div>
              <span>Contas encontradas</span>
              <strong>{accounts.length}</strong>
            </div>
            <div>
              <span>Última sincronização</span>
              <strong>{formatTimestamp(connection.lastAccountsSyncAt)}</strong>
            </div>
          </div>

          <details className="meta-permissions">
            <summary>
              <span>
                <ShieldCheck size={15} />
                Permissões concedidas
              </span>
              <strong>{connection.scopes.length}</strong>
            </summary>
            <div className="meta-permission-list">
              {connection.scopes.length ? (
                connection.scopes.map((scope) => <span key={scope}>{scope}</span>)
              ) : (
                <span className="muted">Nenhuma permissão informada</span>
              )}
            </div>
          </details>

          {accounts.length > 0 && (
            <div className="meta-account-list">
              <span>Contas sincronizadas</span>
              <div>
                {accounts.map((account) => (
                  <strong key={account.id}>{account.name}</strong>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {canManage && selectedClient ? (
        <>
          {snapshot.serverReadiness.oauthReady && snapshot.serverReadiness.apiVersion ? <FacebookLogin key={clientId} agencyId={agencyId} clientId={clientId} apiVersion={snapshot.serverReadiness.apiVersion} /> : <p className="meta-inline-note">O login oficial com a Meta está aguardando a configuração do iGrow. As conexões existentes continuam disponíveis.</p>}
          {connected && <Button type="button" variant="secondary" onClick={sync} disabled={pending || !snapshot.serverReadiness.ready}><RefreshCw size={15} />Sincronizar contas selecionadas</Button>}
        </>
      ) : !selectedClient ? (
        <div className="meta-inline-note">
          <CircleAlert size={15} />
          Cadastre um cliente antes de criar uma conexão Meta.
        </div>
      ) : (
        <div className="meta-inline-note">
          <ShieldCheck size={15} />
          Somente proprietário ou administrador pode gerenciar credenciais Meta.
        </div>
      )}

      {!snapshot.serverReadiness.ready && (
        <div className="meta-inline-note">
          <ShieldCheck size={15} />
          A conexão oficial aguarda configuração do servidor.
        </div>
      )}
      {error && (
        <p role="alert" className="meta-feedback error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="meta-feedback success">
          {notice}
        </p>
      )}
    </section>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "Ainda não";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
