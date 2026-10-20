import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/guard", () => ({ ensurePaidOperation: async () => undefined, paidOperationBlock: async () => null, billingBlockOf: () => null, BillingRestrictedError: class extends Error {} }));
import { GoogleAdsApiError, GoogleAdsClient, isCustomerId, normalizeCustomerId } from "@/modules/google-ads/client";
import { adQuery, accountDailyQuery, campaignQuery } from "@/modules/google-ads/queries";
import { buildGoogleAnalytics, previousPeriod } from "@/modules/google-ads/normalize";
import { resultCostBreakdown } from "@/modules/client-portal/analytics-results";

const credentials = { developerToken: "dev", clientId: "id", clientSecret: "secret", refreshToken: "refresh", loginCustomerId: "123-456-7890" };
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("cliente do Google Ads", () => {
  it("renova o token uma vez, envia o token de desenvolvedor e a conta de gerente", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
    const fetcher = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return url.includes("oauth2") ? reply(200, { access_token: "tok", expires_in: 3600 }) : reply(200, { results: [{ a: 1 }] });
    });
    const client = new GoogleAdsClient(credentials, { fetcher, version: "v21" });
    await client.search("111-222-3333", "SELECT 1");
    await client.search("1112223333", "SELECT 2");
    expect(calls.filter(call => call.url.includes("oauth2"))).toHaveLength(1);
    const search = calls.find(call => call.url.includes("googleAds:search"))!;
    expect(search.url).toBe("https://googleads.googleapis.com/v21/customers/1112223333/googleAds:search");
    expect(search.headers).toMatchObject({ authorization: "Bearer tok", "developer-token": "dev", "login-customer-id": "1234567890" });
  });

  it("junta as páginas da resposta", async () => {
    let page = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("oauth2")) return reply(200, { access_token: "t" });
      page += 1;
      return reply(200, page === 1 ? { results: [{ n: 1 }], nextPageToken: "p2" } : { results: [{ n: 2 }] });
    });
    const rows = await new GoogleAdsClient(credentials, { fetcher }).search("1112223333", "SELECT 1");
    expect(rows).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("explica acesso revogado e erros da API sem expor segredos", async () => {
    const revoked = new GoogleAdsClient(credentials, { fetcher: async () => reply(400, { error: "invalid_grant" }) });
    await expect(revoked.search("1112223333", "SELECT 1")).rejects.toMatchObject({ name: "GoogleAdsApiError", code: "invalid_grant", message: expect.stringContaining("Reconecte") });
    const denied = new GoogleAdsClient(credentials, { fetcher: async (url: string) => url.includes("oauth2") ? reply(200, { access_token: "t" })
      : reply(403, { error: { status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }) });
    const error = await denied.search("1112223333", "SELECT 1").catch(value => value) as GoogleAdsApiError;
    expect(error.code).toBe("USER_PERMISSION_DENIED");
    expect(error.message).not.toContain("secret");
  });

  it("lista só as contas de anúncios, sem as contas de gerente", async () => {
    const fetcher = async (url: string) => url.includes("oauth2") ? reply(200, { access_token: "t" }) : reply(200, { results: [
      { customerClient: { id: "1", descriptiveName: "Gerente", manager: true, currencyCode: "BRL" } },
      { customerClient: { id: "2223334444", descriptiveName: "Colégio", currencyCode: "BRL", timeZone: "America/Sao_Paulo", status: "ENABLED" } },
    ] });
    const accounts = await new GoogleAdsClient(credentials, { fetcher }).listManagedAccounts("1234567890");
    expect(accounts).toEqual([{ customerId: "2223334444", name: "Colégio", currency: "BRL", timezone: "America/Sao_Paulo", status: "ENABLED" }]);
  });

  it("valida o formato do número da conta", () => {
    expect(isCustomerId("123-456-7890")).toBe(true);
    expect(isCustomerId("12345")).toBe(false);
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
  });
});

describe("consultas GAQL", () => {
  it("usam o período informado e recusam datas inválidas", () => {
    expect(accountDailyQuery("2026-10-01", "2026-10-07")).toContain("BETWEEN '2026-10-01' AND '2026-10-07'");
    expect(campaignQuery("2026-10-01", "2026-10-07")).toContain("campaign.status != 'REMOVED'");
    expect(adQuery("2026-10-01", "2026-10-07")).toContain("metrics.impressions > 0");
    expect(() => accountDailyQuery("2026-10-01'; DROP", "2026-10-07")).toThrow();
  });
});

