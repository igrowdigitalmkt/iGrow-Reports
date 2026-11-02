import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  accessCodeMatches, fetchLead, generateAccessCode, hashAccessCode, normalizePhone, parseLeadFields, parseLeadgenEvents, processLeadgenEvents,
  type FetchedLead, type LeadPage,
} from "@/modules/lead-pages/leads";
import { startOfTodayBrasilia } from "@/modules/lead-pages/store";
import { ago } from "@/modules/lead-pages/lead-feed-view";

const webhook = (changes: unknown[]) => ({ object: "page", entry: [{ id: "111222333", time: 1, changes }] });
const change = (value: Record<string, unknown>) => ({ field: "leadgen", value });

describe("aviso leadgen da Meta", () => {
  it("lê os leads novos e converte a hora", () => {
    const events = parseLeadgenEvents(webhook([change({ leadgen_id: "9988776655", page_id: "111222333", form_id: "5544332211", ad_id: "77", adgroup_id: "88", created_time: 1_790_000_000 })]));
    expect(events).toEqual([{ leadgenId: "9988776655", pageId: "111222333", formId: "5544332211", adId: "77", adsetId: "88", createdTime: new Date(1_790_000_000_000).toISOString() }]);
  });
  it("ignora outros campos, objetos e formatos inesperados", () => {
    expect(parseLeadgenEvents({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseLeadgenEvents(webhook([{ field: "feed", value: { leadgen_id: "1" } }]))).toEqual([]);
    expect(parseLeadgenEvents(webhook([change({ page_id: "1" })]))).toEqual([]);
    expect(parseLeadgenEvents(null)).toEqual([]);
    expect(parseLeadgenEvents({ object: "page", entry: "x" })).toEqual([]);
  });
  it("usa o id da entrada quando o aviso não traz page_id", () => {
    expect(parseLeadgenEvents(webhook([change({ leadgen_id: "12345" })]))[0]?.pageId).toBe("111222333");
  });
});

describe("campos do formulário", () => {
  it("extrai nome, WhatsApp e e-mail", () => {
    const fields = parseLeadFields([
      { name: "full_name", values: ["Ana Souza"] }, { name: "phone_number", values: ["p:+5586999990000"] }, { name: "email", values: ["ANA@Exemplo.com"] }, { name: "cidade", values: ["Teresina"] },
    ]);
    expect(fields).toEqual({ name: "Ana Souza", phone: "+5586999990000", email: "ana@exemplo.com" });
  });
  it("monta o nome de primeiro nome + sobrenome e aceita campos em português", () => {
    expect(parseLeadFields([{ name: "first_name", values: ["Ana"] }, { name: "last_name", values: ["Souza"] }, { name: "telefone", values: ["(86) 99999-0000"] }]))
      .toMatchObject({ name: "Ana Souza", phone: "86999990000" });
  });
  it("tolera dados ausentes ou malformados", () => {
    expect(parseLeadFields(undefined)).toEqual({ name: null, phone: null, email: null });
    expect(parseLeadFields([{ name: "email", values: [] }, null, { values: ["x"] }])).toEqual({ name: null, phone: null, email: null });
  });
  it("normaliza telefones", () => {
    expect(normalizePhone("p:+55 (86) 99999-0000")).toBe("+5586999990000");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("código de acesso do link privado", () => {
  it("só confere o código certo contra o hash guardado", () => {
    const code = generateAccessCode();
    const hash = hashAccessCode(code);
    expect(code.length).toBeGreaterThanOrEqual(24);
    expect(accessCodeMatches(code, hash)).toBe(true);
    expect(accessCodeMatches(`${code}x`, hash)).toBe(false);
    expect(accessCodeMatches("", hash)).toBe(false);
    expect(accessCodeMatches(code, null)).toBe(false);
    expect(accessCodeMatches(code, "não-é-hash")).toBe(false);
  });
});

describe("leitura do lead na Graph API", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it("envia o token no cabeçalho, assina com appsecret_proof e normaliza a resposta", async () => {
    const fetchImpl = ok({ id: "9988776655", created_time: "2026-11-02T13:00:00+0000", form_id: "55", ad_id: "7", campaign_id: "9", field_data: [{ name: "email", values: ["a@b.co"] }] });
    const lead = await fetchLead({ leadgenId: "9988776655", token: "TOKEN", apiVersion: "v25.0", appSecrets: ["segredo"], fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://graph.facebook.com/v25.0/9988776655?fields=");
    expect(url).toContain(`appsecret_proof=${createHmac("sha256", "segredo").update("TOKEN").digest("hex")}`);
    expect(url).not.toContain("TOKEN");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(lead).toMatchObject({ leadgenId: "9988776655", formId: "55", adId: "7", campaignId: "9", createdTime: "2026-11-02T13:00:00.000Z" });
  });
  it("falha quando a Meta recusa", async () => {
    await expect(fetchLead({ leadgenId: "1234567", token: "t", apiVersion: "v25.0", fetchImpl: ok({ error: { code: 190 } }, 400) as never })).rejects.toThrow();
    await expect(fetchLead({ leadgenId: "1234567", token: "t", apiVersion: "v25.0", fetchImpl: ok({ id: "1", error: { code: 1 } }) as never })).rejects.toThrow();
  });
});

describe("processamento dos avisos", () => {
  const page: LeadPage = { id: "p1", slug: "leads-cadastro-rmimobiliaria", title: "RM", fbPageId: "111222333", formId: null };
  const lead: FetchedLead = { leadgenId: "9988776655", formId: null, adId: null, adsetId: null, campaignId: "9", createdTime: null, adName: null, adsetName: null, campaignName: null, platform: null, isOrganic: null, fieldData: [{ name: "full_name", values: ["Ana"] }, { name: "phone_number", values: ["+5586999990000"] }] };
  const events = parseLeadgenEvents(webhook([change({ leadgen_id: "9988776655", form_id: "55", ad_id: "7", created_time: 1_790_000_000 })]));

  it("grava o lead com nome e telefone, completando form, anúncio e hora com o aviso", async () => {
    const save = vi.fn(async () => undefined);
    const result = await processLeadgenEvents(events, { findPages: async () => [page], fetchLead: async () => lead, save });
    expect(result).toEqual({ saved: 1, ignored: 0, retry: false });
    expect(save).toHaveBeenCalledWith(page, expect.objectContaining({ formId: "55", adId: "7", createdTime: new Date(1_790_000_000_000).toISOString() }), { name: "Ana", phone: "+5586999990000", email: null });
  });
  it("ignora Página sem acompanhamento e nem consulta a Meta", async () => {
    const fetchSpy = vi.fn(async () => lead);
    const result = await processLeadgenEvents(events, { findPages: async () => [], fetchLead: fetchSpy, save: vi.fn() });
    expect(result).toEqual({ saved: 0, ignored: 1, retry: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("pede nova tentativa quando a Meta ou o banco falham, sem perder os demais leads", async () => {
    const two = parseLeadgenEvents(webhook([change({ leadgen_id: "1111111" }), change({ leadgen_id: "2222222" })]));
    const save = vi.fn(async () => undefined);
    const result = await processLeadgenEvents(two, { findPages: async () => [page], fetchLead: async id => { if (id === "1111111") throw new Error("Graph 500"); return lead; }, save });
    expect(result).toEqual({ saved: 1, ignored: 0, retry: true });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("apresentação", () => {
  it("o dia de hoje começa à meia-noite de Brasília", () => {
    expect(startOfTodayBrasilia(new Date("2026-11-02T14:30:00Z"))).toBe("2026-11-02T03:00:00.000Z");
    expect(startOfTodayBrasilia(new Date("2026-11-02T02:59:00Z"))).toBe("2026-11-01T03:00:00.000Z");
  });
  it("tempo decorrido legível", () => {
    expect(ago(20_000)).toBe("agora");
    expect(ago(3 * 60_000)).toBe("há 3 min");
    expect(ago(2 * 3_600_000)).toBe("há 2 h");
    expect(ago(4 * 86_400_000)).toBe("há 4 d");
  });
});

describe("telefone na tela", () => {
  it("formata celular brasileiro e preserva o resto", async () => {
    const { formatPhone } = await import("@/modules/lead-pages/lead-feed-view");
    expect(formatPhone("+5586999990001")).toBe("(86) 99999-0001");
    expect(formatPhone("+558633334444")).toBe("(86) 3333-4444");
    expect(formatPhone("+14155550123")).toBe("+14155550123");
  });
});

describe("origem do lead (Graph API)", () => {
  it("lê campanha, conjunto, anúncio, plataforma e se é orgânico, e pede esses campos", async () => {
    const { toFetchedLead } = await import("@/modules/lead-pages/leads");
    expect(toFetchedLead({ id: "1809871194478333", form_id: "55", campaign_id: "9", campaign_name: "Terras", adset_id: "8", adset_name: "Público A", ad_id: "7", ad_name: "Vídeo 1", platform: "ig", is_organic: false, field_data: [] }, "x"))
      .toMatchObject({ campaignName: "Terras", adsetName: "Público A", adName: "Vídeo 1", platform: "ig", isOrganic: false });
    expect(toFetchedLead({ id: "1" }, "x")).toMatchObject({ campaignName: null, platform: null, isOrganic: null });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "1809871194478333", campaign_name: "Terras", field_data: [] })));
    await fetchLead({ leadgenId: "1809871194478333", token: "t", apiVersion: "v25.0", fetchImpl: fetchImpl as never });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain("campaign_name");
  });
});

describe("formulário com perguntas próprias", () => {
  it("reconhece e-mail, contato e nome pelo conteúdo e devolve as demais respostas", async () => {
    const { splitLeadFields, prettyQuestion } = await import("@/modules/lead-pages/leads");
    const result = splitLeadFields([
      { name: "qual_o_seu_nome?", values: ["Ana Souza"] }, { name: "qual_o_seu_contato?", values: ["(86) 99999-0001"] }, { name: "seu_melhor_email", values: ["Ana@Exemplo.com"] },
      { name: "você_tem_interesse_em_visitar_o_apartamento?", values: ["Sim, sábado"] },
    ]);
    expect(result.fields).toEqual({ name: "Ana Souza", phone: "86999990001", email: "ana@exemplo.com" });
    expect(result.answers).toEqual([{ question: "Você tem interesse em visitar o apartamento?", answer: "Sim, sábado" }]);
    expect(prettyQuestion("qual_o_seu_contato?")).toBe("Qual o seu contato?");
  });
  it("não confunde a resposta de teste da Meta com contato e mantém tudo como resposta", async () => {
    const { splitLeadFields } = await import("@/modules/lead-pages/leads");
    const result = splitLeadFields([{ name: "qual_o_seu_contato?", values: ["<test lead: dummy data for qual_o_seu_contato?>"] }]);
    expect(result.fields).toEqual({ name: null, phone: null, email: null });
    expect(result.answers).toHaveLength(1);
  });
  it("campos padrão da Meta continuam sendo usados e não repetem como resposta", async () => {
    const { splitLeadFields } = await import("@/modules/lead-pages/leads");
    const result = splitLeadFields([{ name: "full_name", values: ["Ana"] }, { name: "phone_number", values: ["+5586999990001"] }, { name: "email", values: ["a@b.co"] }, { name: "cidade", values: ["Teresina"] }]);
    expect(result.fields).toEqual({ name: "Ana", phone: "+5586999990001", email: "a@b.co" });
    expect(result.answers).toEqual([{ question: "Cidade", answer: "Teresina" }]);
  });
});

describe("respostas em formato de código", () => {
  it("opções da Meta ganham texto legível; texto digitado não muda", async () => {
    const { prettyAnswer, splitLeadFields } = await import("@/modules/lead-pages/leads");
    expect(prettyAnswer("construir_para_morar")).toBe("Construir para morar");
    expect(prettyAnswer("Quero morar_aqui, sábado")).toBe("Quero morar_aqui, sábado");
    expect(prettyAnswer("sim")).toBe("sim");
    expect(splitLeadFields([{ name: "qual_é_seu_interesse_no_empreendimento?", values: ["construir_para_morar"] }]).answers)
      .toEqual([{ question: "Qual é seu interesse no empreendimento?", answer: "Construir para morar" }]);
  });
});
