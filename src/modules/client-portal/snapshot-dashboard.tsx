"use client";

import { useEffect,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock3,Layers3,RefreshCw } from "lucide-react";
import type { SnapshotDashboardData } from "./snapshot-dashboard-loader";
import type { EntityLevel } from "../integrations/data-contract";
import { formatSnapshotDecimal } from "../meta/snapshot-format";
import "./snapshot-dashboard.css";
import { requestMissingSnapshotData } from "./snapshot-dashboard-actions";
import { snapshotEntityPage } from "../meta/snapshot-entity-list";

const levels: { key: EntityLevel; label: string }[] = [
  { key: "account",label: "Conta" },{ key: "campaign",label: "Campanhas" },
  { key: "adset",label: "Conjuntos" },{ key: "ad",label: "Anúncios" },
];
export function SnapshotDashboard({ data,clientId,canCollect = false }: { data: SnapshotDashboardData; clientId: string; canCollect?: boolean }) {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  const [accountId,setAccountId] = useState(data.selectedAccountIds[0] ?? "");
  const [level,setLevel] = useState<EntityLevel>("account");
  const [entityId,setEntityId] = useState("");
  const [entityQuery,setEntityQuery] = useState("");
  const [entityPage,setEntityPage] = useState(1);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const account = data.accounts.find(item => item.id === accountId && data.selectedAccountIds.includes(item.id))
    ?? data.accounts.find(item => data.selectedAccountIds.includes(item.id));
  const scope = data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === level);
  const entityList = snapshotEntityPage(scope?.entities ?? [],entityQuery,entityPage);
  const entity = entityList.items.find(item => item.id === entityId) ?? entityList.items[0];
  const indicators = entity?.indicators.filter(item => item.key !== "result:provider_known") ?? [];
  const campaignNames = new Map(data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === "campaign")?.entities.map(item => [item.id,item.name]) ?? []);
  const adsetNames = new Map(data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === "adset")?.entities.map(item => [item.id,item.name]) ?? []);
  function requestRefresh() {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await requestMissingSnapshotData({ clientId,from: data.dateFrom,to: data.dateTo,accountIds: data.selectedAccountIds,refresh: true });
        if ("error" in result) setError(result.error ?? "Não foi possível solicitar a atualização.");
        else setMessage(result.created ? "Atualização solicitada. Os dados confirmados permanecem disponíveis até a conclusão."
          : "A atualização já está na fila ou em andamento. Aguarde sua conclusão.");
        router.refresh();
      } catch { setError("Não foi possível solicitar a atualização. Tente novamente."); }
    });
  }
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); };
    const timer = window.setInterval(refresh,data.view.status === "pending" ? 30_000 : 60_000);
    document.addEventListener("visibilitychange",refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange",refresh); };
  },[data.view.status,router]);
  return <section className="snapshot-dashboard" aria-label="Análise confirmada" aria-busy={pending}>
    <div className="snapshot-toolbar">
      <Link href={`/cliente/${clientId}`} className="snapshot-link">Voltar ao dashboard</Link>
      {canCollect && !!data.selectedAccountIds.length && <button type="button" onClick={requestRefresh} disabled={pending}>Atualizar dados</button>}
      <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
        <RefreshCw size={16} className={pending ? "snapshot-spin" : ""} />{pending ? "Consultando…" : "Consultar atualização"}
      </button>
    </div>
    <form className="snapshot-filters" method="get">
      <input type="hidden" name="periodo" value="custom" />
      <label>De<input type="date" name="from" defaultValue={data.dateFrom} required /></label>
      <label>Até<input type="date" name="to" defaultValue={data.dateTo} required /></label>
      <label>Contas<select name="accounts" defaultValue={data.selectedAccountIds.length === 1 ? data.selectedAccountIds[0] : ""}>
        <option value="">Todas as contas vinculadas</option>
        {data.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button type="submit">Aplicar período</button>
    </form>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {data.view.status === "pending" ? <div className="snapshot-status" role="status" aria-live="polite">
      <Layers3 size={24} /><h2>{data.blockedReason === "no_accounts" ? "Nenhuma conta vinculada" : "Aguardando a análise completa"}</h2>
      <p>{data.blockedReason === "no_accounts" ? "Vincule uma conta de anúncios a este cliente para acompanhar seu desempenho."
        : data.blockedReason === "spend" || data.blockedReason === "hierarchy" || data.blockedReason === "invalid"
          ? "Os dados deste período ainda precisam ser conciliados. A análise será exibida somente após a confirmação de todas as contas e níveis."
          : "A análise será exibida por inteiro quando todas as contas e níveis deste período estiverem confirmados."}</p>
      {data.blockedReason !== "no_accounts" && <small>A disponibilidade será consultada novamente automaticamente.</small>}
      {canCollect && data.blockedReason === "missing" && <div className="snapshot-request"><button type="button" disabled={pending} onClick={() => {
        setError(""); setMessage("");
        startTransition(async () => {
          try {
            const result = await requestMissingSnapshotData({ clientId,from: data.dateFrom,to: data.dateTo,accountIds: data.selectedAccountIds });
            if ("error" in result) setError(result.error ?? "Não foi possível solicitar os dados.");
            else setMessage(result.created ? "Solicitação registrada. A análise aparecerá após a coleta e a validação."
              : "A coleta deste período já foi solicitada. Aguarde sua conclusão.");
            router.refresh();
          } catch { setError("Não foi possível solicitar os dados. Tente novamente."); }
        });
      }}>{pending ? "Solicitando…" : "Solicitar dados faltantes"}</button></div>}
    </div> : <>
      <div className="snapshot-freshness" role="status"><Clock3 size={15} />
        {data.view.status === "stale" ? "Dados confirmados anteriormente · aguardando atualização" : "Análise confirmada"}
        {data.view.collectedAt && <time dateTime={data.view.collectedAt}>{new Intl.DateTimeFormat("pt-BR",{ dateStyle: "short",timeStyle: "short",timeZone: "America/Sao_Paulo" }).format(new Date(data.view.collectedAt))}</time>}
      </div>
      <div className="snapshot-selectors">
        <label>Conta exibida<select value={account?.id ?? ""} onChange={event => { setAccountId(event.target.value); setEntityId(""); setEntityQuery(""); setEntityPage(1); }}>
          {data.accounts.filter(item => data.selectedAccountIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}
        </select></label>
        <label>Nível<select value={level} onChange={event => { setLevel(event.target.value as EntityLevel); setEntityId(""); setEntityQuery(""); setEntityPage(1); }}>
          {levels.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        {level !== "account" && <label>Buscar entidade<input type="search" value={entityQuery} placeholder="Nome ou ID" onChange={event => { setEntityQuery(event.target.value); setEntityPage(1); setEntityId(""); }} /></label>}
        {level !== "account" && !!entityList.items.length && <label>Entidade da página<select value={entity?.id ?? ""} onChange={event => setEntityId(event.target.value)}>
          {entityList.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
      </div>
      {entity ? <>
        <div className="snapshot-entity-heading"><h2>{level === "account" ? account?.name : entity.name}</h2>
          <p>{entity.currency ?? account?.currency} · {entity.timezone}</p>
        </div>
        <div className="snapshot-cards">{indicators.map(indicator => <article key={indicator.key} className="snapshot-card">
          <h3>{indicator.label}</h3>
          <strong title={indicator.value ?? undefined} className={indicator.value === null ? "snapshot-unavailable" : ""}>
            {formatSnapshotDecimal(indicator.value,indicator.unit,entity.currency ?? account?.currency ?? null)}
          </strong>
          {indicator.state === "unavailable" && <small>Indicador não disponível neste escopo confirmado.</small>}
          {indicator.state === "error" && <small>Não foi possível confirmar este indicador.</small>}
        </article>)}</div>
        <div className="snapshot-table-wrap"><table>
          <caption>Entidades do nível selecionado ({entityList.total})</caption>
          <thead><tr><th scope="col">Nome</th><th scope="col">Campanha</th><th scope="col">Conjunto</th><th scope="col">Valor usado</th></tr></thead>
          <tbody>{entityList.items.map(item => <tr key={item.id}><th scope="row"><button type="button" onClick={() => setEntityId(item.id)}>{item.name}</button></th>
            <td>{item.hierarchy?.campaignId ? campaignNames.get(item.hierarchy.campaignId) ?? item.hierarchy.campaignId : "—"}</td>
            <td>{item.hierarchy?.adsetId ? adsetNames.get(item.hierarchy.adsetId) ?? item.hierarchy.adsetId : "—"}</td>
            <td>{formatSnapshotDecimal(item.indicators.find(metric => metric.key === "spend")?.value ?? null,"currency",item.currency ?? account?.currency ?? null)}</td>
          </tr>)}</tbody>
        </table></div>
        {entityList.totalPages>1 && <nav className="snapshot-toolbar" aria-label="Páginas de entidades">
          <button type="button" disabled={entityList.page===1} onClick={() => { setEntityPage(entityList.page-1); setEntityId(""); }}>Anterior</button>
          <span>Página {entityList.page} de {entityList.totalPages}</span>
          <button type="button" disabled={entityList.page===entityList.totalPages} onClick={() => { setEntityPage(entityList.page+1); setEntityId(""); }}>Próxima</button>
        </nav>}
      </> : <div className="snapshot-status" role="status"><h2>{scope?.entities.length ? "Nenhuma entidade encontrada" : "Coleta confirmada sem entidades"}</h2>
        <p>{scope?.entities.length ? "Ajuste a busca para encontrar uma entidade deste nível." : "Não foram retornadas entidades neste nível e período."}</p></div>}
    </>}
  </section>;
}
