"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { connectMetaIntegration, previewMetaLoginAccounts } from "./actions";
import { META_LOGIN_APP_ID, META_LOGIN_CONFIG_ID } from "./login-config";

type FacebookSdk = {
  init(options: { appId: string; version: string; xfbml: boolean }): void;
  login(callback: (response: { authResponse?: { accessToken?: string } }) => void, options: { config_id: string }): void;
};
declare global { interface Window { FB?: FacebookSdk } }
let sdkPromise: Promise<FacebookSdk> | undefined;
function loadSdk(version: string) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const initialize = () => {
      if (!window.FB) { reject(new Error("Não foi possível carregar o login da Meta.")); return; }
      window.FB.init({ appId: META_LOGIN_APP_ID, version, xfbml: false });
      resolve(window.FB);
    };
    if (window.FB) { initialize(); return; }
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.onload = initialize;
    script.onerror = () => { sdkPromise = undefined; reject(new Error("A Meta não carregou. Verifique sua conexão e tente novamente.")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function FacebookLogin({ agencyId, clientId, apiVersion }: { agencyId: string; clientId: string; apiVersion: string }) {
  const router = useRouter();
  const sdk = useRef<FacebookSdk | null>(null);
  const token = useRef<string | null>(null);
  const attempt = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; name: string; supported: boolean }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let cancelled = false;
    loadSdk(apiVersion).then(value => { if (!cancelled) { sdk.current = value; setReady(true); } }).catch(value => { if (!cancelled) setError(value.message); });
    return () => { cancelled = true; token.current = null; attempt.current = -1; };
  }, [apiVersion]);
  function login() {
    if (!sdk.current) return;
    setError(""); setNotice(""); setWaiting(true);
    token.current = null; setAccounts([]); setSelected([]);
    const currentAttempt = ++attempt.current;
    sdk.current.login(response => {
      if (currentAttempt !== attempt.current) return;
      setWaiting(false);
      const accessToken = response.authResponse?.accessToken;
      if (!accessToken) { setNotice("Autorização não concluída. Você pode tentar novamente."); return; }
      token.current = accessToken;
      startTransition(async () => {
        const result = await previewMetaLoginAccounts({ agencyId, clientId, accessToken });
        if (currentAttempt !== attempt.current) return;
        if ("error" in result) { token.current = null; setError(result.error ?? "Não foi possível consultar as contas."); return; }
        setAccounts(result.accounts);
        if (!result.accounts.length) setNotice("A Meta não retornou contas acessíveis para esta autorização.");
      });
    }, { config_id: META_LOGIN_CONFIG_ID });
  }
  return <div className="meta-credential-section">
    <p>Entre pelo Facebook, autorize o iGrow e escolha as contas deste cliente. A autorização solicitará as permissões configuradas para o aplicativo iGrow Digital.</p>
    <Button type="button" onClick={login} disabled={!ready || waiting || pending}>{waiting ? "Aguardando autorização…" : "Conectar com a Meta"}</Button>
    {waiting && <Button type="button" variant="secondary" onClick={() => { attempt.current++; setWaiting(false); }}>Cancelar</Button>}
    {!!accounts.length && <div className="meta-client-section">
      <label>Pesquisar conta<input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome ou identificação" /></label>
      {accounts.filter(account => `${account.name} ${account.id}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))).map(account => <label className="meta-field-label" key={account.id}><input type="checkbox" disabled={!account.supported || pending} checked={selected.includes(account.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} /> {account.name} · {account.id}{!account.supported && " · Conta sem portfólio ainda não suportada pelo coletor"}</label>)}
      <Button disabled={pending || !selected.length} onClick={() => startTransition(async () => {
        if (!token.current) { setError("Autorize novamente para conectar as contas."); return; }
        const result = await connectMetaIntegration({ agencyId, clientId, accessToken: token.current, selectedAccountIds: selected });
        if ("error" in result) { setError(result.error); return; }
        token.current = null; setAccounts([]); setSelected([]); setNotice("Contas selecionadas conectadas. Abra o cliente para analisar os dados."); router.refresh();
      })}>{pending ? "Conectando…" : `Conectar ${selected.length} conta(s)`}</Button>
    </div>}
    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
  </div>;
}
