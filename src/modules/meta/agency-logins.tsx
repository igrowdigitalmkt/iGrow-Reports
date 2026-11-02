"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectedCard, DisconnectButton } from "@/components/ui/connected-card";
import { connectMetaAgencyLoginAction, disconnectMetaAgencyLoginAction, linkClientAccountsAction, listAgencyLoginAccountsAction } from "./actions";
import { META_LOGIN_APP_ID, META_LOGIN_CONFIG_ID } from "./login-config";
import { loadFacebookSdk, selectFacebookApp, type FacebookSdk } from "./facebook-sdk";
import type { AgencyLoginAccount } from "./server";
import type { MetaAgencyLogin } from "./types";

/** Conta empresarial = um login do Facebook que enxerga os portfólios. Vale para todos os clientes; cada cliente só escolhe os ativos dele. */
export function AgencyLogins({ agencyId, apiVersion, logins, canManage }: { agencyId: string; apiVersion: string; logins: MetaAgencyLogin[]; canManage: boolean }) {
  const router = useRouter();
  const sdk = useRef<FacebookSdk | null>(null);
  const attempt = useRef(0);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadFacebookSdk(apiVersion).then(value => { if (!cancelled) { sdk.current = value; setReady(true); } }).catch(value => { if (!cancelled) setError(value.message); });
    return () => { cancelled = true; attempt.current = -1; };
  }, [apiVersion]);

  function connect() {
    if (!sdk.current) return;
    setError(""); setNotice(""); setWaiting(true);
    const current = ++attempt.current;
    try {
      selectFacebookApp(sdk.current, META_LOGIN_APP_ID, apiVersion);
      sdk.current.login(response => {
        if (current !== attempt.current) return;
        setWaiting(false);
        const accessToken = response.authResponse?.accessToken;
        if (!accessToken) { setNotice("Autorização não concluída. Você pode tentar novamente."); return; }
        startTransition(async () => {
          const result = await connectMetaAgencyLoginAction({ agencyId, accessToken });
          if ("error" in result) { setError(result.error); return; }
          setNotice(`${result.name ?? "Conta"} conectada: ${result.accountCount ?? 0} conta(s) de anúncio em ${result.portfolioCount ?? 0} portfólio(s) visíveis.`);
          router.refresh();
        });
      }, { config_id: META_LOGIN_CONFIG_ID, response_type: "token", override_default_response_type: true });
    } catch { setWaiting(false); setError("Não foi possível abrir o login da Meta. Atualize a página e tente novamente."); }
  }

  function disconnect(login: MetaAgencyLogin) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await disconnectMetaAgencyLoginAction({ connectionId: login.id });
      if ("error" in result) { setError(result.error); return; }
      setNotice(result.releasedClients ? `Conta desconectada. ${result.releasedClients} cliente(s) precisam escolher as contas de novo em outra conexão.` : "Conta desconectada.");
      router.refresh();
    });
  }

  return <section className="meta-logins" aria-labelledby="meta-logins-title">
    <header>
      <div><h3 id="meta-logins-title"><Building2 size={15} aria-hidden="true" /> Contas empresariais conectadas</h3>
        <p>Conecte o login do Facebook que administra os portfólios empresariais. Cada cliente, abaixo, só escolhe os ativos dele. Dá para conectar mais de uma conta, se houver mais de um portfólio ou login.</p></div>
      {canManage && <Button type="button" variant={logins.length ? "secondary" : "default"} onClick={connect} disabled={!ready || waiting || pending}>
        {waiting || pending ? <><Loader2 size={14} className="spin" aria-hidden="true" />{waiting ? "Aguardando autorização…" : "Conectando…"}</> : <><Plus size={14} aria-hidden="true" />{logins.length ? "Conectar outra conta empresarial" : "Conectar conta empresarial"}</>}
      </Button>}
    </header>
    {logins.length === 0 ? <p className="meta-empty">Nenhuma conta empresarial conectada ainda. Conecte uma para liberar a escolha de contas em cada cliente.</p>
      : <ul className="meta-login-list">{logins.map(login => <li key={login.id}>
        <ConnectedCard title={login.label ?? "Conta do Facebook"} detail={`${login.scopes.length} permissões · usada por ${login.clientCount} cliente(s)`}
          action={canManage ? <DisconnectButton disabled={pending} message={`Desconectar “${login.label ?? "esta conta"}”? O acesso é revogado e ${login.clientCount} cliente(s) que usam esta conta param de coletar dados até escolherem as contas de novo. O histórico é mantido.`} onConfirm={() => disconnect(login)} /> : undefined} />
      </li>)}</ul>}
    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
  </section>;
}

