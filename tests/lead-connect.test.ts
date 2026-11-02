import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { subscribePageToLeadgen } from "@/modules/lead-pages/connect";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("inscrição da Página no evento leadgen", () => {
  it("pega o token da Página, inscreve, confere e nunca mistura os tokens", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "TOKEN-DA-PAGINA", id: "392600590614089" }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{ name: "Groow", subscribed_fields: ["leadgen"] }] }));
    const result = await subscribePageToLeadgen({ pageId: "392600590614089", token: "TOKEN-DO-SISTEMA", apiVersion: "v25.0", appSecrets: ["segredo"], fetchImpl: fetchImpl as never });
    expect(result).toEqual({ ok: true, subscribed: [{ app: "Groow", fields: ["leadgen"] }] });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/v25.0/392600590614089?fields=access_token");
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-DO-SISTEMA");
    expect(calls[0]![0]).toContain(`appsecret_proof=${createHmac("sha256", "segredo").update("TOKEN-DO-SISTEMA").digest("hex")}`);
    expect(calls[1]![1].method).toBe("POST");
    expect(calls[1]![1].body).toBe("subscribed_fields=leadgen");
    expect((calls[1]![1].headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-DA-PAGINA");
    expect(calls[1]![0]).toContain(`appsecret_proof=${createHmac("sha256", "segredo").update("TOKEN-DA-PAGINA").digest("hex")}`);
    expect(calls.map(call => call[0]).join(" ")).not.toContain("TOKEN-");
  });

  it("explica a falha ao pegar o acesso da Página, com o código da Meta e sem tokens", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: { code: 10, error_subcode: 33, message: "Permissão ausente" } }, 400));
    const result = await subscribePageToLeadgen({ pageId: "392600590614089", token: "T", apiVersion: "v25.0", fetchImpl: fetchImpl as never });
    expect(result).toMatchObject({ ok: false, step: "page_token", status: 400, code: "10/33", message: "Permissão ausente" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falha quando a Meta não confirma success", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ access_token: "P" })).mockResolvedValueOnce(json({ success: false }));
    expect(await subscribePageToLeadgen({ pageId: "392600590614089", token: "T", apiVersion: "v25.0", fetchImpl: fetchImpl as never })).toMatchObject({ ok: false, step: "subscribe" });
  });
});

describe("prova de segurança (appsecret_proof) com mais de um segredo de app", () => {
  const proofError = () => json({ error: { code: 100, message: "Invalid appsecret_proof provided in the API argument" } }, 400);
  it("tenta o próximo segredo quando a Meta recusa a prova e segue com o que serve", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(proofError())
      .mockResolvedValueOnce(json({ access_token: "P" }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{ name: "Groow", subscribed_fields: ["leadgen"] }] }));
    const result = await subscribePageToLeadgen({ pageId: "392600590614089", token: "T", apiVersion: "v25.0", appSecrets: ["segredo-errado", "segredo-certo"], fetchImpl: fetchImpl as never });
    expect(result.ok).toBe(true);
    const urls = (fetchImpl.mock.calls as unknown as [string][]).map(call => call[0]);
    expect(urls[0]).toContain(createHmac("sha256", "segredo-errado").update("T").digest("hex"));
    expect(urls[1]).toContain(createHmac("sha256", "segredo-certo").update("T").digest("hex"));
  });
  it("sem prova também é tentado por último, e erros que não são da prova não passam para o próximo segredo", async () => {
    const onlyProofless = vi.fn(async (url: string) => url.includes("appsecret_proof") ? proofError() : json({ access_token: "P" }));
    expect((await subscribePageToLeadgen({ pageId: "392600590614089", token: "T", apiVersion: "v25.0", appSecrets: ["errado"], fetchImpl: onlyProofless as never }))).toMatchObject({ ok: false, step: "subscribe" });
    const expired = vi.fn(async () => json({ error: { code: 190, error_subcode: 460, message: "Session invalidated" } }, 401));
    expect(await subscribePageToLeadgen({ pageId: "392600590614089", token: "T", apiVersion: "v25.0", appSecrets: ["a", "b"], fetchImpl: expired as never })).toMatchObject({ ok: false, step: "page_token", code: "190/460" });
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
