import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findLeadPages = vi.hoisted(() => vi.fn());
const saveLead = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/modules/lead-pages/store", () => ({ findLeadPages, saveLead }));

import { GET, POST } from "@/app/api/webhooks/meta/leadgen/route";

const SECRET = "segredo-do-app";
const body = JSON.stringify({ object: "page", entry: [{ id: "111222333", changes: [{ field: "leadgen", value: { leadgen_id: "9988776655", page_id: "111222333", form_id: "55" } }] }] });
const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
const post = (raw: string, signature: string | null) => POST(new Request("https://groowads.com/api/webhooks/meta/leadgen", { method: "POST", body: raw, headers: signature ? { "x-hub-signature-256": signature } : {} }));

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", SECRET);
  vi.stubEnv("META_LEADS_ACCESS_TOKEN", "token-de-leads");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verifica");
  findLeadPages.mockReset(); saveLead.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("webhook leadgen", () => {
  it("responde ao desafio de verificação da Meta só com o token certo", async () => {
    const ok = await GET(new Request("https://x/api?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=abc123"));
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("abc123");
    expect((await GET(new Request("https://x/api?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc123"))).status).toBe(403);
  });

  it("recusa aviso sem assinatura ou com assinatura inválida, sem consultar nada", async () => {
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, sign(`${body} `))).status).toBe(401);
    expect(findLeadPages).not.toHaveBeenCalled();
  });

  it("grava o lead de uma Página acompanhada", async () => {
    findLeadPages.mockResolvedValue([{ id: "p1", slug: "leads-cadastro-rmimobiliaria", title: "RM", fbPageId: "111222333", formId: null }]);
    const graph = vi.fn(async () => new Response(JSON.stringify({ id: "9988776655", field_data: [{ name: "full_name", values: ["Ana"] }] })));
    vi.stubGlobal("fetch", graph);
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);
    expect(saveLead).toHaveBeenCalledTimes(1);
    expect((graph.mock.calls[0] as unknown as [string])[0]).toContain("/v25.0/9988776655");
  });

  it("devolve 503 para a Meta repetir quando a leitura do lead falha, e não grava nada", async () => {
    findLeadPages.mockResolvedValue([{ id: "p1", slug: "s", title: "RM", fbPageId: "111222333", formId: null }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect((await post(body, sign(body))).status).toBe(503);
    expect(saveLead).not.toHaveBeenCalled();
  });

  it("aceita (200) aviso de Página que não é acompanhada, sem pedir repetição", async () => {
    findLeadPages.mockResolvedValue([]);
    expect((await post(body, sign(body))).status).toBe(200);
  });

  it("sem o token de leads configurado pede nova tentativa em vez de perder o lead", async () => {
    vi.stubEnv("META_LEADS_ACCESS_TOKEN", "");
    expect((await post(body, sign(body))).status).toBe(503);
  });
});
