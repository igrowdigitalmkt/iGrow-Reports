"use client";

import { useState } from "react";

export type ListedResult = { key: string; label: string; value: number };
const integer = (value: number) => Math.round(value).toLocaleString("pt-BR");

/**
 * Resultados do cliente no período: os três maiores sempre visíveis e, se houver mais, "+N tipos" ABRE a lista completa no próprio
 * quadro (clique de novo para recolher). Nada some: todos os tipos continuam acessíveis.
 */
export function ResultList({ results, costLine, visible = 3 }: { results: ListedResult[]; costLine?: string | null; visible?: number }) {
  const [open, setOpen] = useState(false);
  const shown = open ? results : results.slice(0, visible);
  const rest = results.length - visible;
  return <div className="result-list" title={open ? undefined : results.map(result => `${integer(result.value)} ${result.label}`).join(" · ")}>
    {shown.map(result => <span key={result.key}><strong>{integer(result.value)}</strong> {result.label}</span>)}
    {rest > 0 && <button type="button" className="result-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? "Mostrar menos" : `+${rest} ${rest === 1 ? "tipo" : "tipos"}`}</button>}
    {costLine && <span className="muted">{costLine}</span>}
  </div>;
}
