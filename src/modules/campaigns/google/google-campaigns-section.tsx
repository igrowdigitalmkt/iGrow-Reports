"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Columns3, Download, Search, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { SectionToggle } from "@/modules/client-portal/section-toggle";
import { PlatformLogo } from "@/modules/platforms/platform-logo";
import type { GoogleCampaignsData } from "@/modules/google-ads/provider";
import "@/modules/client-portal/analytics-dashboard.css";
import "../campaigns.css";
import "../navigation/navigation.css";
import { stamp } from "../cells";
import { buildColumns, buildCostIndex, DEFAULT_COLUMN_KEYS, priorityValue, resultFamilies, sortValue, type ColumnDef } from "../columns";
import { applyColumnPreference, columnPreferenceKey, moveColumn, parseColumnPreference, serializeColumnPreference } from "../column-preferences";
import { DELIVERY_GROUPS, type DeliveryGroup } from "../delivery-state";
import { useLocalPreference, writeLocalPreference } from "../local-preference";
import { buildCsv } from "../navigation/export-csv";
import { LevelTable, type LevelTerms } from "../navigation/level-table";
import { LevelTabs } from "../navigation/level-tabs";
import { sortRows, type CampaignRow, type SortSpec } from "../tree";
import type { PlatformLevel } from "../platforms/registry";

type Level = CampaignRow["level"];
const PAGE_SIZE = 100;
const LEVELS: PlatformLevel[] = [
  { key: "campaign", label: "Campanhas", singular: "Campanha", parent: null },
  { key: "adset", label: "Grupos de anúncios", singular: "Grupo de anúncios", parent: "campaign" },
  { key: "ad", label: "Anúncios", singular: "Anúncio", parent: "adset" },
];
const TERMS: LevelTerms = { name: { campaign: "Campanha", adset: "Grupo de anúncios", ad: "Anúncio" }, adset: "Grupo de anúncios", campaign: "Campanha" };
const SLUG: Record<Level, string> = { campaign: "campanhas", adset: "grupos-de-anuncios", ad: "anuncios" };
const STATE_ORDER = ["active", "paused", "review", "rejected", "other", "unavailable"];
type ConfiguredFilter = "all" | "ACTIVE" | "PAUSED" | "other";
type Ui = { query: string; group: DeliveryGroup | "all"; configured: ConfiguredFilter; onlyActive: boolean; sort: SortSpec; page: number };
const INITIAL: Ui = { query: "", group: "all", configured: "all", onlyActive: false, sort: { key: "priority", direction: "asc" }, page: 0 };
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
const date = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/**
 * Google Ads em Campanhas, no mesmo formato da Meta: abas Campanhas › Grupos de anúncios › Anúncios, filtros de veiculação, busca,
 * colunas escolhidas pelo usuário, ordenação e exportação. SOMENTE LEITURA: pausar, retomar e editar no Google ainda não existem na Groow.
 */
