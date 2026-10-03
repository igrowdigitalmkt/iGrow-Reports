import { compactEntitySelection, leafKeys, type AnalyticsEntity } from "./analytics-hierarchy";

export function hierarchyLeaves(entities: AnalyticsEntity[]) {
  return entities.filter(entity => entity.level === "campaign").flatMap(entity => leafKeys(entity, entities));
}

export function reconcileHierarchySelection(input: {
  previous: AnalyticsEntity[]; next: AnalyticsEntity[]; selectedLeaves: string[];
  appliedEntityKeys: string[]; unrestricted: boolean;
}) {
  const previousLeaves = hierarchyLeaves(input.previous);
  const nextLeaves = hierarchyLeaves(input.next);
  const selected = new Set(input.selectedLeaves);
  const allSelected = previousLeaves.length === selected.size && previousLeaves.every(key => selected.has(key));
  const draftParents = new Set(compactEntitySelection(input.previous, input.selectedLeaves));
  const selectedLeaves = allSelected ? nextLeaves : input.next
    .filter(entity => draftParents.has(entity.key)).flatMap(entity => leafKeys(entity, input.next));
  const appliedEntityKeys = input.unrestricted
    ? input.next.filter(entity => entity.level === "campaign").map(entity => entity.key)
    : input.appliedEntityKeys;
  return { selectedLeaves: [...new Set(selectedLeaves)], appliedEntityKeys };
}
