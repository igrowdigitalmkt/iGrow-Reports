"use client";

import { useState } from "react";
import { SortHeader, ariaSort, type SortDirection } from "./sort-header";

type SortState = { key: string; direction: SortDirection } | null;
/** Ordena por uma chave; sem escolha do usuário mantém a ordem original (ativas primeiro). 1º clique: decrescente (texto: crescente). */
export function useSort(textKeys: string[]) {
  const [sort, setSort] = useState<SortState>(null);
  const toggle = (key: string) => setSort(current => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: textKeys.includes(key) ? "asc" : "desc" });
  const apply = <T,>(rows: T[], value: (row: T, key: string) => number | string | null) => {
    if (!sort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = value(a, sort.key), bv = value(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "pt-BR", { sensitivity: "base" }) : Number(av) - Number(bv)) * factor;
    });
  };
  const head = (key: string, label: string) => <SortHeader label={label} active={sort?.key === key} direction={sort?.direction ?? "desc"} onSort={() => toggle(key)} />;
  const aria = (key: string) => ariaSort(sort?.key === key, sort?.direction ?? "desc");
  return { apply, head, aria };
}
