import Decimal from "decimal.js";
import type { MetaSnapshotEntityView } from "./snapshot-view";

const searchable = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR").replace(/\s+/g," ").trim();

export function snapshotEntityPage(entities: MetaSnapshotEntityView[],query: string,page: number,pageSize = 25) {
  if (!Number.isInteger(page) || page<1 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error("Página de entidades inválida.");
  const needle = searchable(query);
  const filtered = needle ? entities.filter(entity => [entity.name,entity.id].some(value => searchable(value).includes(needle))) : entities;
  // Highest exact spend first, so entities that delivered are not hidden behind
  // zero-spend ones; entities without spend keep their collected order at the end.
  const spend = (entity: MetaSnapshotEntityView) => entity.indicators.find(item => item.key === "spend")?.value ?? null;
  const matches = filtered.map((entity,index) => ({ entity,index,value: spend(entity) }))
    .sort((a,b) => a.value === null || b.value === null ? (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) || a.index - b.index
      : new Decimal(b.value).comparedTo(a.value) || a.index - b.index)
    .map(item => item.entity);
  const totalPages = Math.max(1,Math.ceil(matches.length/pageSize));
  const currentPage = Math.min(page,totalPages);
  return { items: matches.slice((currentPage-1)*pageSize,currentPage*pageSize),total: matches.length,page: currentPage,totalPages };
}