describe("dados do Google Ads no formato do iGrow", () => {
  const account = { id: "acc-1", customerId: "2223334444", name: "Conta Google", currency: "BRL", timezone: "America/Sao_Paulo" };
  const day = (date: string, cost: number, impressions: number, clicks: number) => ({ segments: { date }, metrics: { costMicros: String(cost * 1_000_000), impressions: String(impressions), clicks: String(clicks) } });
  const rows = {
    daily: [day("2026-10-01", 50, 1000, 40), day("2026-10-02", 70, 2000, 60)],
    previousDaily: [day("2026-09-29", 80, 1000, 30), day("2026-09-30", 40, 500, 20)],
    campaigns: [
      { campaign: { id: "1", name: "Pesquisa", status: "ENABLED", advertisingChannelType: "SEARCH" }, metrics: { costMicros: "80000000", impressions: "2000", clicks: "70", conversions: 8 } },
      { campaign: { id: "2", name: "YouTube", status: "ENABLED", advertisingChannelType: "VIDEO" }, metrics: { costMicros: "40000000", impressions: "1000", clicks: "30", conversions: 0, videoViews: "400" } },
    ],
  };
  const data = buildGoogleAnalytics({ account, dateFrom: "2026-10-01", dateTo: "2026-10-02", rows, now: new Date("2026-10-03T10:00:00Z") });

  it("calcula o período anterior e a cobertura completa", () => {
    expect(previousPeriod("2026-10-01", "2026-10-02")).toEqual({ from: "2026-09-29", to: "2026-09-30" });
    expect(data.coverage).toMatchObject({ status: "complete", previousStatus: "complete", totalDays: 2 });
    expect(data.metaAggregate?.confirmed).toBe(true);
  });

  it("converte custo em reais e calcula CTR, CPC e CPM", () => {
    expect(data.summary.spend).toBeCloseTo(120);
    expect(data.summary.impressions).toBe(3000);
    expect(data.summary.link_clicks).toBe(100);
    expect(data.summary.ctr_link).toBeCloseTo(3.333, 2);
    expect(data.summary.cpc_link).toBeCloseTo(1.2);
    expect(data.summary.cpm).toBeCloseTo(40);
    expect(data.previousSummary.spend).toBeCloseTo(120);
  });

  it("separa conversões das visualizações de vídeo, cada tipo com o próprio custo", () => {
    const results = resultCostBreakdown(data.summary, data.campaigns.map(campaign => ({ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId })));
    const byLabel = Object.fromEntries(results.map(result => [result.label, result]));
    expect(byLabel["Conversões"]).toMatchObject({ value: 8 });
    expect(byLabel["Conversões"].cost).toBeCloseTo(10);
    expect(byLabel["Visualizações de vídeo"]).toMatchObject({ value: 400 });
    expect(byLabel["Visualizações de vídeo"].cost).toBeCloseTo(0.1);
  });

  it("não inventa alcance nem frequência", () => {
    expect(data.summary.reach).toBeUndefined();
    expect(data.summary.frequency).toBeUndefined();
    expect(data.warnings.join(" ")).toMatch(/alcance/);
  });
});

describe("seções do Google Ads de um cliente", () => {
  it("lê só as contas vinculadas e uma conta com falha não derruba as outras", async () => {
    const { loadGoogleSections } = await import("@/modules/google-ads/provider");
    const rows = (table: string) => table === "client_google_accounts" ? [{ google_ad_account_id: "a1" }, { google_ad_account_id: "a2" }]
      : [{ id: "a1", customer_id: "1111111111", name: "Boa", currency: "BRL", timezone_name: "America/Sao_Paulo" }, { id: "a2", customer_id: "2222222222", name: "Quebrada", currency: "BRL", timezone_name: "America/Sao_Paulo" }];
    const service = { from: (table: string) => { const chain: Record<string, unknown> = {}; for (const name of ["select", "eq", "in", "is", "order"]) chain[name] = () => chain; chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(table), error: null }).then(resolve); return chain; } };
    const client = { search: vi.fn(async (customerId: string, query: string) => {
      if (customerId === "2222222222") throw new GoogleAdsApiError("O Google Ads recusou a consulta (USER_PERMISSION_DENIED).", 403, "USER_PERMISSION_DENIED");
      return query.includes("FROM campaign") ? [{ campaign: { id: "1", name: "C", advertisingChannelType: "SEARCH" }, metrics: { costMicros: "10000000", impressions: "100", clicks: "5", conversions: 2 } }]
        : [{ segments: { date: "2026-10-01" }, metrics: { costMicros: "10000000", impressions: "100", clicks: "5" } }];
    }) };
    const result = await loadGoogleSections({ service: service as never, agencyId: "ag", clientId: "cl", dateFrom: "2026-10-01", dateTo: "2026-10-01", client: client as never });
    expect(result.sections.map(section => section.name)).toEqual(["Boa"]);
    expect(result.sections[0].data.summary.spend).toBeCloseTo(10);
    expect(result.failures).toEqual([{ name: "Quebrada", message: expect.stringContaining("USER_PERMISSION_DENIED") }]);
    const only = await loadGoogleSections({ service: service as never, agencyId: "ag", clientId: "cl", dateFrom: "2026-10-01", dateTo: "2026-10-01", accountIds: ["a1"], client: client as never });
    expect(only.sections).toHaveLength(1);
    expect(only.failures).toHaveLength(0);
  });
});

