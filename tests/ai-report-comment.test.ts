import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { ReportFacts } from "@/modules/reports/report-facts";
import { DEFAULT_MONTHLY_BUDGET_USD, estimateCostUsd, generateReportComment, type CommentDeps } from "@/modules/ai/report-comment";

const facts: ReportFacts = {
  period: { from: "2026-09-30", to: "2026-10-06", previousFrom: "2026-09-23", previousTo: "2026-09-29", comparable: true },
  currency: "BRL",
  spend: { current: 896.54, previous: 785.75, changePct: 14.099904549793187 },
  results: [{ key: "messages", label: "Conversas por mensagem iniciadas", quantity: 66, previousQuantity: 46, changePct: 43.47826086956522, spend: 717.9, costPerResult: 10.877272727272727, previousCostPerResult: null, costChangePct: null }],
  delivery: {
    reach: { current: 53095, previous: 28157, changePct: 88.5676741130092 }, impressions: { current: 76201, previous: 47409, changePct: 60.7 },
    cpm: { current: 11.765462395506619, previous: 16.57385728448185, changePct: -29.011924058724368 },
    frequency: { current: 1.4351822205480742, previous: 1.6837376140924105, changePct: -14.762121571912246 },
    linkClicks: { current: 1384, previous: 389, changePct: 255.7840616966581 }, reachEstimated: false,
  },
  campaigns: [], campaignsWithSpend: 0, ads: [], adsWithSpend: 0, adHighlights: { lowestCost: [], highestCost: [], unconfirmed: [] }, commercial: null, accounts: [], limitations: [],
};
const input = { agencyId: "agency-1", clientId: "client-1", userId: "user-1", facts, sourceRef: "report-1" };

function fakeSupabase(options: { agency?: unknown; client?: unknown; monthCost?: number | null; settingsError?: boolean; entitlement?: unknown; entitlementError?: { code: string } } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const result = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: options.settingsError ? { code: "x" } : null }) }) }) });
  const client = {
    from: (table: string) => table === "ai_usage"
      ? { insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }
      : result(table === "ai_settings" ? (options.agency ?? null) : (options.client ?? null)),
    rpc: async (name: string) => name === "agency_ai_entitlement"
      ? { data: options.entitlementError ? null : options.entitlement === undefined ? { allowed: true, budget_usd: null } : options.entitlement, error: options.entitlementError ?? null }
      : { data: options.monthCost === undefined ? 0 : options.monthCost, error: null },
  };
  return { client: client as unknown as NonNullable<CommentDeps["supabase"]>, inserted };
}

function fakeAnthropic(text: string, overrides: Record<string, unknown> = {}) {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text }], stop_reason: "end_turn",
    usage: { input_tokens: 2800, output_tokens: 600, cache_read_input_tokens: null, cache_creation_input_tokens: null }, ...overrides,
  }));
  return { create, deps: { messages: { create } } as unknown as CommentDeps["anthropic"] };
}

