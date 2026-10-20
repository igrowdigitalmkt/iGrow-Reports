import { EntityConfigView } from "../manual/entity-config-view";
import { EntityOperations } from "../manual/entity-operations";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, ImageOff, TriangleAlert } from "lucide-react";
import { formatAnalyticsValue } from "@/modules/client-portal/analytics-format";
import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import { Cell, LEVEL_LABELS, stamp } from "../cells";
import { applyColumnPreference } from "../column-preferences";
import { columnValue, DEFAULT_COLUMN_KEYS, rowKey, unavailableReason, type ColumnDef, type CostIndex } from "../columns";
import { ancestorsOf } from "../detail";
import type { CampaignsData } from "../load";
import { campaignsPath, entityPath } from "../routes";
import { childrenOf, sortRows, type CampaignRow } from "../tree";

/** Operações manuais (renomear, pausar, retomar e, em campanhas e conjuntos, orçamento). O servidor decide o que é oferecido. */
export function OperationsCard({ clientId, entity }: { clientId: string; entity: CampaignRow }) {
  return <>
    <EntityOperations clientId={clientId} accountId={entity.accountId} level={entity.level} entityId={entity.id} entityName={entity.name} accountName={entity.accountName} currency={entity.currency} />
    <EntityConfigView clientId={clientId} accountId={entity.accountId} level={entity.level} entityId={entity.id} />
  </>;
}

export type DetailProps = { clientId: string; data: CampaignsData; entity: CampaignRow; catalog: ColumnDef[]; index: CostIndex; search: string };

const dateLabel = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** Campanhas › campanha › conjunto › entidade atual. Cada degrau é um endereço real (conta + nível + ID), nunca um nome. */
export function Breadcrumb({ clientId, data, entity, search }: Pick<DetailProps, "clientId" | "data" | "entity" | "search">) {
  const chain = ancestorsOf(entity, data.rows).reverse();
  return <nav className="cdetail-crumbs" aria-label="Navegação da hierarquia">
    <Link href={`${campaignsPath(clientId)}${search}`}>Campanhas</Link>
    {chain.map(item => <span key={item.key}><ChevronRight size={13} aria-hidden="true" /><Link href={`${entityPath(clientId, item)}${search}`} title={LEVEL_LABELS[item.level]}>{item.name}</Link></span>)}
    <span><ChevronRight size={13} aria-hidden="true" /><strong aria-current="page" title={entity.name}>{entity.name}</strong></span>
  </nav>;
}

export function StateBadge({ entity }: { entity: CampaignRow }) {
  return <span className="cdetail-state-line"><span className={`campaign-state is-${entity.state.tone}`} title={entity.state.detail}><i aria-hidden="true" />{entity.state.label}</span>
    {entity.state.restrictions.map(item => <span className="campaign-restriction" key={item.key} title={item.detail}><TriangleAlert size={11} />{item.label}</span>)}</span>;
}

/** Definição curta: rótulo e valor, sem inventar campos. */
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

export function IdentityCard({ entity, parents }: { entity: CampaignRow; parents: CampaignRow[] }) {
  return <section className="analytics-card cdetail-card" aria-labelledby="cdetail-identity"><h2 id="cdetail-identity">Identificação</h2>
    <dl className="cdetail-facts">
      <Fact label="Nível">{LEVEL_LABELS[entity.level]}</Fact>
      <Fact label="Plataforma">Meta Ads</Fact>
      <Fact label="Conta de anúncios">{entity.accountName}</Fact>
      <Fact label="Identificador"><code>{entity.id}</code></Fact>
      {parents.map(parent => <Fact key={parent.key} label={LEVEL_LABELS[parent.level]}>{parent.name}</Fact>)}
    </dl></section>;
}

