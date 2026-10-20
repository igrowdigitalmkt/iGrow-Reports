"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { EntityConfigView } from "../manual/entity-config-view";
import { EntityOperations } from "../manual/entity-operations";
import { entityPath } from "../routes";
import type { CampaignRow } from "../tree";
import "../detail/detail.css";
import "../manual/operations.css";
import "./navigation.css";

/**
 * Painel lateral de edição de UMA entidade (campanha ou conjunto): reutiliza o MESMO componente de operações das páginas de detalhes
 * (estado atual lido na Meta, controles que o servidor autoriza, confirmação, resultado e histórico). Só campos suportados pelo executor
 * aparecem; nada é simulado.
 */
export function EditPanel({ row, clientId, detailSearch, onClose, onChanged, onViewChildren }: { row: CampaignRow; clientId: string; detailSearch: string; onClose: () => void; onChanged: () => void; onViewChildren?: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = element.current; if (node && !node.open) node.showModal(); }, []);
  return <dialog ref={element} className="edit-sheet" aria-labelledby="edit-sheet-title" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
    onClick={event => { if (event.target === element.current) onClose(); }}>
    <header className="edit-sheet-head">
      <div><small>{row.level === "campaign" ? "Editar campanha" : row.level === "adset" ? "Editar conjunto de anúncios" : "Editar anúncio"}</small><h2 id="edit-sheet-title" title={row.name}>{row.name}</h2><span>{row.accountName}</span></div>
      <button type="button" className="edit-sheet-close" onClick={onClose} aria-label="Fechar painel de edição"><X size={16} /></button>
    </header>
    <div className="edit-sheet-body">
      <EntityOperations clientId={clientId} accountId={row.accountId} level={row.level} entityId={row.id} entityName={row.name} accountName={row.accountName} currency={row.currency} refresh={onChanged} />
      <EntityConfigView clientId={clientId} accountId={row.accountId} level={row.level} entityId={row.id} auto onViewChildren={onViewChildren} />
      <p className="edit-sheet-note">Disponível hoje: renomear, pausar e retomar (campanha, conjunto e anúncio) e alterar o orçamento diário (campanha e conjunto). Programação, segmentação e criativos ainda não podem ser editados por aqui.</p>
      <Link className="campaigns-link" href={`${entityPath(clientId, row)}${detailSearch}`} prefetch={false}>Abrir página de detalhes <ArrowUpRight size={13} /></Link>
    </div>
  </dialog>;
}
