"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

/**
 * Título de coluna ordenável no padrão do Gerenciador de Anúncios: setas ⇅ discretas em colunas ordenáveis; na coluna ordenada o
 * título e a seta (↓ decrescente, ↑ crescente) ficam em destaque. Um clique ordena; outro clique inverte.
 */
export function SortHeader({ label, active, direction, onSort, title }: { label: string; active: boolean; direction: SortDirection; onSort: () => void; title?: string }) {
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return <button type="button" className={`sort-header${active ? " is-active" : ""}`} onClick={onSort} title={title ?? `Ordenar por ${label.toLocaleLowerCase("pt-BR")}`}>
    <span>{label}</span><Icon size={13} aria-hidden="true" /></button>;
}

export const ariaSort = (active: boolean, direction: SortDirection) => (active ? (direction === "asc" ? "ascending" as const : "descending" as const) : "none" as const);