/** Estado configurado (escolha do anunciante) e efetivo (calculado pela Meta) são coisas diferentes e aparecem separados. */
export function StateCard({ entity, data }: { entity: CampaignRow; data: CampaignsData }) {
  const { state } = entity;
  // O resumo textual só acrescenta algo quando o estado não é óbvio (sem efetivo, configurado diferente ou código não classificado).
  const showDetail = !!state.detail && (!state.effective || (!!state.configured && state.configured.code !== state.effective.code) || state.label === "Estado não classificado");
  const live = data.live.state === "ok" && data.live.checkedAt ? `Consultado na Meta em ${stamp(data.live.checkedAt)}${data.live.cached ? " (leitura reaproveitada, até 45 s)" : ""}`
    : data.live.state === "partial" && data.live.checkedAt ? `Consulta parcial na Meta (${stamp(data.live.checkedAt)})` : "Estado atual na Meta indisponível: veiculação não confirmada";
  return <section className="analytics-card cdetail-card" aria-labelledby="cdetail-state"><h2 id="cdetail-state">Veiculação</h2>
    <StateBadge entity={entity} />
    <dl className="cdetail-facts">
      <Fact label="Estado configurado">{state.configured?.label ?? "Não informado"}</Fact>
      <Fact label="Estado efetivo">{state.effective?.label ?? "Indisponível"}</Fact>
      <Fact label="Última confirmação">{live}</Fact>
    </dl>
    {state.restrictions.length > 0 && <ul className="cdetail-restrictions">{state.restrictions.map(item => <li key={item.key}><strong>{item.label}</strong><span>{item.detail}</span></li>)}</ul>}
    {showDetail && <p className="cdetail-note">{state.detail}</p>}
  </section>;
}

export function ContextCard({ data }: { data: CampaignsData }) {
  return <section className="analytics-card cdetail-card" aria-labelledby="cdetail-context"><h2 id="cdetail-context">Contexto dos dados</h2>
    <dl className="cdetail-facts">
      <Fact label="Período">{dateLabel(data.dateFrom)} a {dateLabel(data.dateTo)}</Fact>
      <Fact label="Moeda">{data.accounts[0]?.currency ?? "—"}</Fact>
      <Fact label="Fonte">{data.metricsState === "pending"
        ? "Catálogo e estado lidos agora na Meta; métricas do período ainda não confirmadas"
        : `Métricas confirmadas da Meta${data.latestCollectedAt ? `; coleta em ${stamp(data.latestCollectedAt)}` : ""}`}</Fact>
    </dl>
    {data.message && <p className="cdetail-note" role="status">{data.message}</p>}
    {data.warnings.slice(0, 3).map(warning => <p key={warning} className="cdetail-note">{warning}</p>)}
    <p className="cdetail-note">Orçamento, públicos, posicionamentos e programação ainda não são coletados por esta área; por isso não aparecem. Tela somente de leitura.</p>
  </section>;
}

/** Métricas base confirmadas. Ausência de dado é "—" com explicação, nunca zero. */
export function PerformanceGrid({ entity, catalog, index }: Pick<DetailProps, "entity" | "catalog" | "index">) {
  const base = catalog.filter(column => column.group === "base");
  const hasAny = Object.keys(entity.values).length > 0;
  return <section className="cdetail-section" aria-labelledby="cdetail-performance"><h2 id="cdetail-performance">Desempenho no período</h2>
    {entity.metricsPending
      ? <p className="cdetail-note is-info" role="status">As métricas deste período ainda estão sendo atualizadas. A entidade existe no catálogo da Meta, mas todos os valores abaixo estão indisponíveis por enquanto (não são zero).</p>
      : !hasAny && <p className="cdetail-note" role="status">Sem dado confirmado para esta entidade no período (não é o mesmo que zero).</p>}
    <div className="cdetail-kpis">{base.map(column => {
      const value = columnValue(entity, column.key, index);
      return <div className="cdetail-kpi" key={column.key}><span>{column.label}</span>
        <strong className={value == null ? "is-unavailable" : undefined} title={value == null ? unavailableReason(entity, column.key) : undefined}>{value == null ? "—" : formatAnalyticsValue(value, column.metric, entity.currency)}</strong></div>;
    })}</div>
  </section>;
}

