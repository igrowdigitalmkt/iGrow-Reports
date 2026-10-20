"use client";

import type { ReactNode } from "react";
import { useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronDown, Info, ChevronUp, Columns3, Download, Pause, Pencil, Play, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { PeriodPicker } from "@/modules/client-portal/period-picker";
import "@/modules/client-portal/analytics-dashboard.css";
import "./campaigns.css";
import { stamp } from "./cells";
import { buildColumns, buildCostIndex, columnValue, DEFAULT_COLUMN_KEYS, resultFamilies, type ColumnDef } from "./columns";
import { applyColumnPreference, columnPreferenceKey, moveColumn, parseColumnPreference, serializeColumnPreference } from "./column-preferences";
import { DELIVERY_GROUPS, type DeliveryGroup } from "./delivery-state";
import { useLocalPreference, writeLocalPreference } from "./local-preference";
import { entityPath, periodSearch } from "./routes";
import { sortRows, type CampaignRow, type SortSpec } from "./tree";
import type { CampaignsData } from "./load";
import { BatchDialog } from "./navigation/batch-dialog";
import { buildCsv } from "./navigation/export-csv";
import { EditPanel } from "./navigation/edit-panel";
import { LevelTable } from "./navigation/level-table";
import { LevelTabs } from "./navigation/level-tabs";
import { clearSelection, entityKey, scopeDescription, scopeRows, selectionStorageKey, setSelected, reconcileSelection, type NavLevel } from "./navigation/selection";
import { useStoredSelection } from "./navigation/use-selection";
import { structureOf } from "./platforms/registry";
import { OperationsServicesContext, loadManualCapabilitiesAction } from "./manual/entity-operations";
import { GoogleAdsSection, type GoogleSectionView } from "@/modules/google-ads/google-section";
import { DEFAULT_PLATFORMS, PLATFORMS, PlatformPicker, type PlatformPreference } from "@/modules/client-portal/platform-picker";
import "./navigation/navigation.css";

export type SelectedEntity = { accountId: string; level: CampaignRow["level"]; id: string };

const LEVELS = structureOf("meta").levels;
/** Aba na URL (português, estável): trocar de aba não recarrega dados nem perde a seleção; voltar/avançar do navegador funcionam. */
const TAB_SLUGS: Record<NavLevel, string> = { campaign: "campanhas", adset: "conjuntos", ad: "anuncios" };
const LEVEL_BY_SLUG = Object.fromEntries(Object.entries(TAB_SLUGS).map(([level, slug]) => [slug, level as NavLevel])) as Record<string, NavLevel>;
const PAGE_SIZE = 100;
type ConfiguredFilter = "all" | "ACTIVE" | "PAUSED" | "other";
type LevelUi = { query: string; group: DeliveryGroup | "restricted" | "all"; configured: ConfiguredFilter; sort: SortSpec; page: number };
const INITIAL_UI: LevelUi = { query: "", group: "all", configured: "all", sort: { key: "name", direction: "asc" }, page: 0 };
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

export function CampaignsView({ clientId, clientName, intro, googleSections = [], googleFailures = [], platformKey, data, onlyActive, selected = null, onSelectEntity, preferenceKey }: {
  /** Cliente da rota: a tela nunca escolhe outro. */
  clientId: string; clientName?: string; /** Conteúdo exibido logo abaixo do cabeçalho do cliente (ex.: oportunidades). */ intro?: ReactNode; googleSections?: GoogleSectionView[]; googleFailures?: Array<{ name: string; message: string }>; platformKey?: string; data: CampaignsData; onlyActive: boolean;
  /** Entidade em análise pelo assistente (identidade completa: conta + nível + ID). Independe das caixas de seleção. */
  selected?: SelectedEntity | null; onSelectEntity?: (row: CampaignRow) => void;
  /** Chave da preferência local (organização + usuário). Sem ela, colunas e seleção não são salvas. */
  preferenceKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const level: NavLevel = LEVEL_BY_SLUG[searchParams.get("aba") ?? ""] ?? "campaign";
  const [uiByLevel, setUiByLevel] = useState<Record<NavLevel, LevelUi>>({ campaign: INITIAL_UI, adset: INITIAL_UI, ad: INITIAL_UI });
  const ui = uiByLevel[level];
  const patchUi = (patch: Partial<LevelUi>) => setUiByLevel(current => ({ ...current, [level]: { ...current[level], ...patch, ...("page" in patch ? {} : { page: 0 }) } }));
  const [accountDraft, setAccountDraft] = useState<string[] | null>(null);
  const [batch, setBatch] = useState<"pause" | "resume" | null>(null);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  // Operações novas (renomear e anúncios) só aparecem quando o servidor confirma que o banco as aceita (null enquanto consulta).
  const services = useContext(OperationsServicesContext);
  // Seleção e ordem das plataformas: a mesma preferência do painel do cliente (mesma chave), restaurada após a hidratação.
  const [platforms, setPlatforms] = useState<PlatformPreference[]>(DEFAULT_PLATFORMS);
  useEffect(() => {
    if (!platformKey) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(platformKey) ?? "null") as PlatformPreference[] | null;
      if (Array.isArray(saved) && saved.every(item => item && item.key in PLATFORMS)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restores a per-browser preference after hydration
        setPlatforms([...saved, ...DEFAULT_PLATFORMS.filter(item => !saved.some(entry => entry.key === item.key))]);
      }
    } catch { /* Preferências são opcionais. */ }
  }, [platformKey]);
  const changePlatforms = (next: PlatformPreference[]) => {
    setPlatforms(next);
    if (platformKey) try { window.localStorage.setItem(platformKey, JSON.stringify(next)); } catch { /* Preferências são opcionais. */ }
  };
  const platformOrder = (key: string) => 10 + platforms.findIndex(item => item.key === key);
  const metaVisible = platforms.some(item => item.key === "meta" && item.enabled);
  const googleVisible = platforms.some(item => item.key === "google" && item.enabled) && (googleSections.length > 0 || googleFailures.length > 0);
  const [extended, setExtended] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (services.capabilities ?? loadManualCapabilitiesAction)().then(result => { if (alive) setExtended(result.extended); }).catch(() => { if (alive) setExtended(false); });
    return () => { alive = false; };
  }, [services.capabilities]);

  // Seleção (por contexto) e escopo entre abas.
  const [storedSelection, writeSelection] = useStoredSelection(preferenceKey ? selectionStorageKey(preferenceKey, clientId, "meta") : null);
  const selection = useMemo(() => reconcileSelection(storedSelection, data.rows), [storedSelection, data.rows]);
  const change = (next: typeof selection) => writeSelection(reconcileSelection(next, data.rows));
  const selectedKeys = useMemo(() => new Set(selection[level]), [selection, level]);

  // Colunas por nível (campanhas mantêm a preferência anterior).
  const keyFor = (target: NavLevel) => preferenceKey ? columnPreferenceKey(target === "campaign" ? preferenceKey : `${preferenceKey}:${target}`) : null;
  const savedColumns: Record<NavLevel, string[] | null> = {
    campaign: parseColumnPreference(useLocalPreference(keyFor("campaign"))),
    adset: parseColumnPreference(useLocalPreference(keyFor("adset"))),
    ad: parseColumnPreference(useLocalPreference(keyFor("ad"))),
  };
  const [chosen, setChosen] = useState<Record<NavLevel, string[] | null>>({ campaign: null, adset: null, ad: null });
  const columnKeys = chosen[level] ?? savedColumns[level] ?? DEFAULT_COLUMN_KEYS;
  const updateColumns = (next: string[]) => { setChosen(current => ({ ...current, [level]: next })); const key = keyFor(level); if (key) writeLocalPreference(key, serializeColumnPreference(next)); };
  const restoreColumns = () => { setChosen(current => ({ ...current, [level]: DEFAULT_COLUMN_KEYS })); const key = keyFor(level); if (key) writeLocalPreference(key, null); };

  const navigate = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams({ periodo: data.period });
    if (data.period === "custom") { params.set("from", data.dateFrom); params.set("to", data.dateTo); }
    if (data.accounts.length > 1 && data.selectedAccountIds.length !== data.accounts.length) params.set("contas", data.selectedAccountIds.join(","));
    if (onlyActive) params.set("ativas", "1");
    if (level !== "campaign") params.set("aba", TAB_SLUGS[level]);
    for (const [key, value] of Object.entries(changes)) { if (value === null) params.delete(key); else params.set(key, value); }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };
  /** Troca de aba só no cliente (pushState): nenhum dado é recarregado e a seleção continua. */
  const goTo = (target: NavLevel) => {
    const params = new URLSearchParams(searchParams.toString());
    if (target === "campaign") params.delete("aba"); else params.set("aba", TAB_SLUGS[target]);
    const query = params.toString();
    window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
  };

  // Índices: nomes dos pais para colunas e busca; custo atribuído calculado sobre TODAS as linhas.
  const byKey = useMemo(() => new Map(data.rows.map(row => [entityKey(row), row] as const)), [data.rows]);
  const campaignOf = useCallback((row: CampaignRow) => {
    const id = row.level === "campaign" ? row.id : row.level === "adset" ? row.campaignId ?? row.parentId : row.campaignId;
    return id ? byKey.get(`${row.accountId}|campaign|${id}`) ?? null : null;
  }, [byKey]);
  const adsetOf = useCallback((row: CampaignRow) => row.level === "ad" && row.parentId ? byKey.get(`${row.accountId}|adset|${row.parentId}`) ?? null : null, [byKey]);
  const campaignName = useCallback((row: CampaignRow) => row.level === "campaign" ? null : campaignOf(row)?.name ?? null, [campaignOf]);
  const adsetName = useCallback((row: CampaignRow) => adsetOf(row)?.name ?? null, [adsetOf]);
  const costIndex = useMemo(() => buildCostIndex(data.rows), [data.rows]);
  const catalog = useMemo(() => buildColumns(data.metrics, resultFamilies(data.rows)), [data.metrics, data.rows]);
  const columns = useMemo(() => applyColumnPreference(catalog, columnKeys), [catalog, columnKeys]);
  const valueOf = useCallback((row: CampaignRow, key: string) => columnValue(row, key, costIndex), [costIndex]);

  // Linhas do nível ativo: escopo da seleção › busca (nome, conjunto e campanha) › estados › ordem.
  const scoped = useMemo(() => scopeRows(level, data.rows, selection), [level, data.rows, selection]);
  const filtered = useMemo(() => {
    const query = fold(ui.query.trim());
    return scoped.filter(row => {
      if (query && !fold([row.name, adsetName(row), campaignName(row)].filter(Boolean).join(" ")).includes(query)) return false;
      if (ui.group === "restricted" ? !row.state.restrictions.length : ui.group !== "all" && row.state.group !== ui.group) return false;
      const configured = row.state.configured?.code ?? null;
      if (ui.configured === "ACTIVE" || ui.configured === "PAUSED") return configured === ui.configured;
      if (ui.configured === "other") return configured !== "ACTIVE" && configured !== "PAUSED";
      return true;
    });
  }, [scoped, ui.query, ui.group, ui.configured, adsetName, campaignName]);
  const sorted = useMemo(() => sortRows(filtered, ui.sort, valueOf), [filtered, ui.sort, valueOf]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(ui.page, pageCount - 1);
  const pageRows = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const counts = useMemo(() => {
    const total = new Map<DeliveryGroup | "restricted", number>();
    for (const row of scoped) {
      total.set(row.state.group, (total.get(row.state.group) ?? 0) + 1);
      if (row.state.restrictions.length) total.set("restricted", (total.get("restricted") ?? 0) + 1);
    }
    return total;
  }, [scoped]);
  const levelCounts = useMemo(() => ({ campaign: scopeRows("campaign", data.rows, selection).length, adset: scopeRows("adset", data.rows, selection).length, ad: scopeRows("ad", data.rows, selection).length }), [data.rows, selection]);
  const picked = { campaign: selection.campaign.length, adset: selection.adset.length, ad: selection.ad.length };
  const pickedRows = useMemo(() => sorted.filter(row => selectedKeys.has(entityKey(row))), [sorted, selectedKeys]);
  const filtering = ui.query.trim() !== "" || ui.group !== "all" || ui.configured !== "all";
  const allFilteredPicked = sorted.length > 0 && sorted.every(row => selectedKeys.has(entityKey(row)));
  const pageAllPicked = pageRows.length > 0 && pageRows.every(row => selectedKeys.has(entityKey(row)));
  const draft = accountDraft ?? data.selectedAccountIds;
  const detailSearch = periodSearch(data);
  const scopeText = scopeDescription(level, selection);
  const levelLabel = LEVELS.find(item => item.key === level)!;

  const sortBy = (key: string) => patchUi({ sort: { key, direction: ui.sort.key === key && ui.sort.direction === "asc" ? "desc" : "asc" } });
  const toggleRow = (row: CampaignRow, on: boolean) => change(setSelected(selection, data.rows, level, [entityKey(row)], on));
  const togglePage = (on: boolean) => change(setSelected(selection, data.rows, level, pageRows.map(entityKey), on));
  const exportCsv = () => {
    const parentNames = new Map(sorted.flatMap(row => { const parent = level === "ad" ? adsetOf(row) : level === "adset" ? campaignOf(row) : null; return parent ? [[entityKey(row), parent.name] as const] : []; }));
    const csv = buildCsv({ level, rows: sorted, columns, index: costIndex, parentNames: new Map([...parentNames].map(([key, value]) => [key, value])) });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${TAB_SLUGS[level]}-${data.dateFrom}_${data.dateTo}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const shown = columns.map(column => column.key);
  const moveShown = (key: string, direction: -1 | 1) => updateColumns([...moveColumn(shown, key, direction), ...columnKeys.filter(item => !shown.includes(item))]);
  const metricColumns = catalog.filter(column => column.group === "base" || column.key === "results" || column.key === "cost_result");
  const typeColumns = catalog.filter(column => column.key.startsWith("result:") || column.key.startsWith("cost:"));
  const referenceColumns = catalog.filter(column => column.key.startsWith("event:"));
  const columnRow = (column: ColumnDef) => <label key={column.key} title={column.hint}>
    <input type="checkbox" checked={shown.includes(column.key)} disabled={shown.includes(column.key) && shown.length === 1}
      onChange={() => updateColumns(shown.includes(column.key) ? columnKeys.filter(key => key !== column.key) : [...columnKeys.filter(key => key !== column.key), column.key])} />
    <span>{column.label}</span></label>;

  const one = pickedRows.length === 1 ? pickedRows[0]! : null;
  const operable = (level !== "ad" || extended === true) && pickedRows.length > 0;
  const adBlocked = level === "ad" && extended !== true;
  const emptyText = filtering ? "Nenhum item corresponde à busca e aos filtros."
    : scopeText ? `${scopeText}: nenhum item encontrado neste escopo.`
    : onlyActive ? "Nenhuma entidade em veiculação ou com gasto neste período. Desmarque o filtro para ver as demais."
    : `Nenhum item encontrado para as contas selecionadas.`;

  return <div className={`campaigns-page${pending ? " is-pending" : ""}`} aria-busy={pending}>
    <header className="analytics-header">
      <div className="analytics-identity">
        <span className="client-avatar large blue" aria-hidden="true">{(clientName ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
        <div><h1>{clientName ?? "Campanhas"}</h1><p>Campanhas, conjuntos e anúncios · estrutura e veiculação</p></div>
      </div>
      <div className="analytics-command-actions"><PlatformPicker value={platforms} onChange={changePlatforms} />
        <PeriodPicker period={data.period} dateFrom={data.dateFrom} dateTo={data.dateTo} today={data.today} disabled={pending}
          onApply={selection => navigate(selection.period === "custom" ? { periodo: "custom", from: selection.from, to: selection.to } : { periodo: selection.period, from: null, to: null })} /></div>
    </header>
    {intro}
    {metaVisible && <section className="platform-section" aria-label="Meta Ads" style={{ order: platformOrder("meta") }}>
      <div className="platform-heading"><span className="platform-mark is-meta" aria-hidden="true">∞</span><h2>Meta Ads</h2><span className="platform-heading-meta">{data.selectedAccountIds.length} {data.selectedAccountIds.length === 1 ? "conta" : "contas"}{data.selectedAccountIds.length < data.accounts.length ? ` de ${data.accounts.length}` : ""}</span>
        {data.state === "ready" && data.warnings.length > 0 && <details className="analytics-quality-menu">
          <summary><Info size={13} />Qualidade dos dados <span className="analytics-count">{data.warnings.length}</span></summary>
          <div>{data.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
        </details>}
      {data.accounts.length > 1 && <div className="platform-heading-actions">
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
      </div>
    <div className="campaigns-toolbar">
      <label className="campaigns-field"><span>Veiculação (estado efetivo)</span>
        <Select className="compact-select campaigns-select" value={ui.group} aria-label="Filtrar por estado efetivo" onChange={event => patchUi({ group: event.target.value as LevelUi["group"] })}>
          <option value="all">Todos os estados</option>
          {DELIVERY_GROUPS.filter(item => counts.get(item.key)).map(item => <option key={item.key} value={item.key}>{item.label} ({counts.get(item.key)})</option>)}
          {!!counts.get("restricted") && <option value="restricted">Com restrição de entrega ({counts.get("restricted")})</option>}
        </Select></label>
      <label className="campaigns-field"><span>Estado configurado</span>
        <Select className="compact-select campaigns-select" value={ui.configured} aria-label="Filtrar por estado configurado" onChange={event => patchUi({ configured: event.target.value as ConfiguredFilter })}>
          <option value="all">Todos</option><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option><option value="other">Outros</option>
        </Select></label>
      <label className="campaigns-check campaigns-only-active"><input type="checkbox" checked={onlyActive} disabled={pending} onChange={event => navigate({ ativas: event.target.checked ? "1" : null })} />Somente com gasto ou em veiculação</label>
      <label className="campaigns-field campaigns-search"><span>Busca</span>
        <div className="campaigns-search-box"><Search size={14} />
          <input type="search" value={ui.query} onChange={event => patchUi({ query: event.target.value })} placeholder={level === "campaign" ? "Buscar por nome" : level === "adset" ? "Buscar por nome ou campanha" : "Buscar por nome, conjunto ou campanha"} aria-label="Buscar" />
          {ui.query && <button type="button" aria-label="Limpar busca" onClick={() => patchUi({ query: "" })}><X size={13} /></button>}</div></label>
    </div>

    {data.message && <p className="campaigns-alert" role="alert">{data.message}</p>}
    {data.state === "ready" && data.metricsState === "pending" && <p className="campaigns-alert is-info" role="status">Campanhas carregadas. As métricas deste período ainda estão sendo atualizadas; por enquanto os valores aparecem como indisponíveis (—), não como zero.</p>}

    {data.state !== "ready" ? <div className="campaigns-empty"><strong>{data.state === "no-accounts" ? "Nenhuma conta vinculada" : data.state === "blocked" ? "Campanhas ainda indisponíveis" : "Campanhas indisponíveis"}</strong></div>
      : <article className="analytics-card campaigns-card">
        <LevelTabs levels={LEVELS} active={level} counts={levelCounts} picked={picked} onChange={key => goTo(key as NavLevel)} />
        <div className="level-actionbar" role="toolbar" aria-label={`Ações de ${levelLabel.label.toLocaleLowerCase("pt-BR")}`}>
          {pickedRows.length > 0 ? <>
            <span className="level-selection-summary"><strong>{pickedRows.length}</strong> {pickedRows.length === 1 ? "selecionado" : "selecionados"}</span>
            <button type="button" className="ops-btn" disabled={!one || adBlocked} title={adBlocked ? "Edição de anúncios depende da atualização do banco, ainda não aplicada neste ambiente. Abra os detalhes para consultar." : !one ? "Selecione uma única entidade para editar. Para vários itens use Pausar ou Retomar." : "Editar"} onClick={() => one && setEditing(one)}><Pencil size={14} />Editar</button>
            {adBlocked && <span className="level-selection-summary" role="status">Operações em anúncios aguardam a atualização do banco neste ambiente.</span>}
            {operable && <>
              <button type="button" className="ops-btn" onClick={() => setBatch("pause")}><Pause size={14} />Pausar{pickedRows.length > 1 ? ` (${pickedRows.length})` : ""}</button>
              <button type="button" className="ops-btn" onClick={() => setBatch("resume")}><Play size={14} />Retomar{pickedRows.length > 1 ? ` (${pickedRows.length})` : ""}</button></>}
            <Link className={`ops-btn${one ? "" : " is-disabled"}`} aria-disabled={!one} tabIndex={one ? 0 : -1} href={one ? `${entityPath(clientId, one)}${detailSearch}` : "#"} prefetch={false} onClick={event => { if (!one) event.preventDefault(); }} title={one ? "Abrir detalhes" : "Selecione uma única entidade"}><ArrowUpRight size={14} />Detalhes</Link>
            {onSelectEntity && <button type="button" className="ops-btn" disabled={!one} title={one ? "Definir como contexto do Assistente Groow" : "O assistente analisa uma entidade por vez: use o ícone de brilho na linha."} onClick={() => one && onSelectEntity(one)}><Sparkles size={14} />Analisar com IA</button>}
          </> : <span className="level-selection-summary">Selecione itens com as caixas para editar, pausar ou retomar. O nome abre os detalhes.</span>}
          <span className="level-actionbar-spacer" />
          <span className="level-selection-summary">{(["campaign", "adset", "ad"] as const).filter(key => picked[key] > 0).map(key => <button key={key} type="button" className="level-chip" onClick={() => goTo(key)} title="Ir para esta aba">{picked[key]} {key === "campaign" ? (picked[key] === 1 ? "campanha" : "campanhas") : key === "adset" ? (picked[key] === 1 ? "conjunto" : "conjuntos") : (picked[key] === 1 ? "anúncio" : "anúncios")}</button>)}
            {picked.campaign + picked.adset + picked.ad > 0 && <button type="button" className="level-chip" onClick={() => change(clearSelection())}><X size={11} />Limpar seleções</button>}</span>
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
          <button type="button" className="ops-btn" disabled={!sorted.length} onClick={exportCsv} title="Exporta todos os resultados filtrados deste nível, com as colunas escolhidas"><Download size={14} />Exportar</button>
        </div>

        {scopeText && <p className="level-scope" role="status">{scopeText}. <button type="button" className="campaigns-link" onClick={() => change(clearSelection())}>Limpar seleções</button></p>}
        {pageAllPicked && sorted.length > pageRows.length && !allFilteredPicked && <p className="level-select-banner" role="status">Esta página está selecionada ({pageRows.length}). <button type="button" onClick={() => change(setSelected(selection, data.rows, level, sorted.map(entityKey), true))}>Selecionar todos os {sorted.length} resultados filtrados</button></p>}
        {allFilteredPicked && sorted.length > pageRows.length && <p className="level-select-banner" role="status">Todos os {sorted.length} resultados filtrados estão selecionados. <button type="button" onClick={() => change(setSelected(selection, data.rows, level, sorted.map(entityKey), false))}>Limpar esta seleção</button></p>}

        <div role="tabpanel" id={`level-panel-${level}`} aria-labelledby={`level-tab-${level}`}>
          <LevelTable level={level} rows={pageRows} columns={columns} index={costIndex} selected={selectedKeys} onToggle={toggleRow} onTogglePage={togglePage}
            clientId={clientId} detailSearch={detailSearch} analyzing={selected} onAnalyze={onSelectEntity} campaignName={campaignName} adsetName={adsetName} sort={ui.sort} onSort={sortBy} />
        </div>
        {!sorted.length && <p className="analytics-empty-copy">{emptyText}</p>}
        {sorted.length > PAGE_SIZE && <div className="level-pager"><span>{page * PAGE_SIZE + 1}–{Math.min(sorted.length, (page + 1) * PAGE_SIZE)} de {sorted.length}{filtering ? " (filtrados)" : ""}</span>
          <span><button type="button" disabled={page === 0} onClick={() => patchUi({ page: page - 1 })}>Anterior</button> <button type="button" disabled={page >= pageCount - 1} onClick={() => patchUi({ page: page + 1 })}>Próxima</button></span></div>}
        <div className="campaigns-freshness">
          <span>{data.metricsState === "pending" ? <><i className="is-warn" aria-hidden="true" />Métricas de {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateFrom}T12:00:00Z`))} a {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateTo}T12:00:00Z`))} ainda não confirmadas (coleta em andamento)</> : <><i className="is-ok" aria-hidden="true" />Métricas históricas confirmadas para {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateFrom}T12:00:00Z`))} a {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${data.dateTo}T12:00:00Z`))}{data.latestCollectedAt ? ` · coleta em ${stamp(data.latestCollectedAt)}` : ""}</>}</span>
          <span>{data.live.state === "ok" && data.live.checkedAt ? <><i className="is-ok" aria-hidden="true" />Estado atual consultado na Meta em {stamp(data.live.checkedAt)}{data.live.cached ? " (leitura reaproveitada, até 45 s)" : ""}</>
            : data.live.state === "partial" && data.live.checkedAt ? <><i className="is-warn" aria-hidden="true" />Estado atual consultado em {data.live.accountsRead} de {data.live.accountsTotal} contas ({stamp(data.live.checkedAt)})</>
            : <><i className="is-bad" aria-hidden="true" />Estado atual na Meta indisponível: veiculação não confirmada</>}</span>
          <span>Configurado como ativo não garante entrega: veja o estado efetivo e as restrições. Toda alteração é revalidada na Meta antes do envio.</span>
        </div>
      </article>}

    </section>}
    {googleVisible && <GoogleAdsSection sections={googleSections} failures={googleFailures} order={platformOrder("google")} />}
    {!metaVisible && !googleVisible && <div className="campaigns-empty"><strong>Nenhuma plataforma selecionada</strong><p>Escolha ao menos uma em Plataformas.</p></div>}
    {batch && <BatchDialog op={batch} rows={pickedRows} clientId={clientId} onClose={() => setBatch(null)} onDone={verified => { if (verified > 0) router.refresh(); }} />}
    {editing && <EditPanel row={editing} clientId={clientId} detailSearch={detailSearch} onClose={() => setEditing(null)} onChanged={() => router.refresh()}
      onViewChildren={editing.level === "campaign" ? () => { setEditing(null); goTo("adset"); } : undefined} />}
  </div>;
}
