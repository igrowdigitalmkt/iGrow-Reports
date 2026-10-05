import { expect, it } from "vitest";
import { splitSnapshotResultIndicators, type MetaSnapshotIndicator } from "@/modules/meta/snapshot-view";
import { metaMetricLabel } from "@/modules/meta/metric-labels";

const indicator = (nativeKey: string, value: string | null, label = nativeKey): MetaSnapshotIndicator => ({
  key: nativeKey, nativeKey, label, value, state: value === null ? "unavailable" : "available", unit: "count", aggregationRule: "sum",
});

it("lists each native result type instead of adding mixed results", () => {
  const split = splitSnapshotResultIndicators([
    indicator("spend", "544.11"), indicator("result:provider_known", "1"),
    indicator("result:provider:action:offsite_complete_registration_add_meta_leads", "10", "Cadastros"),
    indicator("result:provider:action:onsite_conversion.messaging_conversation_started_7d", "1", "Conversas"),
    indicator("primary_results", null), indicator("cost_per_result", null),
  ]);
  expect(split.mixedResults).toBe(true);
  expect(split.breakdown.map(item => [item.label, item.value])).toEqual([["Cadastros", "10"], ["Conversas", "1"]]);
  expect(split.indicators.map(item => item.key)).toEqual(["primary_results", "cost_per_result", "spend"]);
});

it("keeps a single result type as the primary result without a breakdown list", () => {
  const split = splitSnapshotResultIndicators([
    indicator("result:provider_known", "1"), indicator("result:provider:action:lead", "4", "Leads"), indicator("primary_results", "4"),
  ]);
  expect(split.mixedResults).toBe(false);
  expect(split.breakdown).toHaveLength(1);
  expect(split.indicators.map(item => item.key)).toEqual(["primary_results"]);
});

it("does not expose results when Meta did not identify them", () => {
  const split = splitSnapshotResultIndicators([indicator("result:provider_known", null), indicator("result:provider:action:lead", "4")]);
  expect(split.breakdown).toEqual([]);
  expect(split.indicators).toEqual([]);
});

it("gives readable names to uncatalogued Meta action types", () => {
  expect(metaMetricLabel("action:offsite_complete_registration_add_meta_leads", "action:offsite_complete_registration_add_meta_leads"))
    .toBe("Cadastro concluído (evento personalizado: meta leads)");
  expect(metaMetricLabel("action:onsite_conversion.messaging_user_depth_2_message_send", "action:onsite_conversion.messaging_user_depth_2_message_send"))
    .toBe("Contatos com 2 mensagens enviadas");
  expect(metaMetricLabel("action:omni_landing_page_view", "action:omni_landing_page_view")).toBe("Visualizações da página de destino (todos os canais)");
  expect(metaMetricLabel("action:onsite_conversion.purchase", "action:onsite_conversion.purchase")).toBe("Compras na Meta");
  expect(metaMetricLabel("action:some_new_type", "action:some_new_type")).toBe("Ação Meta: some new type");
  expect(metaMetricLabel("action:some_new_type", "Rótulo salvo")).toBe("Rótulo salvo");
});