/** Resultados por tipo, cada um com o custo ATRIBUÍDO a ele quando existe; nada é somado entre tipos. */
export function ResultsSection({ entity, catalog, index }: Pick<DetailProps, "entity" | "catalog" | "index">) {
  const results = resultBreakdown(entity.values);
  const resultColumn = catalog.find(column => column.key === "results");
  const costColumn = catalog.find(column => column.key === "cost_result");
  return <section className="cdetail-section" aria-labelledby="cdetail-results"><h2 id="cdetail-results">Resultados por tipo</h2>
    {!results.length || !resultColumn || !costColumn
      ? <p className="cdetail-note" title={unavailableReason(entity, "results")}>{resultColumn ? <Cell column={resultColumn} row={entity} index={index} /> : "—"} <span>{unavailableReason(entity, "results")}</span></p>
      : <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th scope="col">Tipo de resultado</th><th scope="col">Resultados</th><th scope="col">Custo atribuído</th></tr></thead>
        <tbody>{results.map(result => {
          const cost = index.get(rowKey(entity))?.get(result.key) ?? null;
          return <tr key={result.key}><th scope="row">{result.label}</th><td>{formatAnalyticsValue(result.value, resultColumn.metric, entity.currency)}</td>
            <td title={cost == null ? unavailableReason(entity, `cost:${result.key}`) : undefined}>{cost == null ? "—" : formatAnalyticsValue(cost, costColumn.metric, entity.currency)}</td></tr>;
        })}</tbody></table></div>}
    <p className="cdetail-note">Tipos de resultado são mostrados separadamente e não se somam. O custo atribuído usa apenas o investimento do seu tipo.</p>
  </section>;
}

/** Filhos diretos (conjuntos de uma campanha, anúncios de um conjunto), ordenados por investimento; o nome abre o detalhe do filho. */
export function ChildrenSection({ clientId, entity, data, catalog, index, search, title, emptyText }: DetailProps & { title: string; emptyText: string }) {
  const columns = applyColumnPreference(catalog, DEFAULT_COLUMN_KEYS);
  const valueOf = (row: CampaignRow, key: string) => columnValue(row, key, index);
  const children = sortRows(childrenOf(entity, data.rows), { key: "spend", direction: "desc" }, valueOf);
  return <section className="cdetail-section" aria-labelledby="cdetail-children"><h2 id="cdetail-children">{title} <span className="analytics-count">{children.length}</span></h2>
    {!children.length ? <p className="cdetail-note">{emptyText}</p>
      : <div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table">
        <thead><tr><th scope="col" className="analytics-campaign-main-header">Nome</th><th scope="col" className="campaign-state-head">Veiculação</th>{columns.map(column => <th scope="col" key={column.key} data-col={column.key} title={column.hint}>{column.label}</th>)}</tr></thead>
        <tbody>{children.map(child => <tr key={child.key}>
          <th scope="row"><div className="analytics-campaign-name">
            {child.level === "ad" && (child.thumbnailUrl
              ? <Image className="analytics-ad-thumbnail" src={child.thumbnailUrl} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" />
              : <span className="analytics-ad-thumbnail-placeholder" title="Imagem não retornada pela Meta">—</span>)}
            <Link className="cdetail-link" href={`${entityPath(clientId, child)}${search}`}><strong>{child.name}</strong><small>{LEVEL_LABELS[child.level]}</small></Link></div></th>
          <td className="campaign-state-cell"><StateBadge entity={child} /></td>
          {columns.map(column => <td key={column.key} data-col={column.key}><Cell column={column} row={child} index={index} /></td>)}
        </tr>)}</tbody></table></div>}
  </section>;
}

/** Criativo: só a miniatura que a Meta devolveu. Sem ela, um aviso explícito (nada é inventado). */
export function CreativeCard({ entity }: { entity: CampaignRow }) {
  return <section className="analytics-card cdetail-card" aria-labelledby="cdetail-creative"><h2 id="cdetail-creative">Criativo</h2>
    {entity.thumbnailUrl
      ? <Image className="cdetail-thumbnail" src={entity.thumbnailUrl} alt={`Miniatura do anúncio ${entity.name}`} width={320} height={320} unoptimized referrerPolicy="no-referrer" />
      : <div className="cdetail-thumbnail is-missing"><ImageOff size={22} aria-hidden="true" /><span>Imagem não retornada pela Meta</span></div>}
  </section>;
}
