"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import { linkGoogleAccountAction, saveGoogleLoginCustomer, syncGoogleAdsAccountsAction, type GoogleAdsStatus } from "./actions";

// Painel do Google Ads em Integrações: conectar, informar o gerente (MCC), buscar as contas e vincular cada conta a um cliente.
export function GoogleAdsPanel({ status, clients, onChanged, callbackMessage }: { status: GoogleAdsStatus; clients: ClientItem[]; onChanged: () => void; callbackMessage?: string }) {
  const [customer, setCustomer] = useState(status.loginCustomerId ?? "");
  const [message, setMessage] = useState(callbackMessage ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ error?: string; success?: true } & Record<string, unknown>>, done: string) {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await task();
        if (result.error) { setError(result.error); return; }
        setMessage(done); onChanged();
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }

  if (!status.configured) return <div className="grid gap-3">
    <p>O Google Ads ainda não está configurado neste ambiente. Faltam as credenciais do aplicativo no servidor:</p>
    <ul style={{ paddingLeft: 18 }}>{status.missing.map(name => <li key={name}><code>{name}</code></li>)}</ul>
    <p className="muted text-sm">Elas vêm de um aplicativo OAuth no Google Cloud, que também precisa do acesso básico à API Google Ads. {status.redirectUri ? <>Endereço de retorno a cadastrar no Google Cloud: <code>{status.redirectUri}</code></> : "Defina também NEXT_PUBLIC_APP_URL."}</p>
  </div>;

  return <div className="grid gap-4">
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-rose-400 text-sm">{error}</p>}

    {!status.connected ? <div className="grid gap-2">
      <p>Conecte a conta do Google que administra os anúncios dos seus clientes (normalmente a conta de gerente, ou MCC).</p>
      {status.canManage ? <a className="button button-primary" href="/api/google/oauth/start">Conectar com o Google</a> : <p className="muted text-sm">Apenas proprietários e administradores conectam o Google Ads.</p>}
    </div> : <>
      <div className="grid gap-2">
        <label className="grid gap-1 text-sm">Número da conta de gerente (MCC) — opcional
          <div className="flex gap-2">
            <input className="input" value={customer} onChange={event => setCustomer(event.target.value)} placeholder="123-456-7890" disabled={!status.canManage || pending} inputMode="numeric" />
            <Button variant="secondary" disabled={!status.canManage || pending} onClick={() => run(() => saveGoogleLoginCustomer({ customerId: customer }), "Gerente salvo.")}>Salvar</Button>
          </div>
        </label>
        <div className="flex gap-2" style={{ alignItems: "center" }}>
          <Button disabled={!status.canManage || pending} onClick={() => run(syncGoogleAdsAccountsAction, "Contas atualizadas.")}>
            {pending ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}Buscar contas
          </Button>
          <span className="muted text-sm">{status.lastSyncAt ? `Última busca em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(status.lastSyncAt))}` : "Nenhuma busca ainda."}</span>
        </div>
        {status.canManage && <a className="text-sm" href="/api/google/oauth/start">Reconectar com o Google</a>}
      </div>

      <div className="grid gap-2">
        <h3 style={{ margin: 0 }}>Contas de anúncios</h3>
        {status.accounts.length === 0 ? <p className="muted text-sm">Nenhuma conta ainda. Clique em “Buscar contas”. Entram as contas ligadas ao gerente (se informado) e as que você acessa diretamente.</p> : status.accounts.map(account => <article key={account.id} className="panel" style={{ padding: 12 }}>
          <strong>{account.name}</strong> <span className="muted text-sm">{account.customerId} · {account.currency}</span>
          <div className="grid gap-1" style={{ marginTop: 8 }}>
            <span className="muted text-sm">Clientes que usam esta conta</span>
            {clients.map(client => <label key={client.id} className="flex gap-2 text-sm" style={{ alignItems: "center" }}>
              <input type="checkbox" checked={account.clientIds.includes(client.id)} disabled={pending}
                onChange={event => run(() => linkGoogleAccountAction({ accountId: account.id, clientId: client.id, linked: event.target.checked }), "Vínculo atualizado.")} />
              {client.name}
            </label>)}
          </div>
        </article>)}
      </div>
    </>}
  </div>;
}
