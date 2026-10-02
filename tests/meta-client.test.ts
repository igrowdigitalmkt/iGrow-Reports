import { describe, expect, it, vi } from "vitest";
import { hasBusinessPortfolio, hasMetaAdsReadPermission, MetaApiError, MetaClient } from "@/modules/meta/client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MetaClient", () => {
  it("associa a miniatura ao criativo do anúncio sem consultar outras contas", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "123", creative: { id: "456", thumbnail_url: "https://images.fbcdn.net/ad.jpg" } }] }));
    const client = new MetaClient({ accessToken: "token", apiVersion: "v26.0", fetchImpl: fetchImpl as typeof fetch });
    const ads = await client.listAds("act_1");
    expect(ads[0].creative?.thumbnail_url).toBe("https://images.fbcdn.net/ad.jpg");
    const requested = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(requested[0][0].pathname).toBe("/v26.0/act_1/ads");
    expect(requested[0][0].searchParams.get("fields")).toContain("creative{id,thumbnail_url}");
  });
  it("exige um ID real de portfólio; nome empresarial sozinho não basta", () => {
    const account = { id: "act_1", name: "Conta", currency: "BRL", timezone_name: "America/Sao_Paulo" };
    expect(hasBusinessPortfolio(account)).toBe(false);
    expect(hasBusinessPortfolio({ ...account, business: { name: "Empresa" } })).toBe(false);
    expect(hasBusinessPortfolio({ ...account, business: { id: "123", name: "Empresa" } })).toBe(true);
  });

  it("consulta metadados atuais da conta e rejeita respostas de outra conta", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "act_2" }));
    const client = new MetaClient({ accessToken: "token", apiVersion: "v26.0", fetchImpl: fetchImpl as typeof fetch });
    await expect(client.getAdAccount("act_1")).rejects.toBeInstanceOf(MetaApiError);
    const requested = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(requested[0][0].searchParams.get("fields")).toContain("business{id,name}");
  });
  it("exige ads_read para conexão somente leitura", () => {
    expect(hasMetaAdsReadPermission(["ads_read"])).toBe(true);
    expect(hasMetaAdsReadPermission(["business_management"])).toBe(false);
    expect(hasMetaAdsReadPermission(["ads_management"])).toBe(false);
  });

  it("envia o token somente no header e pagina por cursor", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({ url, init });
      if (calls.length === 1) {
        return jsonResponse({
          data: [{
            id: "act_1",
            name: "Conta 1",
            currency: "BRL",
            timezone_name: "America/Sao_Paulo",
          }],
          paging: {
            cursors: { after: "CURSOR_2" },
            next: "https://graph.facebook.com/fake?access_token=segredo",
          },
        });
      }
      return jsonResponse({
        data: [{
          id: "act_2",
          name: "Conta 2",
          currency: "BRL",
          timezone_name: "America/Sao_Paulo",
        }],
      });
    });

    const client = new MetaClient({
      accessToken: "TOKEN_SUPER_SECRETO",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const accounts = await client.listAdAccounts();
    expect(accounts).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.toString()).not.toContain("TOKEN_SUPER_SECRETO");
    expect(calls[0].url.searchParams.has("access_token")).toBe(false);
    expect(new Headers(calls[0].init?.headers).get("authorization"))
      .toBe("Bearer TOKEN_SUPER_SECRETO");
    expect(calls[1].url.searchParams.get("after")).toBe("CURSOR_2");
    expect(calls[1].url.toString()).not.toContain("segredo");
  });

  it("usa contas atribuídas ao usuário do sistema quando me/adaccounts vier vazio", async () => {
    const requested: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requested.push(url);
      if (requested.length === 1) return jsonResponse({ data: [] });
      return jsonResponse({
        data: [{
          id: "act_123",
          account_id: "123",
          name: "Conta atribuída",
          currency: "BRL",
          timezone_name: "America/Sao_Paulo",
        }],
      });
    });

    const client = new MetaClient({
      accessToken: "TOKEN_SUPER_SECRETO",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const accounts = await client.listAdAccounts("61594716222225");
    expect(accounts).toHaveLength(1);
    expect(requested[0].pathname).toContain("/v99.0/me/adaccounts");
    expect(requested[1].pathname).toContain("/v99.0/61594716222225/assigned_ad_accounts");
    expect(requested[1].searchParams.has("access_token")).toBe(false);
  });

  it("sanitiza erros da Graph API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: {
        message: "Token TOKEN_SUPER_SECRETO expirou",
        code: 190,
        error_subcode: 463,
        is_transient: false,
      },
    }, 400));

    const client = new MetaClient({
      accessToken: "TOKEN_SUPER_SECRETO",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as typeof fetch,
    });

    try {
      await client.listAdAccounts();
      throw new Error("Deveria falhar");
    } catch (error) {
      expect(error).toBeInstanceOf(MetaApiError);
      expect((error as Error).message).not.toContain("TOKEN_SUPER_SECRETO");
      expect((error as MetaApiError).code).toBe(190);
      expect((error as MetaApiError).subcode).toBe(463);
    }
  });

  it("monta Insights diários com período explícito", async () => {
    let requested: URL | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requested = input instanceof URL ? input : new URL(String(input));
      return jsonResponse({ data: [] });
    });
    const client = new MetaClient({
      accessToken: "token",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.getDailyInsights({
      adAccountId: "act_123456",
      since: "2026-09-01",
      until: "2026-09-30",
      level: "account",
    });

    expect(requested).not.toBeNull();
    const url = requested as unknown as URL;
    expect(url.pathname).toContain("/v99.0/act_123456/insights");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range") ?? "{}"))
      .toEqual({ since: "2026-09-01", until: "2026-09-30" });
    expect(url.searchParams.get("level")).toBe("account");
  });

  it("bloqueia identificador de conta inválido antes da rede", async () => {
    const fetchImpl = vi.fn();
    const client = new MetaClient({
      accessToken: "token",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getDailyInsights({
      adAccountId: "123456",
      since: "2026-09-01",
      until: "2026-09-30",
    })).rejects.toThrow("ID de conta de anúncios inválido.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("encerra a paginação no último resultado mesmo quando ainda há cursor", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{
        id: "act_1",
        name: "Conta",
        currency: "BRL",
        timezone_name: "America/Sao_Paulo",
      }],
      paging: { cursors: { after: "MESMO_CURSOR" } },
    }));
    const client = new MetaClient({
      accessToken: "token",
      apiVersion: "v99.0",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const data = await client.listAdAccounts();
    expect(data).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recupera o cursor de paging.next sem encaminhar credenciais da URL", async () => {
    const requested: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requested.push(input instanceof URL ? input : new URL(String(input)));
      return jsonResponse(requested.length === 1
        ? { data: [], paging: { next: "https://graph.facebook.com/v26.0/act_1/insights?after=NEXT&access_token=LEAK" } }
        : { data: [] });
    });
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", fetchImpl: fetchImpl as typeof fetch });
    await client.getDailyInsights({ adAccountId: "act_1", since: "2026-09-01", until: "2026-09-30" });
    expect(requested).toHaveLength(2);
    expect(requested[1].searchParams.get("after")).toBe("NEXT");
    expect(requested[1].searchParams.has("access_token")).toBe(false);
  });

  it("rejeita paginação repetida em vez de devolver uma coleta parcial", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "act_1" }], paging: { cursors: { after: "SAME" }, next: "https://graph.facebook.com/next?after=SAME" } }));
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", fetchImpl: fetchImpl as typeof fetch });
    await expect(client.listAdAccounts()).rejects.toThrow("Paginação Meta não avançou.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("repete falhas transitórias de forma limitada e não repete tokens expirados", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 2, is_transient: true } }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 4 } }, 429))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", retryDelayMs: 0, fetchImpl });
    await expect(client.listPermissions()).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    fetchImpl.mockReset().mockResolvedValue(jsonResponse({ error: { code: 190 } }, 400));
    await expect(client.listPermissions()).rejects.toBeInstanceOf(MetaApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("limita erros de rede e aborta requisições sem expor o token", async () => {
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("secret in transport error")));
    }));
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", timeoutMs: 5, retryDelayMs: 0, fetchImpl: fetchImpl as typeof fetch });
    await expect(client.listPermissions()).rejects.toMatchObject({ httpStatus: 504, transient: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("solicita alcance único agregado na janela completa sem somar dias", async () => {
    let requested: URL | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requested = input instanceof URL ? input : new URL(String(input));
      return jsonResponse({ data: [] });
    });
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", fetchImpl: fetchImpl as typeof fetch });
    await client.getPeriodInsights({ adAccountId: "act_1", since: "2025-10-01", until: "2026-09-30" });
    const url = requested as unknown as URL;
    expect(url.searchParams.get("time_increment")).toBe("all_days");
    expect(url.searchParams.get("fields")?.split(",")).toEqual(expect.arrayContaining(["reach", "frequency", "unique_clicks", "inline_post_engagement"]));
  });

  it("rejeita datas impossíveis antes da rede", async () => {
    const fetchImpl = vi.fn();
    const client = new MetaClient({ accessToken: "secret", apiVersion: "v26.0", fetchImpl });
    await expect(client.getDailyInsights({ adAccountId: "act_1", since: "2026-02-30", until: "2026-03-01" })).rejects.toThrow("Data da consulta Meta inválida.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