describe("seção do Google Ads no painel e no PDF", () => {
  it("resume a conta com resultados, custos e principais campanhas", async () => {
    const { googleAccountSummary } = await import("@/modules/google-ads/google-section");
    const account = { id: "a", customerId: "1112223333", name: "Conta Google", currency: "BRL", timezone: "America/Sao_Paulo" };
    const data = buildGoogleAnalytics({ account, dateFrom: "2026-10-01", dateTo: "2026-10-02", rows: {
      daily: [{ segments: { date: "2026-10-01" }, metrics: { costMicros: "100000000", impressions: "5000", clicks: "100" } }], previousDaily: [],
      campaigns: [{ campaign: { id: "1", name: "Pesquisa", status: "ENABLED", advertisingChannelType: "SEARCH" }, metrics: { costMicros: "100000000", impressions: "5000", clicks: "100", conversions: 10 } }],
    } });
    const summary = googleAccountSummary({ id: "a", name: "Conta Google", data });
    expect(summary.idle).toBe(false);
    expect(summary.metrics[0]).toEqual(["Investimento", expect.stringMatching(/R\$\s100,00/)]);
    expect(summary.results[0]).toMatchObject({ label: "Conversões", value: "10" });
    expect(summary.results[0].cost).toMatch(/R\$\s10,00/);
    expect(summary.campaigns[0]).toMatchObject({ name: "Pesquisa" });
    expect(summary.campaigns[0].result).toMatch(/10 conversões/);
  });
  it("campanha ativa sem atividade no período aparece, com gasto zero, antes das paradas", async () => {
    const { googleAccountSummary } = await import("@/modules/google-ads/google-section");
    const account = { id: "a", customerId: "1112223333", name: "Conta Google", currency: "BRL", timezone: "America/Sao_Paulo" };
    const data = buildGoogleAnalytics({ account, dateFrom: "2026-09-20", dateTo: "2026-10-19", rows: {
      daily: [], previousDaily: [], campaigns: [],
      campaignList: [
        { campaign: { id: "9", name: "Parada antiga", status: "PAUSED", advertisingChannelType: "SEARCH" } },
        { campaign: { id: "7", name: "Nova ativa", status: "ENABLED", advertisingChannelType: "SEARCH" } },
      ],
    } });
    expect(data.campaigns.map(item => item.name).sort()).toEqual(["Nova ativa", "Parada antiga"]);
    const summary = googleAccountSummary({ id: "a", name: "Conta Google", data });
    expect(summary.idle).toBe(true);
    expect(summary.campaigns.map(item => item.name)).toEqual(["Nova ativa"]);
    expect(summary.campaigns[0]).toMatchObject({ active: true });
  });
  it("o PDF do Google usa a capa e a cor da plataforma", async () => {
    const { toReportPdfInput } = await import("@/modules/reports/pdf/adapter");
    const account = { id: "a", customerId: "1112223333", name: "Conta Google", currency: "BRL", timezone: "America/Sao_Paulo" };
    const data = buildGoogleAnalytics({ account, dateFrom: "2026-10-01", dateTo: "2026-10-01", rows: { daily: [], previousDaily: [], campaigns: [] } });
    const input = toReportPdfInput({ title: "t", clientName: "RM", workspaceName: "w", headerDetails: "", data, metrics: [], entityLabels: [], accountLabels: [], comparison: false, chartType: "line", platform: "google" });
    expect(input).toMatchObject({ platformLabel: "Google Ads", accountLabel: "Conta Google", brandColor: "#D93025" });
  });
});

describe("sem token de desenvolvedor", () => {
  it("não envia o cabeçalho quando o token não existe", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher = async (url: string, init: { method: string; headers: Record<string, string> }) => { seen.push(init.headers); return url.includes("oauth2") ? reply(200, { access_token: "t" }) : reply(200, { results: [] }); };
    await new GoogleAdsClient({ ...credentials, developerToken: null }, { fetcher }).search("1112223333", "SELECT 1");
    expect(seen.at(-1)).not.toHaveProperty("developer-token");
  });
});

