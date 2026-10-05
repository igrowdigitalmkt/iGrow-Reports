"use client";

import { useEffect,useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock3,Layers3,RefreshCw } from "lucide-react";
import type { SnapshotDashboardData } from "./snapshot-dashboard-loader";
import type { EntityLevel } from "../integrations/data-contract";
import { formatSnapshotDecimal } from "../meta/snapshot-format";
import "./snapshot-dashboard.css";
import { requestMissingSnapshotData } from "./snapshot-dashboard-actions";
import { snapshotEntityPage } from "../meta/snapshot-entity-list";
import { exportMetaSnapshotCsv,exportMetaSnapshotJson } from "../meta/snapshot-export";
import { SnapshotPdfUnsupportedTextError } from "../reports/snapshot-pdf-error";
import { compareSnapshotIndicator,resolveSnapshotComparison,snapshotComparisonDescription } from "../meta/snapshot-comparison";
import { exportSnapshotComparisonCsv,exportSnapshotComparisonJson } from "../meta/snapshot-comparison-export";

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
  const [exporting,setExporting] = useState(false);
  const [exportProgress,setExportProgress] = useState("");
  const exportController = useRef<AbortController | null>(null);
  const account = data.accounts.find(item => item.id === accountId && data.selectedAccountIds.includes(item.id))
    ?? data.accounts.find(item => data.selectedAccountIds.includes(item.id));
  const scope = data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === level);
  const entityList = snapshotEntityPage(scope?.entities ?? [],entityQuery,entityPage);
  const entity = entityList.items.find(item => item.id === entityId) ?? entityList.items[0];
  const comparison = account && scope && data.comparison && data.view.status !== "pending"
    ? resolveSnapshotComparison(data.view,data.comparison.view,account.external_id,level) : null;
  const previousEntity = entity ? comparison?.previousEntities.get(entity.id) : undefined;
  const currentEntityIds = new Set(scope?.entities.map(item => item.id));
  const previousOnlyCount = comparison?.previous.entities.filter(item => !currentEntityIds.has(item.id)).length ?? 0;
  const indicators = entity?.indicators.filter(item => item.key !== "result:provider_known") ?? [];
  const campaignNames = new Map(data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === "campaign")?.entities.map(item => [item.id,item.name]) ?? []);
  const adsetNames = new Map(data.view.scopes.find(item => item.identity.externalAccountId === account?.external_id && item.identity.level === "adset")?.entities.map(item => [item.id,item.name]) ?? []);
  async function exportReport(format: "csv" | "json" | "pdf") {
    if (exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    setError(""); setMessage(""); setExportProgress("Preparando exportação…"); setExporting(true);
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      if (!account) return;
      const report = format === "pdf" ? await (async () => {
        const { buildMetaSnapshotPdfAsync,loadSnapshotPdfFonts } = await import("../reports/snapshot-pdf");
        const result = await buildMetaSnapshotPdfAsync({ view: data.view,previousView: data.comparison?.view,externalAccountId: account.external_id,level,accountName: account.name },await loadSnapshotPdfFonts(),(completed,total) => setExportProgress(`Preparando PDF: ${completed} de ${total} entidades`),controller.signal);
        return { ...result,content: result.doc.output("arraybuffer") };
      })() : data.comparison ? format === "csv" ? exportSnapshotComparisonCsv(data.view,data.comparison.view,account.external_id,level)
        : exportSnapshotComparisonJson(data.view,data.comparison.view,account.external_id,level)
        : format === "csv" ? exportMetaSnapshotCsv(data.view,account.external_id,level) : exportMetaSnapshotJson(data.view,account.external_id,level);
      if (format === "pdf") await new Promise(resolve => window.setTimeout(resolve,0));
      controller.signal.throwIfAborted();
      url = URL.createObjectURL(new Blob([report.content],{ type: format === "pdf" ? "application/pdf" : format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" }));
      link = document.createElement("a"); link.href = url; link.download = report.filename;
      document.body.appendChild(link); link.click();
      setMessage(`Exportação preparada com ${report.entityCount} entidades do nível selecionado. A busca e a paginação não limitam o arquivo.`);
    } catch (failure) {
      if (controller.signal.aborted) setMessage("Exportação cancelada.");
      else if (failure instanceof SnapshotPdfUnsupportedTextError) setError("Alguns caracteres deste relatório não são suportados no PDF. Exporte CSV ou JSON para preservar os nomes completos.");
      else setError("Não foi possível exportar a análise confirmada. Tente novamente.");
    }
    finally {
      link?.remove();
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!),1_000);
      setExporting(false);
      setExportProgress("");
      exportController.current = null;
    }
  }
  useEffect(() => () => exportController.current?.abort(),[]);
  function requestRefresh(target: "current" | "previous" = "current",refresh = true) {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await requestMissingSnapshotData({ clientId,from: data.dateFrom,to: data.dateTo,accountIds: data.selectedAccountIds,refresh,...(target === "previous" ? { target } : {}) });
        if ("error" in result) setError(result.error ?? "Não foi possível solicitar a atualização.");
        else setMessage(result.created ? `Coleta solicitada para o período ${target === "previous" ? "anterior" : "atual"}. Aguarde a conclusão e a validação.`
          : "A coleta deste período já está na fila ou em andamento. Aguarde sua conclusão.");
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
      {canCollect && !!data.selectedAccountIds.length && <button type="button" onClick={() => requestRefresh()} disabled={pending || exporting}>{data.comparison ? "Atualizar período atual" : "Atualizar dados"}</button>}
      {canCollect && data.comparison && <button type="button" onClick={() => requestRefresh("previous")} disabled={pending || exporting}>Atualizar período anterior</button>}
      <button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending || exporting}>
        <RefreshCw size={16} className={pending ? "snapshot-spin" : ""} />{pending ? "Consultando…" : "Consultar atualização"}
      </button>
    </div>
    <form className="snapshot-filters" method="get">
      <input type="hidden" name="periodo" value="custom" />
      <label>De<input type="date" name="from" defaultValue={data.dateFrom} disabled={exporting} required /></label>
      <label>Até<input type="date" name="to" defaultValue={data.dateTo} disabled={exporting} required /></label>
      <label>Contas<select name="accounts" disabled={exporting} defaultValue={data.selectedAccountIds.length === 1 ? data.selectedAccountIds[0] : ""}>
        <option value="">Todas as contas vinculadas</option>
        {data.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Comparação<select name="compare" disabled={exporting} defaultValue={data.comparison ? "previous" : ""}>
        <option value="">Sem comparação</option><option value="previous">Período anterior de mesma duração</option>
      </select></label>
      <button type="submit" disabled={exporting}>Aplicar período</button>
    </form>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {exporting && <div className="snapshot-toolbar"><p role="status" aria-live="polite">{exportProgress}</p>
      <button type="button" onClick={() => exportController.current?.abort()}>Cancelar exportação</button>
    </div>}
    {data.view.status === "pending" ? <div className="snapshot-status" role="status" aria-live="polite">
      <Layers3 size={24} /><h2>{data.blockedReason === "no_accounts" ? "Nenhuma conta vinculada" : "Aguardando a análise completa"}</h2>
      <p>{data.blockedReason === "no_accounts" ? "Vincule uma conta de anúncios a este cliente para acompanhar seu desempenho."
        : data.blockedReason === "spend" || data.blockedReason === "hierarchy" || data.blockedReason === "invalid"
          ? "Os dados deste período ainda precisam ser conciliados. A análise será exibida somente após a confirmação de todas as contas e níveis."
          : data.comparison ? "A análise e a comparação serão exibidas juntas quando todas as contas e níveis dos dois períodos estiverem confirmados."
            : "A análise será exibida por inteiro quando todas as contas e níveis deste período estiverem confirmados."}</p>
      {data.blockedReason !== "no_accounts" && <small>A disponibilidade será consultada novamente automaticamente.</small>}
      {canCollect && data.blockedReason === "missing" && <div className="snapshot-request">
        {!!data.view.missing.length && <button type="button" disabled={pending} onClick={() => requestRefresh("current",false)}>{data.comparison ? "Solicitar dados do período atual" : "Solicitar dados faltantes"}</button>}
        {!!data.comparison?.view.missing.length && <button type="button" disabled={pending} onClick={() => requestRefresh("previous",false)}>Solicitar dados do período anterior</button>}
      </div>}
    </div> : <>
      <div className="snapshot-freshness" role="status"><Clock3 size={15} />
        {data.view.status === "stale" ? "Dados confirmados anteriormente · aguardando atualização" : "Análise confirmada"}
        {data.view.collectedAt && <time dateTime={data.view.collectedAt}>{new Intl.DateTimeFormat("pt-BR",{ dateStyle: "short",timeStyle: "short",timeZone: "America/Sao_Paulo" }).format(new Date(data.view.collectedAt))}</time>}
      </div>
      {data.comparison && <p className="snapshot-freshness">Comparação: {data.comparison.dateFrom} a {data.comparison.dateTo}.
        {data.comparison.view.status === "stale" ? " Período anterior confirmado anteriormente, aguardando atualização." : " Período anterior confirmado."}
        {data.comparison.view.collectedAt && ` Coleta anterior: ${new Intl.DateTimeFormat("pt-BR",{ dateStyle: "short",timeStyle: "short",timeZone: "America/Sao_Paulo" }).format(new Date(data.comparison.view.collectedAt))}.`}
      </p>}
      <div className="snapshot-selectors">
        <label>Conta exibida<select disabled={exporting} value={account?.id ?? ""} onChange={event => { setAccountId(event.target.value); setEntityId(""); setEntityQuery(""); setEntityPage(1); }}>
          {data.accounts.filter(item => data.selectedAccountIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}
        </select></label>
        <label>Nível<select disabled={exporting} value={level} onChange={event => { setLevel(event.target.value as EntityLevel); setEntityId(""); setEntityQuery(""); setEntityPage(1); }}>
          {levels.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        {level !== "account" && <label>Buscar entidade<input type="search" value={entityQuery} placeholder="Nome ou ID" onChange={event => { setEntityQuery(event.target.value); setEntityPage(1); setEntityId(""); }} /></label>}
        {level !== "account" && !!entityList.items.length && <label>Entidade da página<select value={entity?.id ?? ""} onChange={event => setEntityId(event.target.value)}>
          {entityList.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
      </div>
      <div className="snapshot-toolbar">
        <p>Exportar todas as entidades da conta e do nível selecionados, com valores exatos e disponibilidade dos indicadores. Use JSON para preservar os decimais como texto ao importar.</p>
        <button type="button" onClick={() => exportReport("csv")} disabled={pending || exporting || !scope}>Exportar CSV do nível</button>
        <button type="button" onClick={() => exportReport("json")} disabled={pending || exporting || !scope}>Exportar JSON do nível</button>
        <button type="button" onClick={() => exportReport("pdf")} disabled={pending || exporting || !scope}>{exporting ? "Preparando exportação…" : "Exportar PDF do nível"}</button>
      </div>
      {comparison && <p className="snapshot-freshness">CSV e JSON incluem os dois períodos. O PDF apresenta as entidades atuais com seus valores anteriores.
        {previousOnlyCount > 0 && ` ${previousOnlyCount} ${previousOnlyCount === 1 ? "entidade foi retornada apenas no período anterior e está disponível" : "entidades foram retornadas apenas no período anterior e estão disponíveis"} em CSV e JSON.`}
      </p>}
      {entity ? <>
        <div className="snapshot-entity-heading"><h2>{level === "account" ? account?.name : entity.name}</h2>
          <p>{entity.currency ?? account?.currency} · {entity.timezone}</p>
        </div>
        <div className="snapshot-cards">{indicators.map(indicator => {
          const change = comparison ? compareSnapshotIndicator(indicator,entity,previousEntity) : null;
          return <article key={indicator.key} className="snapshot-card">
          <h3>{indicator.label}</h3>
          <strong title={indicator.value ?? undefined} className={indicator.value === null ? "snapshot-unavailable" : ""}>
            {formatSnapshotDecimal(indicator.value,indicator.unit,entity.currency ?? account?.currency ?? null)}
          </strong>
          {indicator.state === "unavailable" && <small>Indicador não disponível neste escopo confirmado.</small>}
          {indicator.state === "error" && <small>Não foi possível confirmar este indicador.</small>}
          {change && <small>
            Anterior: {formatSnapshotDecimal(change.previousValue,indicator.unit,entity.currency ?? account?.currency ?? null)}<br />
            {snapshotComparisonDescription(change)}
            {change.absoluteChange !== null && <><br /><span title={change.absoluteChange}>Diferença: {formatSnapshotDecimal(change.absoluteChange,indicator.unit,entity.currency ?? account?.currency ?? null)}</span></>}
          </small>}
        </article>; })}</div>
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