/** Escolha das contas de anúncio de um cliente dentro de uma conta empresarial já conectada. */
export function ClientAccountPicker({ clientId, clientName, logins, currentAccountIds, connected }: { clientId: string; clientName: string; logins: MetaAgencyLogin[]; currentAccountIds: string[]; connected: boolean }) {
  const router = useRouter();
  const [loginId, setLoginId] = useState(logins[0]?.id ?? "");
  const [accounts, setAccounts] = useState<AgencyLoginAccount[] | null>(null);
  const [selected, setSelected] = useState<string[]>(currentAccountIds);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  if (!logins.length) return <p className="meta-inline-note">Conecte uma conta empresarial acima para escolher as contas de {clientName}.</p>;

  const load = () => {
    setError(""); setNotice(""); setLoading(true);
    void listAgencyLoginAccountsAction({ clientId, connectionId: loginId }).then(result => {
      if ("error" in result) { setError(result.error); setAccounts(null); return; }
      setAccounts(result.accounts); setSelected(current => current.filter(id => result.accounts.some(account => account.id === id)));
    }).catch(() => setError("Não foi possível buscar as contas agora. Tente de novo."))
      .finally(() => setLoading(false));
  };
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visible = (accounts ?? []).filter(account => !term || `${account.name} ${account.id} ${account.businessName ?? ""}`.toLocaleLowerCase("pt-BR").includes(term));
  const groups = [...visible.reduce((map, account) => map.set(account.businessName ?? "Sem portfólio", [...(map.get(account.businessName ?? "Sem portfólio") ?? []), account]), new Map<string, AgencyLoginAccount[]>())];
  const selectable = (account: AgencyLoginAccount) => account.supported && !account.takenBy;
  const toggle = (id: string, on: boolean) => setSelected(current => on ? [...new Set([...current, id])] : current.filter(item => item !== id));
  const save = () => {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await linkClientAccountsAction({ clientId, connectionId: loginId, selectedAccountIds: selected });
      if ("error" in result) { setError(result.error); return; }
      setNotice(`${result.accountCount ?? selected.length} conta(s) de ${clientName} conectadas. Abra o cliente para analisar os dados.`);
      setAccounts(null); router.refresh();
    });
  };

  return <div className="meta-picker">
    <div className="meta-picker-bar">
      {logins.length > 1 && <label>Conta empresarial<select className="input" value={loginId} onChange={event => { setLoginId(event.target.value); setAccounts(null); }} disabled={loading || pending}>{logins.map(login => <option key={login.id} value={login.id}>{login.label ?? "Conta do Facebook"}</option>)}</select></label>}
      {accounts === null && <Button type="button" variant={connected ? "secondary" : "default"} onClick={load} disabled={loading || !loginId}>{loading ? <><Loader2 size={14} className="spin" aria-hidden="true" />Buscando contas na Meta…</> : connected ? "Adicionar ou trocar contas" : "Escolher contas deste cliente"}</Button>}
    </div>
    {accounts !== null && <div className="meta-picker-panel">
      <label className="meta-client-search"><Search size={14} aria-hidden="true" /><input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar conta ou portfólio" aria-label="Buscar conta" /></label>
      {accounts.length === 0 ? <p className="meta-empty">Esta conta empresarial não enxerga nenhuma conta de anúncios.</p> : groups.map(([name, list]) => <fieldset key={name} className="meta-picker-group">
        <legend>{name} <small>{list.length} conta(s)</small></legend>
        <button type="button" className="meta-link-button" onClick={() => { const ids = list.filter(selectable).map(account => account.id); const all = ids.every(id => selected.includes(id)); setSelected(current => all ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]); }}>Marcar ou desmarcar todas deste portfólio</button>
        {list.map(account => <label key={account.id} className="meta-account-option"><input type="checkbox" checked={selected.includes(account.id)} disabled={!selectable(account) || pending} onChange={event => toggle(account.id, event.target.checked)} />
          <span>{account.name}<small>{account.id.replace(/^act_/, "")} · {account.currency}{account.takenBy ? ` · já usada por ${account.takenBy}` : ""}{!account.supported ? " · sem portfólio, não suportada" : ""}</small></span></label>)}
      </fieldset>)}
      <div className="meta-picker-actions">
        <Button type="button" variant="secondary" onClick={() => { setAccounts(null); setSearch(""); }} disabled={pending}>Cancelar</Button>
        <Button type="button" onClick={save} disabled={pending || !selected.length}>{pending ? <><Loader2 size={14} className="spin" aria-hidden="true" />Conectando…</> : <><CheckCircle2 size={14} aria-hidden="true" />Conectar {selected.length} conta(s)</>}</Button>
      </div>
    </div>}
    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
  </div>;
}