describe("contas de acesso direto", () => {
  it("lista as contas acessíveis e lê os dados de cada uma sem usar o gerente da conexão", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      if (url.includes("oauth2")) return reply(200, { access_token: "t" });
      if (url.includes("listAccessibleCustomers")) return reply(200, { resourceNames: ["customers/7444643364", "customers/5926576842", "lixo"] });
      return reply(200, { results: [{ customer: { id: "7444643364", descriptiveName: "iGrow Digital", currencyCode: "BRL", timeZone: "America/Sao_Paulo", manager: false, status: "ENABLED" } }] });
    };
    const client = new GoogleAdsClient(credentials, { fetcher });
    expect(await client.listAccessibleCustomerIds()).toEqual(["7444643364", "5926576842"]);
    expect(await client.directAccountInfo("744-464-3364")).toMatchObject({ customerId: "7444643364", name: "iGrow Digital", manager: false });
    for (const call of calls.filter(item => item.url.includes("googleads"))) expect(call.headers).not.toHaveProperty("login-customer-id");
  });
  it("a conta vinculada a um gerente envia o gerente dela no acesso", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher = async (url: string, init: { method: string; headers: Record<string, string> }) => { seen.push(init.headers); return url.includes("oauth2") ? reply(200, { access_token: "t" }) : reply(200, { results: [] }); };
    const client = new GoogleAdsClient({ ...credentials, loginCustomerId: null }, { fetcher });
    await client.search("1112223333", "SELECT 1", { loginCustomerId: "5926576842" });
    expect(seen.at(-1)).toMatchObject({ "login-customer-id": "5926576842" });
  });
});

describe("campo de visualizações de vídeo", () => {
  it("as consultas pedem video_trueview_views (video_views não existe na API atual)", () => {
    expect(campaignQuery("2026-10-01", "2026-10-02")).toContain("metrics.video_trueview_views");
    expect(campaignQuery("2026-10-01", "2026-10-02")).not.toContain("metrics.video_views");
    expect(accountDailyQuery("2026-10-01", "2026-10-02")).not.toContain("metrics.video_views");
  });
  it("lê as visualizações do campo novo", () => {
    const account = { id: "a", customerId: "1112223333", name: "C", currency: "BRL", timezone: "America/Sao_Paulo" };
    const data = buildGoogleAnalytics({ account, dateFrom: "2026-10-01", dateTo: "2026-10-01", rows: { daily: [{ segments: { date: "2026-10-01" }, metrics: { costMicros: "10000000", impressions: "100", clicks: "5" } }], previousDaily: [],
      campaigns: [{ campaign: { id: "2", name: "YT", advertisingChannelType: "VIDEO" }, metrics: { costMicros: "10000000", impressions: "100", clicks: "5", videoTrueviewViews: "50" } }] } });
    expect(data.summary["result:provider:google:video_views"]).toBe(50);
  });
});

describe("desconectar o Google Ads", () => {
  it("revoga o acesso, apaga o token, desvincula os clientes e arquiva as contas", async () => {
    const { disconnectGoogle } = await import("@/modules/google-ads/server");
    const calls: string[] = [];
    const chain = (table: string): Record<string, unknown> => {
      const c: Record<string, unknown> = {};
      for (const name of ["select", "eq", "is", "in"]) c[name] = () => c;
      c.update = (values: Record<string, unknown>) => { calls.push(`${table}:update:${Object.keys(values).join(",")}`); return c; };
      c.maybeSingle = async () => ({ data: table === "google_connections" ? { id: "c1", integration_id: "i1" } : null, error: null });
      c.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      return c;
    };
    const service = {
      from: (table: string) => chain(table),
      rpc: (name: string) => { calls.push(`rpc:${name}`); const result = { data: null, error: null }; return Object.assign(Promise.resolve(result), { single: async () => ({ data: null, error: null }) }); },
    };
    const outcome = await disconnectGoogle(service as never, "ag", (async () => ({ ok: true })) as never);
    expect(outcome).toEqual({ revoked: false });
    expect(calls).toEqual(expect.arrayContaining(["rpc:delete_integration_secret", "integrations:update:connection_status", "google_connections:update:connected_at,login_customer_id,scopes,last_accounts_sync_at", "client_google_accounts:update:active", "google_ad_accounts:update:archived_at"]));
  });
});
