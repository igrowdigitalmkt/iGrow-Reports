"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { connectMetaIntegration, syncMetaAccounts } from "./actions";
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
  const [token, setToken] = useState("");
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

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await connectMetaIntegration({
        agencyId,
        clientId,
        accessToken: token,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setToken("");
      setNotice(
        `Conexão de ${selectedClient?.name ?? "cliente"} validada. ${result.accountCount ?? 0} conta(s) sincronizada(s).`,
      );
    });
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
            MARKETING API · PORTFÓLIO EMPRESARIAL OBRIGATÓRIO
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
            setToken("");
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
        <form onSubmit={connect} className="meta-credential-section">
          <div className="meta-section-heading">
            <strong>
              {connected
                ? `Credencial de ${selectedClient.name}`
                : `Conectar Meta de ${selectedClient.name}`}
            </strong>
            <span>
              O token deve pertencer ao Portfólio Empresarial deste cliente e possuir
              {" "}<strong>ads_read</strong>. Contas sem Portfólio Empresarial não são
              aceitas na V1.
            </span>
          </div>

          <details className="meta-token-guide">
            <summary>
              <span>
                <BookOpen size={15} />
                Como obter o token deste cliente
              </span>
              <span className="muted text-xs">passo a passo</span>
            </summary>
            <div className="meta-token-guide-body">
              <ol>
                <li>
                  <strong>Abra o Portfólio Empresarial do cliente.</strong>
                  <span>
                    Confirme que você está no portfólio do cliente selecionado acima.
                    Se a conta de anúncios ainda não pertence a um Portfólio Empresarial,
                    organize-a na Meta antes de continuar.
                  </span>
                </li>
                <li>
                  <strong>Acesse Usuários → Usuários do sistema.</strong>
                  <span>
                    Crie ou selecione um usuário do sistema exclusivo para integrações.
                  </span>
                </li>
                <li>
                  <strong>Atribua as contas de anúncios do cliente.</strong>
                  <span>
                    Selecione somente os ativos que pertencem a este cliente e conceda
                    acesso de leitura de desempenho.
                  </span>
                </li>
                <li>
                  <strong>Gere o token.</strong>
                  <span>
                    Escolha o aplicativo da integração e marque obrigatoriamente{" "}
                    <code>ads_read</code>.
                  </span>
                </li>
                <li>
                  <strong>Copie e cole diretamente no iGrow.</strong>
                  <span>
                    Não envie o token por WhatsApp, e-mail ou chat. O iGrow o armazena
                    criptografado e não o exibe novamente.
                  </span>
                </li>
              </ol>
              <div className="meta-token-guide-links">
                <a
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir Usuários do sistema <ExternalLink size={13} />
                </a>
                <a
                  href="https://developers.facebook.com/apps/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir apps da Meta <ExternalLink size={13} />
                </a>
              </div>
              <div className="meta-guide-warning">
                <CircleAlert size={15} />
                O iGrow não aceita, nesta versão, contas avulsas sem Portfólio
                Empresarial.
              </div>
            </div>
          </details>

          <div className="meta-credential-row">
            <input
              id="meta-access-token"
              type="password"
              className="input"
              autoComplete="off"
              placeholder={
                connected
                  ? "Cole um novo token somente para atualizar a credencial"
                  : "Token de acesso Meta deste cliente"
              }
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending || !snapshot.serverReadiness.ready}
              required
              minLength={20}
            />
            <Button
              type="submit"
              disabled={
                pending ||
                !snapshot.serverReadiness.ready ||
                token.trim().length < 20
              }
            >
              <KeyRound size={15} />
              {pending
                ? "Validando…"
                : connected
                  ? "Atualizar credencial"
                  : "Validar e conectar"}
            </Button>
            {connected && (
              <Button
                type="button"
                variant="secondary"
                onClick={sync}
                disabled={pending || !snapshot.serverReadiness.ready}
              >
                <RefreshCw size={15} />
                Sincronizar contas
              </Button>
            )}
          </div>
        </form>
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
          Complete as variáveis de servidor antes de inserir uma credencial.
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
