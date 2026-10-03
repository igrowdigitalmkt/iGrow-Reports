import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  from: vi.fn(),
  versionResult: { data: null as unknown, error: null as unknown },
  reportResult: { data: null as unknown, error: null as unknown },
  snapshotResult: { data: null as unknown, error: null as unknown },
  metricsResult: { data: null as unknown, error: null as unknown },
  agencyFilters: [] as string[],
}));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAgencyReportPreview } from "@/modules/reports/actions";

const id = "576975e4-00f4-4b99-811a-8783d289cfd6";

function query(result: () => { data: unknown; error: unknown }, terminal: "single" | "order" = "single") {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.is = vi.fn(() => q);
  q.eq = vi.fn((key: string, value: string) => {
    if (key === "agency_id") mocks.agencyFilters.push(value);
    return q;
  });
  q.maybeSingle = vi.fn(async () => result());
  q.order = vi.fn(async () => terminal === "order" ? result() : result());
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agencyFilters.length = 0;
  mocks.versionResult = { data: { report_id: "report-1", currency: "BRL", date_from: "2026-09-01", date_to: "2026-09-30", state: "ready", timezone_name: "America/Sao_Paulo",
    configuration_snapshot: { snapshot_version: 5, analytics: { metaAggregate: { confirmed: true, version: 8 } } } }, error: null };
  mocks.reportResult = { data: { id: "report-1" }, error: null };
  mocks.snapshotResult = { data: { quality_status: "complete" }, error: null };
  mocks.metricsResult = { data: [{ metric_key: "spend", label: "Investimento", unit: "currency", numeric_value: 3565.16, display_precision: 2 }], error: null };
  mocks.from.mockImplementation((table: string) => {
    if (table === "report_versions") return query(() => mocks.versionResult);
    if (table === "reports") return query(() => mocks.reportResult);
    if (table === "report_data_snapshots") return query(() => mocks.snapshotResult);
    if (table === "report_metrics") return query(() => mocks.metricsResult, "order");
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.context.mockResolvedValue({ agency: { id: "trusted-agency" }, role: "viewer", supabase: { from: mocks.from } });
});

it("permite prévia somente de snapshot completo e limita todas as consultas à agência autenticada", async () => {
  const result = await getAgencyReportPreview(id);
  expect(result).toMatchObject({ success: true, preview: { state: "ready", metrics: [{ numericValue: 3565.16 }] } });
  expect(mocks.agencyFilters).toEqual(Array(4).fill("trusted-agency"));
});

it("bloqueia prévia quando o snapshot não comprova dados completos", async () => {
  mocks.snapshotResult = { data: { quality_status: "warning" }, error: null };
  expect(await getAgencyReportPreview(id)).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalledWith("report_metrics");
});
it("bloqueia prévia antiga mesmo quando a coleta diária foi marcada como completa", async () => {
  mocks.versionResult = { data: { report_id: "report-1", configuration_snapshot: { snapshot_version: 4 } }, error: null };
  expect(await getAgencyReportPreview(id)).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalledWith("report_metrics");
});

it("não consulta outras tabelas quando a versão não pertence à agência", async () => {
  mocks.versionResult = { data: null, error: null };
  expect(await getAgencyReportPreview(id)).toHaveProperty("error");
  expect(mocks.from).toHaveBeenCalledTimes(1);
});

it("rejeita ID inválido antes de consultar o banco", async () => {
  expect(await getAgencyReportPreview("invalid")).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});

it("não permite prévia de relatório arquivado", async () => {
  mocks.reportResult = { data: null, error: null };
  expect(await getAgencyReportPreview(id)).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalledWith("report_data_snapshots");
});
