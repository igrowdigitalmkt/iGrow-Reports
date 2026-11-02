import { describe, expect, it } from "vitest";
import {
  canReceive, dueDigestSlots, formatDigestMessage, formatInstantMessage, formatTestMessage, isFreshLead, matchesRecipient, normalizeAlertPhone, parseSendTimes, parseWeekdays,
  type AlertLead,
} from "@/modules/lead-pages/alerts-core";

const lead = (over: Partial<AlertLead> = {}): AlertLead => ({
  id: "l1", name: "Eduardo Melo", phone: "+5586995560428", email: "edu@exemplo.com", campaignId: "50001", campaignName: "Terras Alphaville III", adsetName: "Público A", adName: "Vídeo 1",
  formId: "100001", formName: "Terras Alphaville III", platform: "ig", answers: [{ question: "Qual é seu interesse?", answer: "Construir para morar" }], createdTime: "2026-11-05T12:00:00.000Z", ...over,
});

describe("telefone e horários", () => {
  it("normaliza telefones brasileiros e internacionais", () => {
    expect(normalizeAlertPhone("(91) 98074-8371")).toBe("+5591980748371");
    expect(normalizeAlertPhone("91980748371")).toBe("+5591980748371");
    expect(normalizeAlertPhone("+55 91 98074-8371")).toBe("+5591980748371");
    expect(normalizeAlertPhone("5591980748371")).toBe("+5591980748371");
    expect(normalizeAlertPhone("+1 415 555 0123")).toBe("+14155550123");
    expect(normalizeAlertPhone("123")).toBeNull();
    expect(normalizeAlertPhone("")).toBeNull();
    expect(normalizeAlertPhone("abc")).toBeNull();
  });
  it("valida horários e dias da semana", () => {
    expect(parseSendTimes(["18:00", "09:00", "09:00"])).toEqual(["09:00", "18:00"]);
    expect(parseSendTimes(["25:00"])).toBeNull();
    expect(parseSendTimes(["9:00"])).toBeNull();
    expect(parseSendTimes(Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, "0")}:00`))).toBeNull();
    expect(parseWeekdays([5, 1, 1])).toEqual([1, 5]);
    expect(parseWeekdays([])).toBeNull();
    expect(parseWeekdays([7])).toBeNull();
  });
});

describe("quem recebe e quando", () => {
  it("filtro vazio recebe tudo; filtro de campanha ou formulário exige correspondência", () => {
    expect(matchesRecipient({ campaignIds: null, formIds: null }, lead())).toBe(true);
    expect(matchesRecipient({ campaignIds: ["50001"], formIds: null }, lead())).toBe(true);
    expect(matchesRecipient({ campaignIds: ["50002"], formIds: null }, lead())).toBe(false);
    expect(matchesRecipient({ campaignIds: ["50001"], formIds: null }, lead({ campaignId: null }))).toBe(false);
    expect(matchesRecipient({ campaignIds: null, formIds: ["100002"] }, lead())).toBe(false);
    expect(matchesRecipient({ campaignIds: [], formIds: [] }, lead({ campaignId: null, formId: null }))).toBe(true);
  });
  it("só pessoa ativa, sem PARAR e não removida recebe", () => {
    expect(canReceive({ active: true, optedOutAt: null, removedAt: null })).toBe(true);
    expect(canReceive({ active: false, optedOutAt: null, removedAt: null })).toBe(false);
    expect(canReceive({ active: true, optedOutAt: "2026-11-05T00:00:00Z", removedAt: null })).toBe(false);
    expect(canReceive({ active: true, optedOutAt: null, removedAt: "2026-11-05T00:00:00Z" })).toBe(false);
  });
  it("lead só é recente por 60 minutos", () => {
    const now = new Date("2026-11-05T13:00:00Z");
    expect(isFreshLead("2026-11-05T12:30:00Z", now)).toBe(true);
    expect(isFreshLead("2026-11-05T11:59:00Z", now)).toBe(false);
    expect(isFreshLead("2026-11-05T13:30:00Z", now)).toBe(false);
  });
  it("resumos vencem no horário, dentro de 3 horas, só nos dias escolhidos e no fuso da pessoa", () => {
    const rule = { mode: "scheduled" as const, sendTimes: ["09:00", "18:00"], weekdays: [1, 2, 3, 4, 5], timezone: "America/Sao_Paulo" };
    // 5/11/2026 é quinta; 09:30 em Brasília = 12:30 UTC.
    expect(dueDigestSlots(rule, new Date("2026-11-05T12:30:00Z")).map(slot => slot.key)).toEqual(["2026-11-05 09:00"]);
    expect(dueDigestSlots(rule, new Date("2026-11-05T11:30:00Z"))).toEqual([]);
    expect(dueDigestSlots(rule, new Date("2026-11-05T16:30:00Z"))).toEqual([]);
    expect(dueDigestSlots(rule, new Date("2026-11-05T21:10:00Z")).map(slot => slot.key)).toEqual(["2026-11-05 18:00"]);
    // 18:00 BRT = 21:00 UTC: ainda vale até 20:59 BRT (tolerância de 3 h) e não vale mais depois.
    expect(dueDigestSlots(rule, new Date("2026-11-05T23:50:00Z")).map(slot => slot.key)).toEqual(["2026-11-05 18:00"]);
    expect(dueDigestSlots(rule, new Date("2026-11-06T00:30:00Z"))).toEqual([]);
    // Sábado (7/11) fora dos dias escolhidos.
    expect(dueDigestSlots(rule, new Date("2026-11-07T12:30:00Z"))).toEqual([]);
    expect(dueDigestSlots({ ...rule, mode: "instant" }, new Date("2026-11-05T12:30:00Z"))).toEqual([]);
  });
});

describe("mensagens", () => {
  it("aviso instantâneo traz nome, contato, origem, respostas, link para chamar e como parar", () => {
    const text = formatInstantMessage({ clientName: "RM Imobiliária", lead: lead() });
    expect(text).toContain("*Novo lead* · RM Imobiliária");
    expect(text).toContain("*Eduardo Melo*");
    expect(text).toContain("(86) 99556-0428");
    expect(text).toContain("edu@exemplo.com");
    expect(text).toContain("Instagram · Terras Alphaville III › Público A › Vídeo 1");
    expect(text).toContain("Qual é seu interesse? Construir para morar");
    expect(text).toContain("https://wa.me/5586995560428");
    expect(text).toContain("responda PARAR");
  });
  it("lead sem nome e sem origem não quebra a mensagem", () => {
    const text = formatInstantMessage({ clientName: "RM", lead: lead({ name: null, phone: null, email: null, campaignName: null, adsetName: null, adName: null, platform: null, answers: [] }) });
    expect(text).toContain("*Sem nome*");
    expect(text).not.toContain("wa.me");
  });
  it("resumo conta os leads, lista até 12 e informa o restante", () => {
    const leads = Array.from({ length: 15 }, (_, index) => lead({ id: `l${index}`, name: `Lead ${index + 1}` }));
    const text = formatDigestMessage({ clientName: "RM Imobiliária", leads, since: new Date("2026-11-05T09:00:00Z"), timezone: "America/Sao_Paulo" });
    expect(text).toContain("15 leads novos desde 05/11");
    expect(text).toContain("12. *Lead 12*");
    expect(text).not.toContain("13. ");
    expect(text).toContain("… e mais 3.");
    expect(formatDigestMessage({ clientName: "RM", leads: [lead()], since: new Date(), timezone: "America/Sao_Paulo" })).toContain("1 lead novo");
  });
  it("mensagem de teste cumprimenta pelo primeiro nome", () => {
    expect(formatTestMessage({ clientName: "RM", recipientName: "Silvio" })).toContain("Oi, Silvio!");
  });
});
