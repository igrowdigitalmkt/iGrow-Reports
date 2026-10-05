import type { MetaSnapshotView } from "@/modules/meta/snapshot-view";

export function snapshotPdfFixture(count = 3): MetaSnapshotView {
  return { status: "ready", collectedAt: "2026-10-04T12:34:56Z", missing: [], scopes: [{
    identity: { clientId: "client", connectionId: "connection", provider: "meta", externalAccountId: "act_123",
      dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "ad", apiVersion: "v24.0", contractVersion: 3 },
    snapshotId: "snapshot-confirmado-123", collectedAt: "2026-10-04T12:34:56Z",
    entities: Array.from({ length: count }, (_, index) => ({
      id: `ad-${index + 1}`, name: index === 0 ? "Campanha de verão - São Paulo / ação e conversão" : `Anúncio demonstrativo ${index + 1}`,
      hierarchy: { name: null, parentId: "adset-123", campaignId: "campaign-123", adsetId: "adset-123" },
      currency: "BRL", timezone: "America/Sao_Paulo", deliveryStatus: null,
      indicators: [
        { key: "spend", nativeKey: "spend", label: "Valor usado", value: "123456789012345678.12345678", state: "available", unit: "currency", aggregationRule: "sum" },
        { key: "clicks", nativeKey: "clicks", label: "Cliques (todos)", value: "0", state: "zero", unit: "count", aggregationRule: "sum" },
        { key: "results", nativeKey: "results", label: "Resultados", value: null, state: "unavailable", unit: "count", aggregationRule: "provider" },
        { key: "cost_per_result", nativeKey: "cost_per_result", label: "Custo por resultado", value: null, state: "error", unit: "currency", aggregationRule: "ratio" },
        { key: "ctr", nativeKey: "ctr", label: "CTR", value: "2.19000001", state: "available", unit: "percent", aggregationRule: "ratio" },
      ],
    })),
  }] };
}
