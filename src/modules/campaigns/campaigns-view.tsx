"use client";

import { Fragment, useCallback, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ChevronUp, Columns3, Search, TriangleAlert, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { PeriodPicker } from "@/modules/client-portal/period-picker";
import "@/modules/client-portal/analytics-dashboard.css";
import "./campaigns.css";
import { Cell, LEVEL_LABELS, stamp } from "./cells";
import { buildColumns, buildCostIndex, columnValue, DEFAULT_COLUMN_KEYS, resultFamilies, type ColumnDef } from "./columns";
import { applyColumnPreference, columnPreferenceKey, moveColumn, parseColumnPreference, serializeColumnPreference } from "./column-preferences";
import { DELIVERY_GROUPS, type DeliveryGroup } from "./delivery-state";
import { useLocalPreference, writeLocalPreference } from "./local-preference";
import { entityPath, periodSearch } from "./routes";
import { buildChildIndex, filterCampaignRows, indexedChildren, sortRows, type CampaignRow, type SortSpec } from "./tree";
import type { CampaignsData } from "./load";

export type SelectedEntity = { accountId: string; level: CampaignRow["level"]; id: string };

export function CampaignsView({ clientId, data, onlyActive, selected = null, onSelectEntity, preferenceKey }: {
  /** Cliente da rota: a tela nunca escolhe outro. */
  clientId: string; data: CampaignsData; onlyActive: boolean;
  /** Entidade em análise pelo assistente (identidade completa: conta + nível + ID). */
  selected?: SelectedEntity | null; onSelectEntity?: (row: CampaignRow) => void;
  /** Chave da preferência local de colunas (organização + usuário). Sem ela, a escolha não é salva. */
  preferenceKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<DeliveryGroup | "restricted" | "all">("all");
  const [sort, setSort] = useState<SortSpec>({ key: "name", direction: "asc" });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [accountDraft, setAccountDraft] = useState<string[] | null>(null);
  // Preferência local (só chaves de colunas, na ordem escolhida): lida após a hidratação e gravada apenas quando o usuário altera.
  const storageKey = preferenceKey ? columnPreferenceKey(preferenceKey) : null;
  const saved = parseColumnPreference(useLocalPreference(storageKey));
  const [chosen, setChosen] = useState<string[] | null>(null);
  const columnKeys = chosen ?? saved ?? DEFAULT_COLUMN_KEYS;
  const updateColumns = (next: string[]) => {
    setChosen(next);
    if (storageKey) writeLocalPreference(storageKey, serializeColumnPreference(next));
  };
  const restoreColumns = () => {
    setChosen(DEFAULT_COLUMN_KEYS);
    if (storageKey) writeLocalPreference(storageKey, null);
  };

  // Os filtros que mudam a leitura (contas, período, escopo) vão para o endereço; busca e estado filtram os dados já carregados.
  // O cliente é o da rota (/clientes/ID/campanhas): nunca vai para a busca.
  const navigate = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams({ periodo: data.period });
    if (data.period === "custom") { params.set("from", data.dateFrom); params.set("to", data.dateTo); }
    if (data.accounts.length > 1 && data.selectedAccountIds.length !== data.accounts.length) params.set("contas", data.selectedAccountIds.join(","));
    if (onlyActive) params.set("ativas", "1");
    for (const [key, value] of Object.entries(changes)) { if (value === null) params.delete(key); else params.set(key, value); }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const catalog = useMemo(() => buildColumns(data.metrics, resultFamilies(data.rows)), [data.metrics, data.rows]);
  const columns = useMemo(() => applyColumnPreference(catalog, columnKeys), [catalog, columnKeys]);
  const filtered = useMemo(() => filterCampaignRows(data.rows, { query, group }), [data.rows, query, group]);
  const counts = useMemo(() => {
    const total = new Map<DeliveryGroup | "restricted", number>();
    for (const row of data.rows) {
      total.set(row.state.group, (total.get(row.state.group) ?? 0) + 1);
      if (row.state.restrictions.length) total.set("restricted", (total.get("restricted") ?? 0) + 1);
    }
    return total;
  }, [data.rows]);
  const costIndex = useMemo(() => buildCostIndex(data.rows), [data.rows]);
  // Filhos diretos das linhas VISÍVEIS (após busca e estado), indexados uma vez: nada de varrer a lista a cada linha desenhada.
  const childIndex = useMemo(() => buildChildIndex(filtered.rows), [filtered.rows]);
  const valueOf = useCallback((row: CampaignRow, key: string) => columnValue(row, key, costIndex), [costIndex]);
  const roots = useMemo(() => sortRows(filtered.rows.filter(row => row.level === "campaign"), sort, valueOf), [filtered.rows, sort, valueOf]);
  const open = useMemo(() => new Set([...expanded, ...filtered.reveal]), [expanded, filtered.reveal]);
  const expandable = useMemo(() => filtered.rows.filter(row => row.level !== "ad" && indexedChildren(row, childIndex).length).map(row => row.key), [filtered.rows, childIndex]);
  const allOpen = expandable.length > 0 && expandable.every(key => open.has(key));
  const toggle = (key: string) => setExpanded(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  const sortBy = (key: string) => setSort(current => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const sortMark = (key: string) => sort.key === key && <ChevronDown size={12} style={{ transform: sort.direction === "asc" ? "rotate(180deg)" : undefined }} />;
  const ariaSort = (key: string) => sort.key === key ? (sort.direction === "asc" ? "ascending" as const : "descending" as const) : "none" as const;
  const filtering = query.trim() !== "" || group !== "all";
  const draft = accountDraft ?? data.selectedAccountIds;
  const campaignTotal = data.rows.filter(row => row.level === "campaign").length;
  const detailSearch = periodSearch(data);

  const render = (row: CampaignRow, depth: number): React.ReactNode => {
    const children = sortRows(indexedChildren(row, childIndex), sort, valueOf);
    const isOpen = open.has(row.key);
    const isSelected = !!selected && selected.accountId === row.accountId && selected.level === row.level && selected.id === row.id;
    return <Fragment key={`${row.accountId}:${row.key}`}>
      <tr className={isSelected ? "is-context" : undefined}>
        <th scope="row"><div className="analytics-campaign-name" style={{ paddingLeft: depth * 24 }}>
          {row.level !== "ad" ? <button type="button" className="analytics-tree-expand" aria-expanded={isOpen}
            aria-label={`${isOpen ? "Recolher" : "Expandir"} ${row.name}`} onClick={() => toggle(row.key)}>
            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button> : <span className="analytics-tree-spacer" />}
          {row.level === "ad" && (row.thumbnailUrl
            ? <Image className="analytics-ad-thumbnail" src={row.thumbnailUrl} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />
            : <span className="analytics-ad-thumbnail-placeholder" title="Imagem não retornada pela Meta">—</span>)}
          {onSelectEntity ? <button type="button" className="campaigns-pick" aria-pressed={isSelected} onClick={() => onSelectEntity(row)}
            title={isSelected ? "Em análise pelo assistente. Clique para voltar ao contexto geral." : `Analisar com o Assistente Groow: ${row.name}`}>
            <strong>{row.name}</strong>
            <small>{row.level === "campaign" ? row.accountName : LEVEL_LABELS[row.level]}</small></button>
            : <div><strong title={row.name}>{row.name}</strong>
            <small>{row.level === "campaign" ? row.accountName : LEVEL_LABELS[row.level]}</small></div>}
          {/* Duas ações distintas: o nome seleciona a entidade para o assistente; o ícone abre a página de detalhes. */}
          <Link className="campaigns-open" href={`${entityPath(clientId, row)}${detailSearch}`} prefetch={false}
            aria-label={`Abrir detalhes: ${row.name}`} title={`Abrir detalhes (${LEVEL_LABELS[row.level].toLocaleLowerCase("pt-BR")})`}><ArrowUpRight size={14} /></Link>
        </div></th>
        <td className="campaign-state-cell"><div className="campaign-state-stack">
          <span className={`campaign-state is-${row.state.tone}`} title={row.state.detail}><i aria-hidden="true" />{row.state.label}</span>
          {row.state.restrictions.map(item => <span className="campaign-restriction" key={item.key} title={item.detail}><TriangleAlert size={11} />{item.label}</span>)}
        </div></td>
        {columns.map(column => <td key={column.key} data-col={column.key}><Cell column={column} row={row} index={costIndex} /></td>)}
      </tr>
      {isOpen && children.map(child => render(child, depth + 1))}
      {isOpen && !children.length && <tr><td colSpan={columns.length + 2} className="analytics-tree-empty">Nenhum {row.level === "campaign" ? "conjunto" : "anúncio"} encontrado para esta entidade.</td></tr>}
    </Fragment>;
  };

  const shown = columns.map(column => column.key);
  // A ordem escolhida é a ordem das colunas visíveis; chaves que não existem neste período continuam guardadas no fim.
  const moveShown = (key: string, direction: -1 | 1) => updateColumns([...moveColumn(shown, key, direction), ...columnKeys.filter(item => !shown.includes(item))]);
  const metricColumns = catalog.filter(column => column.group === "base" || column.key === "results" || column.key === "cost_result");
  const typeColumns = catalog.filter(column => column.key.startsWith("result:") || column.key.startsWith("cost:"));
  const referenceColumns = catalog.filter(column => column.key.startsWith("event:"));
  const columnRow = (column: ColumnDef) => <label key={column.key} title={column.hint}>
    <input type="checkbox" checked={shown.includes(column.key)} disabled={shown.includes(column.key) && shown.length === 1}
      onChange={() => updateColumns(shown.includes(column.key) ? columnKeys.filter(key => key !== column.key) : [...columnKeys.filter(key => key !== column.key), column.key])} />
    <span>{column.label}</span></label>;

  return <div className={`campaigns-page${pending ? " is-pending" : ""}`} aria-busy={pending}>
    <div className="campaigns-toolbar">
      {data.accounts.length > 1 && <div className="campaigns-field"><span>Contas de anúncios</span>
        <details className="campaigns-accounts" onToggle={event => { if (!event.currentTarget.open) setAccountDraft(null); }}>
          <summary>{data.selectedAccountIds.length === data.accounts.length ? "Todas as contas" : `${data.selectedAccountIds.length} de ${data.accounts.length} contas`}<ChevronDown size={14} /></summary>
          <div className="campaigns-accounts-list">
            {data.accounts.map(account => <label key={account.id}>
              <input type="checkbox" checked={draft.includes(account.id)} onChange={() => setAccountDraft(draft.includes(account.id) ? draft.filter(id => id !== account.id) : [...draft, account.id])} />
              <span>{account.name}</span></label>)}
            <button type="button" className="campaigns-apply" disabled={!draft.length || pending}
              onClick={() => navigate({ contas: draft.length === data.accounts.length ? null : draft.join(",") })}>Aplicar</button>
          </div>
        </details></div>}
      <div className="campaigns-field"><span>Período</span>
        <PeriodPicker period={data.period} dateFrom={data.dateFrom} dateTo={data.dateTo} today={data.today} disabled={pending}
          onApply={selection => navigate(selection.period === "custom" ? { periodo: "custom", from: selection.from, to: selection.to } : { periodo: selection.period, from: null, to: null })} /></div>
      <label className="campaigns-field"><span>Veiculação</span>
        <Select className="compact-select campaigns-select" value={group} aria-label="Filtrar por veiculação" onChange={event => setGroup(event.target.value as DeliveryGroup | "restricted" | "all")}>
          <option value="all">Todos os estados</option>
          {DELIVERY_GROUPS.filter(item => counts.get(item.key)).map(item => <option key={item.key} value={item.key}>{item.label} ({counts.get(item.key)})</option>)}
          {!!counts.get("restricted") && <option value="restricted">Com restrição de entrega ({counts.get("restricted")})</option>}
        </Select></label>
      <label className="campaigns-field campaigns-search"><span>Busca</span>
        <div className="campaigns-search-box"><Search size={14} />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome" aria-label="Buscar por nome" />
          {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery("")}><X size={13} /></button>}</div></label>
    </div>

    {data.message && <p className="campaigns-alert" role="alert">{data.message}</p>}
    {data.state === "ready" && data.metricsState === "pending" && <p className="campaigns-alert is-info" role="status">Campanhas carregadas. As métricas deste período ainda estão sendo atualizadas; por enquanto os valores aparecem como indisponíveis (—), não como zero.</p>}
    {data.state === "ready" && data.warnings.slice(0, 3).map(warning => <p key={warning} className="campaigns-alert">{warning}</p>)}

    {data.state !== "ready" ? <div className="campaigns-empty"><strong>{data.state === "no-accounts" ? "Nenhuma conta vinculada" : data.state === "blocked" ? "Campanhas ainda indisponíveis" : "Campanhas indisponíveis"}</strong></div>
      : <article className="analytics-card campaigns-card">
        <div className="campaigns-card-head">
          <span>{roots.length} {roots.length === 1 ? "campanha" : "campanhas"}{filtering && campaignTotal ? ` de ${campaignTotal}` : ""}</span>
          <div className="campaigns-card-actions">
            <label className="campaigns-check"><input type="checkbox" checked={onlyActive} disabled={pending} onChange={event => navigate({ ativas: event.target.checked ? "1" : null })} />Somente com gasto ou em veiculação</label>
            <details className="campaigns-columns">
              <summary><Columns3 size={14} />Colunas <span className="analytics-count">{columns.length}</span></summary>
              <div className="campaigns-columns-list">
                <strong>Ordem na tabela</strong>
                <ol className="campaigns-column-order">{columns.map((column, position) => <li key={column.key}><span>{column.label}</span>
                  <button type="button" disabled={position === 0} aria-label={`Mover ${column.label} para a esquerda`} onClick={() => moveShown(column.key, -1)}><ChevronUp size={13} /></button>
                  <button type="button" disabled={position === columns.length - 1} aria-label={`Mover ${column.label} para a direita`} onClick={() => moveShown(column.key, 1)}><ChevronDown size={13} /></button></li>)}</ol>
                <strong>Métricas</strong>{metricColumns.map(columnRow)}
                {typeColumns.length > 0 && <><strong>Resultados e custo atribuído, por tipo</strong><p>O custo atribuído usa apenas o investimento do seu tipo de resultado.</p>{typeColumns.map(columnRow)}</>}
                {referenceColumns.length > 0 && <><strong>Referência: investimento ÷ evento</strong><p>Investimento total dividido pelo volume do evento. Não é custo atribuído.</p>{referenceColumns.map(columnRow)}</>}
                <button type="button" className="campaigns-link" onClick={restoreColumns}>Restaurar padrão</button>
              </div>
            </details>
            <button type="button" className="campaigns-link" disabled={!expandable.length} onClick={() => setExpanded(allOpen ? [] : expandable)}>
              {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}{allOpen ? "Recolher tudo" : "Expandir tudo"}</button>
          </div>
        </div>
        <div className="analytics-table-scroll is-capped"><table className="analytics-table analytics-campaign-table">
          <thead><tr>
            <th scope="col" className="analytics-campaign-main-header" aria-sort={ariaSort("name")}><button type="button" onClick={() => sortBy("name")}>Nome{sortMark("name")}</button></th>
            <th scope="col" className="campaign-state-head">Veiculação</th>
            {columns.map(column => <th scope="col" key={column.key} data-col={column.key} title={column.hint} aria-sort={column.sortable ? ariaSort(column.key) : undefined}>{column.sortable
              ? <button type="button" onClick={() => sortBy(column.key)}>{column.label}{sortMark(column.key)}</button> : column.label}</th>)}
          </tr></thead>
          <tbody>{roots.map(root => render(root, 0))}</tbody>
        </table></div>
        {!roots.length && <p className="analytics-empty-copy">{filtering ? "Nenhum item corresponde à busca e aos filtros." : onlyActive ? "Nenhuma campanha em veiculação ou com gasto neste período. Desmarque o filtro para ver as demais." : "Nenhuma campanha encontrada para as contas selecionadas."}</p>}
        <div className="campaigns-freshness">
          <span>{data.metricsState === "pending" ? <><i className="is-warn" aria-hidden="true" />Métricas de {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateFrom}T12:00:00Z`))} a {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateTo}T12:00:00Z`))} ainda não confirmadas (coleta em andamento)</> : <><i className="is-ok" aria-hidden="true" />Métricas históricas confirmadas para {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateFrom}T12:00:00Z`))} a {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateTo}T12:00:00Z`))}{data.latestCollectedAt ? ` · coleta em ${stamp(data.latestCollectedAt)}` : ""}</>}</span>
          <span>{data.live.state === "ok" && data.live.checkedAt ? <><i className="is-ok" aria-hidden="true" />Estado atual consultado na Meta em {stamp(data.live.checkedAt)}{data.live.cached ? " (leitura reaproveitada, até 45 s)" : ""}</>
            : data.live.state === "partial" && data.live.checkedAt ? <><i className="is-warn" aria-hidden="true" />Estado atual consultado em {data.live.accountsRead} de {data.live.accountsTotal} contas ({stamp(data.live.checkedAt)})</>
            : <><i className="is-bad" aria-hidden="true" />Estado atual na Meta indisponível: veiculação não confirmada</>}</span>
          <span>Tela somente de leitura.</span>
        </div>
      </article>}
  </div>;
}
