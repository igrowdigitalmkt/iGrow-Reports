"use client";

import { SortHeader, ariaSort } from "@/components/ui/sort-header";
import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Cell, LEVEL_LABELS } from "../cells";
import type { ColumnDef, CostIndex } from "../columns";
import { entityPath } from "../routes";
import type { CampaignRow, SortSpec } from "../tree";
import { entityKey } from "./selection";

const NAME_HEADER: Record<CampaignRow["level"], string> = { campaign: "Campanha", adset: "Conjunto de anúncios", ad: "Anúncio" };

/**
 * Tabela de UM nível (campanhas, conjuntos ou anúncios). Três ações distintas por linha, nunca confundidas:
 * 1) caixa de seleção = seleciona para filtros contextuais e operações (não abre nada e não chama a IA);
 * 2) nome = abre a página de detalhes;
 * 3) ícone de brilho = define a entidade como contexto do Assistente Groow (uma por vez).
 */
export function LevelTable({ level, rows, columns, index, selected, onToggle, onTogglePage, clientId, detailSearch, analyzing, onAnalyze, campaignName, adsetName, sort, onSort }: {
  level: CampaignRow["level"]; rows: CampaignRow[]; columns: ColumnDef[]; index: CostIndex;
  selected: Set<string>; onToggle: (row: CampaignRow, on: boolean) => void; onTogglePage: (on: boolean) => void;
  clientId: string; detailSearch: string; analyzing: { accountId: string; level: CampaignRow["level"]; id: string } | null; onAnalyze?: (row: CampaignRow) => void;
  campaignName: (row: CampaignRow) => string | null; adsetName: (row: CampaignRow) => string | null;
  sort: SortSpec; onSort: (key: string) => void;
}) {
  const allSelected = rows.length > 0 && rows.every(row => selected.has(entityKey(row)));
  const someSelected = !allSelected && rows.some(row => selected.has(entityKey(row)));
  const head = useRef<HTMLInputElement>(null);
  useEffect(() => { if (head.current) head.current.indeterminate = someSelected; }, [someSelected]);
  const aria = (key: string) => ariaSort(sort.key === key, sort.direction);
  const header = (key: string, label: string) => <SortHeader label={label} active={sort.key === key} direction={sort.direction} onSort={() => onSort(key)} />;
  const span = columns.length + 3 + (level === "campaign" ? 0 : level === "adset" ? 1 : 2);

  return <div className="analytics-table-scroll is-capped"><table className="analytics-table analytics-campaign-table level-table" aria-label={`Tabela de ${NAME_HEADER[level].toLocaleLowerCase("pt-BR")}`}>
    <thead><tr>
      <th scope="col" className="level-check"><input ref={head} type="checkbox" checked={allSelected} aria-label="Selecionar esta página" disabled={!rows.length} onChange={event => onTogglePage(event.target.checked)} /></th>
      <th scope="col" className="analytics-campaign-main-header" aria-sort={aria("name")}>{header("name", NAME_HEADER[level])}</th>
      {level === "ad" && <th scope="col" className="level-parent">Conjunto</th>}
      {level !== "campaign" && <th scope="col" className="level-parent">Campanha</th>}
      <th scope="col" className="campaign-state-head" aria-sort={aria("state")}>{header("state", "Veiculação")}</th>
      {columns.map(column => <th scope="col" key={column.key} data-col={column.key} title={column.hint} aria-sort={column.sortable ? aria(column.key) : undefined}>{column.sortable
        ? header(column.key, column.label) : column.label}</th>)}
    </tr></thead>
    <tbody>{rows.map(row => {
      const key = entityKey(row);
      const isSelected = selected.has(key);
      const isAnalyzing = !!analyzing && analyzing.accountId === row.accountId && analyzing.level === row.level && analyzing.id === row.id;
      return <tr key={key} className={`${isSelected ? "is-selected" : ""}${isAnalyzing ? " is-context" : ""}`}>
        <td className="level-check"><input type="checkbox" checked={isSelected} aria-label={`Selecionar ${row.name}`} onChange={event => onToggle(row, event.target.checked)} /></td>
        <th scope="row"><div className="analytics-campaign-name">
          {level === "ad" && (row.thumbnailUrl
            ? <Image className="analytics-ad-thumbnail" src={row.thumbnailUrl} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />
            : <span className="analytics-ad-thumbnail-placeholder" title="Imagem não retornada pela Meta">—</span>)}
          <div className="level-name"><Link className="level-link" href={`${entityPath(clientId, row)}${detailSearch}`} prefetch={false} title={`Abrir detalhes (${LEVEL_LABELS[row.level].toLocaleLowerCase("pt-BR")})`}><strong>{row.name}</strong></Link>
            <small>{row.accountName}</small></div>
          {onAnalyze && <button type="button" className={`level-analyze${isAnalyzing ? " is-on" : ""}`} aria-pressed={isAnalyzing} onClick={() => onAnalyze(row)}
            aria-label={isAnalyzing ? `Voltar ao contexto geral do assistente (analisando ${row.name})` : `Analisar com o Assistente Groow: ${row.name}`}
            title={isAnalyzing ? "Em análise pelo assistente. Clique para voltar ao contexto geral." : "Analisar com o Assistente Groow (uma entidade por vez)"}><Sparkles size={14} /></button>}
        </div></th>
        {level === "ad" && <td className="level-parent">{adsetName(row) ?? "—"}</td>}
        {level !== "campaign" && <td className="level-parent">{campaignName(row) ?? "—"}</td>}
        <td className="campaign-state-cell"><div className="campaign-state-stack">
          <span className={`campaign-state is-${row.state.tone}`} title={row.state.detail}><i aria-hidden="true" />{row.state.label}</span>
          {row.state.configured && row.state.effective && row.state.configured.code !== row.state.effective.code && <small className="level-configured">Configurado: {row.state.configured.label}</small>}
          {row.state.restrictions.map(item => <span className="campaign-restriction" key={item.key} title={item.detail}><TriangleAlert size={11} />{item.label}</span>)}
        </div></td>
        {columns.map(column => <td key={column.key} data-col={column.key}><Cell column={column} row={row} index={index} /></td>)}
      </tr>;
    })}
    {!rows.length && <tr><td colSpan={span} className="analytics-tree-empty">Nenhum item neste escopo.</td></tr>}</tbody>
  </table></div>;
}
