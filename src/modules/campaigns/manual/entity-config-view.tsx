"use client";

import { useContext, useEffect, useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { loadEntityConfigAction } from "./actions";
import type { EntityConfig } from "./config";
import type { ManualLevel, ManualRef } from "./contracts";
import { OperationsServicesContext } from "./entity-operations";
import "./operations.css";

export type ConfigLoader = (ref: ManualRef) => Promise<{ ok: true; config: EntityConfig } | { ok: false; message: string }>;
const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Configurações REAIS da entidade, lidas na Meta sob demanda (nada é carregado por linha da tabela). Somente leitura: o que o
 * servidor autoriza alterar continua nos controles de operações. Só aparecem seções com conteúdo devolvido pela Meta; dado que a Meta
 * não devolveu aparece como limitação, nunca como valor padrão ou zero.
 */
export function EntityConfigView({ clientId, accountId, level, entityId, auto = false, onViewChildren, loader: loaderProp }: {
  clientId: string; accountId: string; level: ManualLevel; entityId: string; auto?: boolean; onViewChildren?: () => void; loader?: ConfigLoader;
}) {
  const services = useContext(OperationsServicesContext);
  const loader = loaderProp ?? services.config ?? loadEntityConfigAction;
  const [started, setStarted] = useState(auto);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; config: EntityConfig }>({ status: "loading" });
  useEffect(() => {
    if (!started) return;
    let alive = true;
    loader({ clientId, accountId, level, entityId })
      .then(result => { if (alive) setState(result.ok ? { status: "ready", config: result.config } : { status: "error", message: result.message }); })
      .catch(() => { if (alive) setState({ status: "error", message: "Não foi possível consultar as configurações agora." }); });
    return () => { alive = false; };
  }, [started, loader, clientId, accountId, level, entityId]);

  const head = <header className="ops-head"><h2>Configurações na Meta</h2><span className="ops-badge" title="Somente leitura">Leitura</span></header>;
  if (!started) return <section className="analytics-card cdetail-card ops" aria-label="Configurações da entidade">{head}
    <p className="ops-note">Consulta sob demanda na Meta; nada é carregado até você pedir.</p>
    <button type="button" className="ops-btn" onClick={() => setStarted(true)}><SlidersHorizontal size={14} />Ver configurações</button></section>;
  if (state.status === "loading") return <section className="analytics-card cdetail-card ops" aria-label="Configurações da entidade" aria-busy="true">{head}<p className="ops-note" role="status"><Loader2 size={14} className="ops-spin" /> Lendo as configurações na Meta…</p></section>;
  if (state.status === "error") return <section className="analytics-card cdetail-card ops" aria-label="Configurações da entidade">{head}<p className="ops-note is-warn" role="status">{state.message}</p>
    <button type="button" className="ops-btn" onClick={() => { setState({ status: "loading" }); setStarted(false); setTimeout(() => setStarted(true), 0); }}>Tentar novamente</button></section>;
  const { config } = state;
  return <section className="analytics-card cdetail-card ops" aria-label="Configurações da entidade">
    {head}
    {config.sections.map((section, index) => <div key={`${section.key}-${index}`} className="ops-config-section">
      <strong>{section.title}</strong>
      <dl className="cdetail-facts">{section.items.map(item => <div key={item.label}><dt>{item.label}</dt><dd className="ops-name">{item.value}{item.note && <small className="ops-reason"> {item.note}</small>}</dd></div>)}</dl>
    </div>)}
    {config.budgetLocation.kind === "not_at_this_level" && level === "campaign" && onViewChildren && <button type="button" className="ops-btn" onClick={onViewChildren}>Ver os orçamentos nos conjuntos</button>}
    {config.limitations.length > 0 && <ul className="ops-limits">{config.limitations.map(item => <li key={item}>{item}</li>)}</ul>}
    <small className="ops-foot">Somente leitura, lida na Meta às {stamp.format(new Date(config.fetchedAt))}. Para alterar nome, estado ou orçamento use os controles acima.</small>
  </section>;
}