describe("comentário de relatório com IA", () => {
  it("gera, verifica os números e registra o uso com custo", async () => {
    const { client, inserted } = fakeSupabase();
    const ai = fakeAnthropic("Foram 66 conversas (+43,5%), a R$ 10,88 cada, com investimento de R$ 896,54.");
    const result = await generateReportComment(input, { supabase: client, anthropic: ai.deps });
    expect(result).toMatchObject({ ok: true, costUsd: 0.0116 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ agency_id: "agency-1", client_id: "client-1", status: "ok", verifier_passed: true, input_tokens: 2800, output_tokens: 600, cost_usd: 0.0116, source_ref: "report-1" });
    expect(String(inserted[0]?.facts_hash)).toHaveLength(32);
    expect(JSON.stringify(inserted[0])).not.toContain("Foram 66");
  });

  it("bloqueia quando o orçamento do mês foi atingido, sem chamar a IA", async () => {
    const { client, inserted } = fakeSupabase({ agency: { enabled: true, monthly_budget_usd: 5 }, monthCost: 5 });
    const ai = fakeAnthropic("x");
    const result = await generateReportComment(input, { supabase: client, anthropic: ai.deps });
    expect(result).toMatchObject({ ok: false, reason: "budget" });
    expect(ai.create).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ status: "blocked_budget", cost_usd: 0 });
  });

  it("usa o orçamento padrão quando a organização não configurou nada", async () => {
    const { client } = fakeSupabase({ monthCost: DEFAULT_MONTHLY_BUDGET_USD - 0.01 });
    const ai = fakeAnthropic("Investimento de R$ 896,54.");
    expect((await generateReportComment(input, { supabase: client, anthropic: ai.deps })).ok).toBe(true);
  });

  it("respeita a IA desligada para o cliente ou para a organização", async () => {
    for (const settings of [{ client: { enabled: false } }, { agency: { enabled: false, monthly_budget_usd: 5 } }]) {
      const { client, inserted } = fakeSupabase(settings);
      const ai = fakeAnthropic("x");
      expect(await generateReportComment(input, { supabase: client, anthropic: ai.deps })).toMatchObject({ ok: false, reason: "disabled" });
      expect(ai.create).not.toHaveBeenCalled();
      expect(inserted[0]).toMatchObject({ status: "blocked_disabled" });
    }
  });

  it("respeita os direitos comerciais: IA fora do plano, teto do plano e resposta inválida", async () => {
    const off = fakeSupabase({ entitlement: { allowed: false, budget_usd: null } });
    const aiOff = fakeAnthropic("x");
    expect(await generateReportComment(input, { supabase: off.client, anthropic: aiOff.deps })).toMatchObject({ ok: false, reason: "disabled" });
    expect(aiOff.create).not.toHaveBeenCalled();
    expect(off.inserted[0]).toMatchObject({ status: "blocked_disabled" });
    // O teto do plano (US$ 3) vale mesmo que a organização tenha configurado US$ 50.
    const capped = fakeSupabase({ agency: { enabled: true, monthly_budget_usd: 50 }, monthCost: 3, entitlement: { allowed: true, budget_usd: 3 } });
    const aiCap = fakeAnthropic("x");
    expect(await generateReportComment(input, { supabase: capped.client, anthropic: aiCap.deps })).toMatchObject({ ok: false, reason: "budget" });
    expect(aiCap.create).not.toHaveBeenCalled();
    for (const entitlement of [5, "sim", { allowed: "true" }, { allowed: true, budget_usd: -1 }]) {
      const bad = fakeSupabase({ entitlement });
      const aiBad = fakeAnthropic("x");
      expect(await generateReportComment(input, { supabase: bad.client, anthropic: aiBad.deps })).toMatchObject({ ok: false, reason: "unavailable" });
      expect(aiBad.create).not.toHaveBeenCalled();
    }
  });

  it("antes da migration do catálogo comercial a IA segue como antes; outras falhas negam", async () => {
    const before = fakeSupabase({ entitlementError: { code: "PGRST202" } });
    const ai = fakeAnthropic("Investimento de R$ 896,54.");
    expect((await generateReportComment(input, { supabase: before.client, anthropic: ai.deps })).ok).toBe(true);
    const broken = fakeSupabase({ entitlementError: { code: "XX000" } });
    const aiBroken = fakeAnthropic("x");
    expect(await generateReportComment(input, { supabase: broken.client, anthropic: aiBroken.deps })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(aiBroken.create).not.toHaveBeenCalled();
  });

  it("não entrega texto com número que não está nos dados e registra o custo", async () => {
    const { client, inserted } = fakeSupabase();
    const ai = fakeAnthropic("Foram 67 conversas a R$ 10,88 cada.");
    const result = await generateReportComment(input, { supabase: client, anthropic: ai.deps });
    expect(result).toMatchObject({ ok: false, reason: "rejected_numbers", unverified: ["67"] });
    expect(inserted[0]).toMatchObject({ status: "rejected_numbers", verifier_passed: false, cost_usd: 0.0116 });
  });

  it("registra falha da API sem expor detalhes e não devolve texto", async () => {
    const { client, inserted } = fakeSupabase();
    const ai = { messages: { create: vi.fn(async () => { throw new Error("boom"); }) } } as unknown as CommentDeps["anthropic"];
    expect(await generateReportComment(input, { supabase: client, anthropic: ai })).toMatchObject({ ok: false, reason: "error" });
    expect(inserted[0]).toMatchObject({ status: "error", cost_usd: 0 });
  });

  it("trata resposta incompleta como erro", async () => {
    const { client, inserted } = fakeSupabase();
    const ai = fakeAnthropic("Texto cortado", { stop_reason: "max_tokens" });
    expect(await generateReportComment(input, { supabase: client, anthropic: ai.deps })).toMatchObject({ ok: false, reason: "error" });
    expect(inserted[0]).toMatchObject({ status: "error", cost_usd: 0.0116 });
  });

  it("fica indisponível, sem chamar a IA, quando não consegue ler a configuração ou a cota", async () => {
    const broken = fakeSupabase({ settingsError: true });
    const ai = fakeAnthropic("x");
    expect(await generateReportComment(input, { supabase: broken.client, anthropic: ai.deps })).toMatchObject({ ok: false, reason: "unavailable" });
    const noCost = fakeSupabase({ monthCost: null });
    expect(await generateReportComment(input, { supabase: noCost.client, anthropic: ai.deps })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(ai.create).not.toHaveBeenCalled();
    expect(broken.inserted).toHaveLength(0);
  });

  it("estima o custo pelos preços do modelo, incluindo cache", () => {
    expect(estimateCostUsd({ input: 2800, output: 600, cacheRead: 0, cacheWrite: 0 })).toBe(0.0116);
    expect(estimateCostUsd({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBe(2.7);
  });
});
