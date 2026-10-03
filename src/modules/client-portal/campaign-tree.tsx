"use client";

import { Fragment, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronRight } from "lucide-react";
import { entityChildren, leafKeys, type AnalyticsEntity } from "./analytics-hierarchy";
import { formatAnalyticsValue } from "./analytics-charts";
import type { AnalyticsMetric } from "./analytics-types";

export function CampaignTree({ entities, roots, metrics, selected, onChange, disabled }: {
  entities: AnalyticsEntity[]; roots: AnalyticsEntity[]; metrics: AnalyticsMetric[];
  selected: string[]; onChange: (keys: string[]) => void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const render = (entity: AnalyticsEntity, depth: number): React.ReactNode => {
    const children = entityChildren(entity, entities);
    const leaves = leafKeys(entity, entities);
    const checked = leaves.every(key => selected.includes(key));
    const partial = !checked && leaves.some(key => selected.includes(key));
    const open = expanded.includes(entity.key);
    return <Fragment key={entity.key}>
      <tr className={checked ? "is-selected" : ""}>
        <th scope="row"><div className="analytics-campaign-name" style={{ paddingLeft: depth * 24 }}>
          {entity.level !== "ad" ? <button type="button" className="analytics-tree-expand" aria-expanded={open}
            aria-label={`${open ? "Recolher" : "Expandir"} ${entity.name}`}
            onClick={() => setExpanded(current => open ? current.filter(key => key !== entity.key) : [...current, entity.key])}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button> : <span className="analytics-tree-spacer" />}
          <input type="checkbox" checked={checked} disabled={disabled}
            ref={node => { if (node) node.indeterminate = partial; }}
            aria-label={`Incluir ${entity.name}`} onChange={() => {
              const remainder = selected.filter(key => !leaves.includes(key));
              onChange(checked ? remainder : [...remainder, ...leaves]);
            }} />
          <span className={`analytics-entity-status ${entity.effectiveStatus === "DELIVERING" ? "is-active" : entity.effectiveStatus ? "is-inactive" : "is-unknown"}`}
            aria-hidden="true" />
          {entity.level === "ad" && (entity.thumbnailUrl ? <a href={entity.thumbnailUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ver imagem de ${entity.name}`}><Image className="analytics-ad-thumbnail" src={entity.thumbnailUrl} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} /></a> : <span className="analytics-ad-thumbnail-placeholder" title="Imagem não retornada pela Meta">—</span>)}
          <div><strong>{entity.name}</strong><small>{entity.level === "campaign" ? entity.accountName
            : entity.level === "adset" ? "Conjunto de anúncios" : "Anúncio"}</small></div>
        </div></th>
        {metrics.map(metric => <td key={metric.key}>{formatAnalyticsValue(entity.values[metric.key], metric, entity.currency)}</td>)}
      </tr>
      {open && children.map(child => render(child, depth + 1))}
      {open && !children.length && <tr><td colSpan={metrics.length + 1} className="analytics-tree-empty">Nenhum {entity.level === "campaign" ? "conjunto" : "anúncio"} com movimentação coletada neste período.</td></tr>}
    </Fragment>;
  };
  return <tbody>{roots.map(root => render(root, 0))}</tbody>;
}
