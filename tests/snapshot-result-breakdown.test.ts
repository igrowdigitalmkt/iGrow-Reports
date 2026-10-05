import { expect, it } from "vitest";
import { splitSnapshotResultIndicators, type MetaSnapshotEntityView, type MetaSnapshotIndicator } from "@/modules/meta/snapshot-view";
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

const campaign = (id: string, indicators: MetaSnapshotIndicator[]) => ({
  id, name: id, hierarchy: null, currency: "BRL", timezone: "America/Sao_Paulo", indicators, deliveryStatus: null,
}) as MetaSnapshotEntityView;
const account = [indicator("spend", "100.5"), indicator("primary_results", null), indicator("cost_per_result", null), indicator("result:provider_known", null)];

it("adds one result type across campaigns when Meta omits account-level results", () => {
  const split = splitSnapshotResultIndicators(account, [
    campaign("c1", [indicator("result:provider_known", "1"), indicator("result:provider:action:landing_page_view", "0.1", "LPV")]),
    campaign("c2", [indicator("result:provider_known", "1"), indicator("result:provider:action:landing_page_view", "0.2", "LPV")]),
    campaign("c3", [indicator("result:provider_known", "1")]),
  ]);
  expect(split.derivedFromCampaigns).toBe(true);
  expect(split.breakdown).toEqual([{ key: "result:provider:action:landing_page_view", label: "LPV", value: "0.3", cost: null }]);
  expect(split.primary).toBe("0.3");
  expect(split.cost).toBe("335");
});

it("keeps campaign result types separate and leaves cost uncalculated", () => {
  const split = splitSnapshotResultIndicators(account, [
    campaign("c1", [indicator("result:provider_known", "1"), indicator("result:provider:action:link_click", "7", "Cliques")]),
    campaign("c2", [indicator("result:provider_known", "1"), indicator("result:provider:action:offsite_conversion.fb_pixel_complete_registration", "3", "Cadastros")]),
  ]);
  expect(split.mixedResults).toBe(true);
  expect(split.primary).toBeNull();
  expect(split.cost).toBeNull();
  expect(split.breakdown.map(item => item.cost)).toEqual([null, null]);
});

it("costs each result type with the spend of its own campaigns, as Ads Manager does", () => {
  const spend = (value: string) => ({ ...indicator("spend", value), unit: "currency" });
  const split = splitSnapshotResultIndicators(account, [
    campaign("c1", [spend("264.47"), indicator("result:provider_known", "1"), indicator("result:provider:action:link_click", "1366", "Cliques")]),
    campaign("c2", [spend("279.65"), indicator("result:provider_known", "1"), indicator("result:provider:action:offsite_conversion.fb_pixel_complete_registration", "10", "Cadastros")]),
    campaign("c3", [spend("0"), indicator("result:provider_known", "1")]),
  ]);
  expect(split.breakdown.map(item => [item.label, item.cost!.slice(0, 8)])).toEqual([["Cliques", "0.193609"], ["Cadastros", "27.965"]]);
});

it("withholds per-type costs when a spending campaign has no single result type", () => {
  const spend = (value: string) => ({ ...indicator("spend", value), unit: "currency" });
  const split = splitSnapshotResultIndicators(account, [
    campaign("c1", [spend("10"), indicator("result:provider_known", "1"), indicator("result:provider:action:link_click", "5")]),
    campaign("c2", [spend("4"), indicator("result:provider_known", "1"), indicator("result:provider:action:lead", "0")]),
    campaign("c3", [spend("3"), indicator("result:provider_known", "1")]),
  ]);
  expect(split.breakdown.every(item => item.cost === null)).toBe(true);
});

it("does not derive account results when any campaign result is unidentified", () => {
  const split = splitSnapshotResultIndicators(account, [
    campaign("c1", [indicator("result:provider_known", "1"), indicator("result:provider:action:lead", "2")]),
    campaign("c2", [indicator("result:provider_known", null)]),
  ]);
  expect(split.derivedFromCampaigns).toBe(false);
  expect(split.breakdown).toEqual([]);
  expect(split.primary).toBeNull();
});
