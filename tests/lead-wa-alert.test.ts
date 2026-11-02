import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatInstantMessage, type AlertLead } from "@/modules/lead-pages/alerts-core";

const lead: AlertLead = {
  id: "l1", name: "Maria", phone: "+5586988887777", email: null, campaignId: null, campaignName: null, adsetName: null, adName: null,
  formId: null, formName: "", platform: null, answers: [], createdTime: "2026-11-02T15:00:00.000Z", channel: "whatsapp", firstMessage: "Olá, quero saber o valor",
};

describe("alerta de lead por WhatsApp", () => {
  it("mostra o canal e a primeira mensagem, sem linha de formulário", () => {
    const text = formatInstantMessage({ clientName: "Colégio Crescer", lead });
    expect(text).toContain("📣 WhatsApp");
    expect(text).toContain("💬 “Olá, quero saber o valor”");
    expect(text).not.toContain("📝");
  });
  it("lead com anúncio identificado mostra a origem junto do canal", () => {
    const text = formatInstantMessage({ clientName: "Colégio Crescer", lead: { ...lead, campaignName: "Matrículas 2027", adName: "Vídeo 1" } });
    expect(text).toContain("📣 WhatsApp · Matrículas 2027 › Vídeo 1");
  });
});
