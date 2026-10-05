import type { MetaSnapshotEntityView } from "./snapshot-view";

const searchable = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR").replace(/\s+/g," ").trim();

export function snapshotEntityPage(entities: MetaSnapshotEntityView[],query: string,page: number,pageSize = 25) {
  if (!Number.isInteger(page) || page<1 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error("Página de entidades inválida.");
  const needle = searchable(query);
  const matches = needle ? entities.filter(entity => [entity.name,entity.id].some(value => searchable(value).includes(needle))) : entities;
  const totalPages = Math.max(1,Math.ceil(matches.length/pageSize));
  const currentPage = Math.min(page,totalPages);
  return { items: matches.slice((currentPage-1)*pageSize,currentPage*pageSize),total: matches.length,page: currentPage,totalPages };
}
