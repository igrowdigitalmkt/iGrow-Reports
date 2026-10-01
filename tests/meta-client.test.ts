import { describe, expect, it, vi } from "vitest";
import { MetaApiError, MetaClient } from "@/modules/meta/client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MetaClient", () => {
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

  it("impede loop de paginação quando o cursor se repete", async () => {
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
    expect(data).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