export function GoogleCampaignsSection({ data, order, collapsed, onToggle, dateFrom, dateTo, preferenceKey }: {
  data: GoogleCampaignsData; order?: number; collapsed: boolean; onToggle: () => void; dateFrom: string; dateTo: string; preferenceKey?: string;
}) {
  const [level, setLevel] = useState<Level>("campaign");
  const [uiByLevel, setUiByLevel] = useState<Record<Level, Ui>>({ campaign: INITIAL, adset: INITIAL, ad: INITIAL });
  const ui = uiByLevel[level];
  const patchUi = (patch: Partial<Ui>) => setUiByLevel(current => ({ ...current, [level]: { ...current[level], ...patch, ...("page" in patch ? {} : { page: 0 }) } }));

  const keyFor = (target: Level) => preferenceKey ? columnPreferenceKey(`${preferenceKey}:google:${target}`) : null;
  const saved: Record<Level, string[] | null> = {
    campaign: parseColumnPreference(useLocalPreference(keyFor("campaign"))),
    adset: parseColumnPreference(useLocalPreference(keyFor("adset"))),
    ad: parseColumnPreference(useLocalPreference(keyFor("ad"))),
  };
  const [chosen, setChosen] = useState<Record<Level, string[] | null>>({ campaign: null, adset: null, ad: null });
  const columnKeys = chosen[level] ?? saved[level] ?? DEFAULT_COLUMN_KEYS;
  const updateColumns = (next: string[]) => { setChosen(current => ({ ...current, [level]: next })); const key = keyFor(level); if (key) writeLocalPreference(key, serializeColumnPreference(next)); };
  const restoreColumns = () => { setChosen(current => ({ ...current, [level]: DEFAULT_COLUMN_KEYS })); const key = keyFor(level); if (key) writeLocalPreference(key, null); };

  const rows = data.rows;
  const byKey = useMemo(() => new Map(rows.map(row => [`${row.accountId}|${row.level}|${row.id}`, row] as const)), [rows]);
  const campaignOf = useCallback((row: CampaignRow) => {
    const id = row.level === "campaign" ? row.id : row.campaignId ?? row.parentId;
    return id ? byKey.get(`${row.accountId}|campaign|${id}`) ?? null : null;
  }, [byKey]);
  const adsetOf = useCallback((row: CampaignRow) => row.level === "ad" && row.parentId ? byKey.get(`${row.accountId}|adset|${row.parentId}`) ?? null : null, [byKey]);
  const campaignName = useCallback((row: CampaignRow) => row.level === "campaign" ? null : campaignOf(row)?.name ?? null, [campaignOf]);
  const adsetName = useCallback((row: CampaignRow) => adsetOf(row)?.name ?? null, [adsetOf]);
  const costIndex = useMemo(() => buildCostIndex(rows), [rows]);
  const catalog = useMemo(() => buildColumns(data.metrics, resultFamilies(rows)), [data.metrics, rows]);
  const columns = useMemo(() => applyColumnPreference(catalog, columnKeys), [catalog, columnKeys]);
  const valueOf = useCallback((row: CampaignRow, key: string) => key === "priority" ? priorityValue(row.state)
    : key === "state" ? STATE_ORDER.indexOf(row.state.group) : sortValue(row, key, costIndex), [costIndex]);

  const scoped = useMemo(() => rows.filter(row => row.level === level), [rows, level]);
  const filtered = useMemo(() => {
    const query = fold(ui.query.trim());
    return scoped.filter(row => {
      if (query && !fold([row.name, adsetName(row), campaignName(row)].filter(Boolean).join(" ")).includes(query)) return false;
      if (ui.group !== "all" && row.state.group !== ui.group) return false;
      const configured = row.state.configured?.code ?? null;
      if (ui.configured === "ACTIVE" || ui.configured === "PAUSED") { if (configured !== ui.configured) return false; }
      else if (ui.configured === "other" && (configured === "ACTIVE" || configured === "PAUSED")) return false;
      if (ui.onlyActive && !(row.state.group === "active" || (row.values.spend ?? 0) > 0)) return false;
      return true;
    });
  }, [scoped, ui, adsetName, campaignName]);
  const sorted = useMemo(() => sortRows(filtered, ui.sort, valueOf), [filtered, ui.sort, valueOf]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(ui.page, pageCount - 1);
  const pageRows = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const counts = useMemo(() => { const total = new Map<DeliveryGroup, number>(); for (const row of scoped) total.set(row.state.group, (total.get(row.state.group) ?? 0) + 1); return total; }, [scoped]);
  const levelCounts = useMemo(() => ({ campaign: rows.filter(row => row.level === "campaign").length, adset: rows.filter(row => row.level === "adset").length, ad: rows.filter(row => row.level === "ad").length }), [rows]);
  const filtering = ui.query.trim() !== "" || ui.group !== "all" || ui.configured !== "all" || ui.onlyActive;

  const sortBy = (key: string) => patchUi({ sort: { key, direction: ui.sort.key === key && ui.sort.direction === "asc" ? "desc" : "asc" } });
  const exportCsv = () => {
    const parentNames = new Map(sorted.flatMap(row => { const parent = level === "ad" ? adsetOf(row) : level === "adset" ? campaignOf(row) : null; return parent ? [[`${row.accountId}|${row.level}|${row.id}`, parent.name] as const] : []; }));
    const csv = buildCsv({ level, rows: sorted, columns, index: costIndex, parentNames });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `google-ads-${SLUG[level]}-${dateFrom}_${dateTo}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const shown = columns.map(column => column.key);
  const moveShown = (key: string, direction: -1 | 1) => updateColumns([...moveColumn(shown, key, direction), ...columnKeys.filter(item => !shown.includes(item))]);
  const metricColumns = catalog.filter(column => column.group === "base" || column.key === "results" || column.key === "cost_result");
  const typeColumns = catalog.filter(column => column.key.startsWith("result:") || column.key.startsWith("cost:"));
  const columnRow = (column: ColumnDef) => <label key={column.key} title={column.hint}>
    <input type="checkbox" checked={shown.includes(column.key)} disabled={shown.includes(column.key) && shown.length === 1}
      onChange={() => updateColumns(shown.includes(column.key) ? columnKeys.filter(key => key !== column.key) : [...columnKeys.filter(key => key !== column.key), column.key])} />
    <span>{column.label}</span></label>;
  const levelLabel = LEVELS.find(item => item.key === level)!;
  const emptyText = filtering ? "Nenhum item corresponde à busca e aos filtros." : "Nenhum item encontrado para as contas do Google Ads.";

  return <section className="platform-section" aria-label="Google Ads" style={order === undefined ? undefined : { order }}>
    <div className="platform-heading"><SectionToggle collapsed={collapsed} label="Google Ads" onToggle={onToggle} /><PlatformLogo platform="google" /><h2>Google Ads</h2>
      <span className="platform-heading-meta">{data.accounts.length} {data.accounts.length === 1 ? "conta" : "contas"}</span></div>
    {!collapsed && <>
      {data.failures.map(failure => <p key={failure.name} className="campaigns-alert" role="alert">Não foi possível ler a conta {failure.name} agora. {failure.message}</p>)}
      <div className="campaigns-toolbar">
        <label className="campaigns-field"><span>Veiculação (estado efetivo)</span>
          <Select className="compact-select campaigns-select" value={ui.group} aria-label="Filtrar por estado efetivo" onChange={event => patchUi({ group: event.target.value as Ui["group"] })}>
            <option value="all">Todos os estados</option>
            {DELIVERY_GROUPS.filter(item => counts.get(item.key)).map(item => <option key={item.key} value={item.key}>{item.label} ({counts.get(item.key)})</option>)}
          </Select></label>
        <label className="campaigns-field"><span>Estado configurado</span>
          <Select className="compact-select campaigns-select" value={ui.configured} aria-label="Filtrar por estado configurado" onChange={event => patchUi({ configured: event.target.value as ConfiguredFilter })}>
            <option value="all">Todos</option><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option><option value="other">Outros</option>
          </Select></label>
        <label className="campaigns-check campaigns-only-active"><input type="checkbox" checked={ui.onlyActive} onChange={event => patchUi({ onlyActive: event.target.checked })} />Somente com gasto ou em veiculação</label>
        <label className="campaigns-field campaigns-search"><span>Busca</span>
          <div className="campaigns-search-box"><Search size={14} />
            <input type="search" value={ui.query} onChange={event => patchUi({ query: event.target.value })} placeholder={level === "campaign" ? "Buscar por nome" : level === "adset" ? "Buscar por nome ou campanha" : "Buscar por nome, grupo ou campanha"} aria-label="Buscar no Google Ads" />
            {ui.query && <button type="button" aria-label="Limpar busca" onClick={() => patchUi({ query: "" })}><X size={13} /></button>}</div></label>
      </div>
      <article className="analytics-card campaigns-card">
        <LevelTabs levels={LEVELS} active={level} counts={levelCounts} onChange={key => setLevel(key as Level)} idPrefix="google-level" label="Níveis do Google Ads" />
        <div className="level-actionbar" role="toolbar" aria-label={`Ações de ${levelLabel.label.toLocaleLowerCase("pt-BR")}`}>
          <span className="level-selection-summary">Somente leitura: pausar, retomar e editar campanhas do Google Ads ainda não estão disponíveis na Groow.</span>
          <span className="level-actionbar-spacer" />
          <details className="campaigns-columns">
            <summary><Columns3 size={14} />Colunas <span className="analytics-count">{columns.length}</span></summary>
            <div className="campaigns-columns-list">
              <strong>Ordem na tabela</strong>
              <ol className="campaigns-column-order">{columns.map((column, position) => <li key={column.key}><span>{column.label}</span>
                <button type="button" disabled={position === 0} aria-label={`Mover ${column.label} para a esquerda`} onClick={() => moveShown(column.key, -1)}><ChevronUp size={13} /></button>
                <button type="button" disabled={position === columns.length - 1} aria-label={`Mover ${column.label} para a direita`} onClick={() => moveShown(column.key, 1)}><ChevronDown size={13} /></button></li>)}</ol>
              <strong>Métricas</strong>{metricColumns.map(columnRow)}
              {typeColumns.length > 0 && <><strong>Resultados e custo atribuído, por tipo</strong><p>O custo atribuído usa apenas o investimento do seu tipo de resultado.</p>{typeColumns.map(columnRow)}</>}
              <button type="button" className="campaigns-link" onClick={restoreColumns}>Restaurar padrão</button>
            </div>
          </details>
          <button type="button" className="ops-btn" disabled={!sorted.length} onClick={exportCsv} title="Exporta todos os resultados filtrados deste nível, com as colunas escolhidas"><Download size={14} />Exportar</button>
        </div>
        <div role="tabpanel" id={`google-level-panel-${level}`} aria-labelledby={`google-level-tab-${level}`}>
          <LevelTable level={level} rows={pageRows} columns={columns} index={costIndex} selected={new Set()} onToggle={() => undefined} onTogglePage={() => undefined}
            clientId="" detailSearch="" analyzing={null} campaignName={campaignName} adsetName={adsetName} sort={ui.sort} onSort={sortBy} readOnly terms={TERMS} />
        </div>
        {!sorted.length && <p className="analytics-empty-copy">{emptyText}</p>}
        {sorted.length > PAGE_SIZE && <div className="level-pager"><span>{page * PAGE_SIZE + 1}–{Math.min(sorted.length, (page + 1) * PAGE_SIZE)} de {sorted.length}{filtering ? " (filtrados)" : ""}</span>
          <span><button type="button" disabled={page === 0} onClick={() => patchUi({ page: page - 1 })}>Anterior</button> <button type="button" disabled={page >= pageCount - 1} onClick={() => patchUi({ page: page + 1 })}>Próxima</button></span></div>}
        <div className="campaigns-freshness">
          <span><i className="is-ok" aria-hidden="true" />Métricas de {date(dateFrom)} a {date(dateTo)} lidas direto do Google Ads em {stamp(data.readAt)}</span>
          <span>O estado do grupo de anúncios e do anúncio considera também o estado da campanha e do grupo acima deles.</span>
        </div>
      </article>
    </>}
  </section>;
}
