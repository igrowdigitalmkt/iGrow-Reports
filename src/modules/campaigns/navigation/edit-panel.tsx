"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
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
export function EditPanel({ row, clientId, detailSearch, onClose, onChanged }: { row: CampaignRow; clientId: string; detailSearch: string; onClose: () => void; onChanged: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = element.current; if (node && !node.open) node.showModal(); }, []);
  if (row.level === "ad") return null;
  return <dialog ref={element} className="edit-sheet" aria-labelledby="edit-sheet-title" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}
    onClick={event => { if (event.target === element.current) onClose(); }}>
    <header className="edit-sheet-head">
      <div><small>{row.level === "campaign" ? "Editar campanha" : "Editar conjunto de anúncios"}</small><h2 id="edit-sheet-title" title={row.name}>{row.name}</h2><span>{row.accountName}</span></div>
      <button type="button" className="edit-sheet-close" onClick={onClose} aria-label="Fechar painel de edição"><X size={16} /></button>
    </header>
    <div className="edit-sheet-body">
      <EntityOperations clientId={clientId} accountId={row.accountId} level={row.level} entityId={row.id} entityName={row.name} accountName={row.accountName} currency={row.currency} refresh={onChanged} />
      <p className="edit-sheet-note">Hoje é possível pausar, retomar e alterar o orçamento diário. Renomear, programação, segmentação e criativos exigem novas ações do executor e ainda não estão disponíveis.</p>
      <Link className="campaigns-link" href={`${entityPath(clientId, row)}${detailSearch}`} prefetch={false}>Abrir página de detalhes <ArrowUpRight size={13} /></Link>
    </div>
  </dialog>;
}
