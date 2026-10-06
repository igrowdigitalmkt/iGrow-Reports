"use client";

import { Fragment, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronRight } from "lucide-react";
import { entityChildren, entityDeliveryActive, leafKeys, type AnalyticsEntity } from "./analytics-hierarchy";
import { EntityMetricValue } from "./analytics-charts";
import type { AnalyticsMetric } from "./analytics-types";

export function CampaignTree({ entities, roots, metrics, selected, onChange, disabled, sortKey, sortDirection, statusLabel }: {
  entities: AnalyticsEntity[]; roots: AnalyticsEntity[]; metrics: AnalyticsMetric[];
  selected: string[]; onChange: (keys: string[]) => void; disabled: boolean;
  sortKey: string; sortDirection: "asc" | "desc"; statusLabel: (entity: Pick<AnalyticsEntity, "effectiveStatus">) => string;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const render = (entity: AnalyticsEntity, depth: number): React.ReactNode => {
    const children = entityChildren(entity, entities).sort((a, b) => {
      const factor = sortDirection === "desc" ? -1 : 1;
      if (sortKey === "status") {
        const status = (entityDeliveryActive(a) ? 1 : 0) - (entityDeliveryActive(b) ? 1 : 0);
        if (status !== 0) return status * factor;
        return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      }
      if (sortKey === "name") return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) * factor;
      const av = a.values[sortKey];
      const bv = b.values[sortKey];
      if (av == null && bv == null) return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      if (av == null) return 1;
      if (bv == null) return -1;
      const diff = av - bv;
      return diff === 0 ? a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) : diff * factor;
    });
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
          <span className={`analytics-entity-status ${entityDeliveryActive(entity) ? "is-active" : "is-inactive"}`}
            role="img" aria-label={`Veiculação: ${statusLabel(entity)}`} data-status-label={`Veiculação: ${statusLabel(entity)}`} />
          {entity.level === "ad" && (entity.thumbnailUrl ? <a href={entity.thumbnailUrl} target="_blank" rel="noopener noreferrer" aria-label={`Ver imagem de ${entity.name}`}><Image className="analytics-ad-thumbnail" src={entity.thumbnailUrl} alt="" width={44} height={44} unoptimized referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} /></a> : <span className="analytics-ad-thumbnail-placeholder" title="Imagem não retornada pela Meta">—</span>)}
          <div><strong>{entity.name}</strong><small>{entity.level === "campaign" ? entity.accountName
            : entity.level === "adset" ? "Conjunto de anúncios" : "Anúncio"}</small></div>
        </div></th>
        {metrics.map(metric => <td key={metric.key}><EntityMetricValue values={entity.values} metric={metric} currency={entity.currency} /></td>)}
      </tr>
      {open && children.map(child => render(child, depth + 1))}
      {open && !children.length && <tr><td colSpan={metrics.length + 1} className="analytics-tree-empty">Nenhum {entity.level === "campaign" ? "conjunto" : "anúncio"} com movimentação coletada neste período.</td></tr>}
    </Fragment>;
  };
  return <tbody>{roots.map(root => render(root, 0))}</tbody>;
}
