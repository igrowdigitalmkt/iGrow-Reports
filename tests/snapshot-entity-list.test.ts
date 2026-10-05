import { expect,it } from "vitest";
import { snapshotEntityPage } from "@/modules/meta/snapshot-entity-list";
import type { MetaSnapshotEntityView } from "@/modules/meta/snapshot-view";
const entities: MetaSnapshotEntityView[] = Array.from({ length: 61 },(_,index) => ({
  id: String(1000+index),name: `Anúncio ${index}`,hierarchy: null,currency: "BRL",timezone: "America/Sao_Paulo",indicators: [],deliveryStatus: null,
}));
it("limits each rendered page without dropping entities from the collection",() => {
  expect(snapshotEntityPage(entities,"",1)).toMatchObject({ total: 61,page: 1,totalPages: 3 });
  expect(snapshotEntityPage(entities,"",1).items).toHaveLength(25);
  expect(snapshotEntityPage(entities,"",2).items[0].id).toBe("1025");
  expect(snapshotEntityPage(entities,"",3).items).toHaveLength(11);
  expect(entities).toHaveLength(61);
});
it("searches names independent of accents/case and IDs exactly as text",() => {
  expect(snapshotEntityPage(entities,"  ANUNCIO   60  ",1).items.map(entity => entity.id)).toEqual(["1060"]);
  expect(snapshotEntityPage(entities,"1042",1).items.map(entity => entity.name)).toEqual(["Anúncio 42"]);
});
it("returns a distinct empty search result",() => {
  expect(snapshotEntityPage(entities,"missing",1)).toEqual({ items: [],total: 0,page: 1,totalPages: 1 });
});
it("clamps the page when a refreshed collection gets smaller",() => {
  expect(snapshotEntityPage(entities.slice(0,2),"",3)).toMatchObject({ page: 1,total: 2,totalPages: 1 });
});
it("does not alter frozen entity names or order",() => {
  const before = JSON.stringify(entities);
  snapshotEntityPage(entities,"anuncio",2);
  expect(JSON.stringify(entities)).toBe(before);
});
it.each([0,-1,1.5])("rejects invalid page %s",page => {
  expect(() => snapshotEntityPage(entities,"",page)).toThrow("inválida");
});

it("orders by exact spend, highest first, keeping entities without spend last",() => {
  const withSpend = (id: string,value: string | null) => ({ ...entities[0],id,name: id,indicators: value === null ? [] : [{ key: "spend",nativeKey: "spend",label: "Valor usado",value,state: "available" as const,unit: "currency",aggregationRule: "sum" }] });
  const list = [withSpend("zero","0"),withSpend("none",null),withSpend("big","1295.21"),withSpend("bigger","1508.87"),withSpend("tiny","0.000000000000000001")];
  expect(snapshotEntityPage(list,"",1).items.map(entity => entity.id)).toEqual(["bigger","big","tiny","zero","none"]);
  expect(list.map(entity => entity.id)).toEqual(["zero","none","big","bigger","tiny"]);
});
