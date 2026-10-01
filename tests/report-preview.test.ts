import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), eq: vi.fn(), version: vi.fn(), metrics: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAgencyReportPreview } from "@/modules/reports/actions";

const id = "576975e4-00f4-4b99-811a-8783d289cfd6";
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: vi.fn().mockReturnThis(), eq: mocks.eq, maybeSingle: mocks.version, order: mocks.metrics };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.context.mockResolvedValue({ agency: { id: "trusted-agency" }, role: "viewer", supabase: { from: mocks.from } });
  mocks.version.mockResolvedValue({ data: { currency: "BRL", date_from: "2026-09-01", date_to: "2026-09-30", state: "ready", timezone_name: "America/Sao_Paulo" }, error: null });
  mocks.metrics.mockResolvedValue({ data: [{ metric_key: "spend", label: "Investimento", unit: "currency", numeric_value: 3565.16, display_precision: 2 }], error: null });
});

it("permite prévia antes de publicar e limita ambas as consultas à agência autenticada", async () => {
  const result = await getAgencyReportPreview(id);
  expect(result).toMatchObject({ success: true, preview: { state: "ready", metrics: [{ numericValue: 3565.16 }] } });
  expect(mocks.eq.mock.calls.filter(([key]) => key === "agency_id")).toEqual([["agency_id", "trusted-agency"], ["agency_id", "trusted-agency"]]);
});

it("não consulta métricas quando a versão não pertence à agência", async () => {
  mocks.version.mockResolvedValue({ data: null, error: null });
  expect(await getAgencyReportPreview(id)).toHaveProperty("error");
  expect(mocks.metrics).not.toHaveBeenCalled();
});

it("rejeita ID inválido antes de consultar o banco", async () => {
  expect(await getAgencyReportPreview("invalid")).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});
