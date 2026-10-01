"use client";

import { useState, useTransition, type FormEvent } from "react";
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
import { connectMetaIntegration, syncMetaAccounts } from "./actions";
import type { MetaAdminSnapshot } from "./types";

export function MetaIntegrationManager({
  agencyId,
  snapshot,
  canManage,
}: {
  agencyId: string;
  snapshot: MetaAdminSnapshot;
  canManage: boolean;
}) {
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const connected = snapshot.integration?.connectionStatus === "connected";

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await connectMetaIntegration({
        agencyId,
        accessToken: token,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setToken("");
      setNotice(
        "Credencial validada. " +
          String(result.accountCount ?? 0) +
          " conta(s) de anúncios sincronizada(s).",
      );
    });
  }

  function sync() {
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await syncMetaAccounts({ agencyId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setNotice(
        String(result.accountCount ?? 0) + " conta(s) Meta sincronizada(s).",
      );
    });
  }

  const readiness = [
    {
      label: "Fundação Meta no banco",
      ready: snapshot.serverReadiness.databaseReady,
    },
    {
      label: "Acesso privilegiado ao banco",
      ready: snapshot.serverReadiness.serviceRoleConfigured,
    },
    {
      label: "Criptografia AES-256-GCM",
      ready: snapshot.serverReadiness.encryptionConfigured,
    },
    {
      label:
        "Graph API " +
        (snapshot.serverReadiness.apiVersion ?? "não configurada"),
      ready: !!snapshot.serverReadiness.apiVersion,
    },
  ];

  return (
    <section className="panel integration-card meta-operational-card">
      <div className="flex items-start justify-between gap-4">
        <span className="provider-large blue">∞</span>
        <span className={connected ? "badge green" : "badge neutral"}>
          {connected ? "Conectada" : "Não conectada"}
        </span>
      </div>
      <h2>Meta Ads</h2>
      <span className="eyebrow text-[11px]">MARKETING API</span>
      <p>
        Conexão somente leitura para sincronizar contas de anúncios e coletar
        dados de desempenho.
      </p>

      <div className="meta-readiness">
        {readiness.map((item) => (
          <div key={item.label}>
            {item.ready ? (
              <CheckCircle2 size={15} className="text-emerald-500" />
            ) : (
              <CircleAlert size={15} className="text-amber-400" />
            )}
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {connected && (
        <>
        <div className="meta-connection-summary">
          <div>
            <span>Saúde</span>
            <strong>{healthLabel(snapshot.integration?.healthStatus)}</strong>
          </div>
          <div>
            <span>Contas sincronizadas</span>
            <strong>
              {snapshot.accounts.filter((account) => !account.archivedAt).length}
            </strong>
          </div>
          <div>
            <span>Último sucesso</span>
            <strong>
              {formatTimestamp(snapshot.integration?.lastSuccessAt ?? null)}
            </strong>
          </div>
        </div>
        <div className="planned-note mt-3">
          <ShieldCheck size={15} />
          Permissões concedidas: {snapshot.integration?.scopes.length
            ? snapshot.integration.scopes.join(", ")
            : "não informadas"}
        </div>
        </>
      )}

      {canManage ? (
        <>
          <form
            onSubmit={connect}
            className="mt-5 border-t border-[var(--border)] pt-5"
          >
            <label className="text-sm font-medium" htmlFor="meta-access-token">
              {connected ? "Substituir credencial" : "Conectar credencial"}
            </label>
            <p className="muted mt-1 text-xs leading-5">
              O token é validado na Meta e armazenado criptografado. Ele não é
              exibido novamente. A permissão <strong>ads_read</strong> é obrigatória.
              Para produção, prefira um token de <strong>System User</strong> vinculado
              aos ativos da empresa, em vez de um token curto de usuário.
            </p>

            <details className="meta-token-guide mt-4">
              <summary>
                <span><BookOpen size={15} />Como obter o token da Meta</span>
                <span className="muted text-xs">passo a passo</span>
              </summary>
              <div className="meta-token-guide-body">
                <ol>
                  <li>
                    <strong>Abra as Configurações do negócio da Meta.</strong>
                    <span>Entre no portfólio empresarial que possui as contas de anúncios que você quer trazer para o iGrow.</span>
                  </li>
                  <li>
                    <strong>Acesse Usuários → Usuários do sistema.</strong>
                    <span>Crie um usuário do sistema chamado, por exemplo, <em>iGrow Reports</em>. Se já existir um usuário exclusivo para integrações, você pode reutilizá-lo.</span>
                  </li>
                  <li>
                    <strong>Atribua os ativos.</strong>
                    <span>Adicione ao usuário do sistema somente as contas de anúncios necessárias e dê acesso suficiente para visualizar desempenho. Evite conceder permissões além do necessário.</span>
                  </li>
                  <li>
                    <strong>Gere um token para o app da integração.</strong>
                    <span>No usuário do sistema, escolha <em>Gerar novo token</em>, selecione o aplicativo conectado ao seu negócio e marque obrigatoriamente <code>ads_read</code>.</span>
                  </li>
                  <li>
                    <strong>Copie o token uma única vez.</strong>
                    <span>A Meta pode não exibi-lo novamente. Não envie esse token por WhatsApp, e-mail ou chat.</span>
                  </li>
                  <li>
                    <strong>Cole o token abaixo.</strong>
                    <span>O iGrow valida a credencial na Meta e a armazena criptografada. Depois da conexão, o token deixa de ser exibido.</span>
                  </li>
                </ol>

                <div className="meta-token-guide-links">
                  <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">
                    Abrir Usuários do sistema <ExternalLink size={13} />
                  </a>
                  <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
                    Abrir apps da Meta <ExternalLink size={13} />
                  </a>
                </div>

                <div className="planned-note mt-3">
                  <CircleAlert size={15} />
                  Se “Gerar novo token” não aparecer, normalmente falta um aplicativo Meta vinculado ao portfólio empresarial ou permissão administrativa para gerenciar usuários do sistema.
                </div>
              </div>
            </details>

            <input
              id="meta-access-token"
              type="password"
              className="input mt-3"
              autoComplete="off"
              placeholder="Token de acesso Meta"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending || !snapshot.serverReadiness.ready}
              required
              minLength={20}
            />
            <div className="mt-3 flex flex-wrap gap-2">
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
          {!snapshot.serverReadiness.ready && (
            <div className="planned-note mt-4">
              <ShieldCheck size={15} />
              Complete as variáveis de servidor antes de inserir uma credencial.
            </div>
          )}
        </>
      ) : (
        <div className="planned-note mt-5">
          <ShieldCheck size={15} />
          Somente proprietário ou administrador pode gerenciar a credencial.
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-sm text-emerald-500">
          {notice}
        </p>
      )}
    </section>
  );
}

function healthLabel(value: string | undefined) {
  if (value === "healthy") return "Saudável";
  if (value === "degraded") return "Atenção";
  if (value === "error") return "Erro";
  return "Não verificada";
}

function formatTimestamp(value: string | null) {
  if (!value) return "Ainda não";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
