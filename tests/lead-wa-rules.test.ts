import { describe, expect, it } from "vitest";
import { adFromEvolution, decideCapture, firstMessageText, phoneKey, type ExistingLead } from "@/modules/lead-pages/wa-rules";

const NOW = new Date("2026-11-02T15:00:00.000Z");
const base = { mode: "all" as const, now: NOW, ownPhone: "5586900000001", ignored: [] as string[], existing: [] as ExistingLead[], ad: null };
const msg = (patch: Partial<{ remoteId: string; isGroup: boolean; direction: "in" | "out"; sentAt: string }> = {}) => ({ remoteId: "5586988887777", isGroup: false, direction: "in" as const, sentAt: "2026-11-02T14:58:00.000Z", ...patch });

describe("captação de leads por WhatsApp", () => {
  it("compara telefones com e sem o nono dígito", () => {
    expect(phoneKey("558688887777")).toBe(phoneKey("5586988887777"));
    expect(phoneKey("+55 (86) 98888-7777")).toBe(phoneKey("5586988887777"));
    expect(phoneKey("5586988887777")).not.toBe(phoneKey("5586988886666"));
  });
  it("contato novo vira lead; o resto não", () => {
    expect(decideCapture({ ...base, message: msg() })).toEqual({ create: true });
    expect(decideCapture({ ...base, message: msg({ direction: "out" }) })).toEqual({ create: false, reason: "outgoing" });
    expect(decideCapture({ ...base, message: msg({ isGroup: true, remoteId: "1203630@g.us" }) })).toEqual({ create: false, reason: "group" });
    expect(decideCapture({ ...base, message: msg({ remoteId: "123" }) })).toEqual({ create: false, reason: "invalid_phone" });
    expect(decideCapture({ ...base, message: msg({ sentAt: "2026-11-02T13:00:00.000Z" }) })).toEqual({ create: false, reason: "old" });
    expect(decideCapture({ ...base, message: msg({ remoteId: "558600000001" }) })).toEqual({ create: false, reason: "own_number" });
  });
  it("respeita números ignorados e o modo escolhido", () => {
    expect(decideCapture({ ...base, ignored: ["(86) 98888-7777"], message: msg() })).toEqual({ create: false, reason: "ignored" });
    expect(decideCapture({ ...base, mode: "manual", message: msg() })).toEqual({ create: false, reason: "manual" });
    expect(decideCapture({ ...base, mode: "ads", message: msg() })).toEqual({ create: false, reason: "needs_ad" });
    expect(decideCapture({ ...base, mode: "ads", ad: { adId: "123456", title: "Matrículas", sourceUrl: null, clickId: null }, message: msg() })).toEqual({ create: true });
  });
  it("não duplica quem já é lead", () => {
    const recent: ExistingLead = { phone: "+5586988887777", status: "won", createdTime: "2026-10-20T10:00:00.000Z" };
    expect(decideCapture({ ...base, existing: [recent], message: msg() })).toEqual({ create: false, reason: "already_lead" });
    const oldOpen: ExistingLead = { phone: "5586988887777", status: "contacted", createdTime: "2026-06-01T10:00:00.000Z" };
    expect(decideCapture({ ...base, existing: [oldOpen], message: msg() })).toEqual({ create: false, reason: "already_lead" });
    const oldClosed: ExistingLead = { phone: "5586988887777", status: "lost", createdTime: "2026-06-01T10:00:00.000Z" };
    expect(decideCapture({ ...base, existing: [oldClosed], message: msg() })).toEqual({ create: true });
  });
  it("resume a primeira mensagem e lê o anúncio quando o aparelho informa", () => {
    expect(firstMessageText({ kind: "text", body: "  Olá,\n quero   saber o valor " })).toBe("Olá, quero saber o valor");
    expect(firstMessageText({ kind: "audio", body: null })).toBe("[áudio]");
    expect(firstMessageText({ kind: "text", body: "x".repeat(400) })?.length).toBe(300);
    const body = { data: { message: { extendedTextMessage: { text: "Oi", contextInfo: { externalAdReply: { sourceType: "ad", sourceId: "120210000000001", title: "Matrículas 2027", ctwaClid: "abc" } } } } } };
    expect(adFromEvolution(body)).toEqual({ adId: "120210000000001", title: "Matrículas 2027", sourceUrl: null, clickId: "abc" });
    expect(adFromEvolution({ data: { message: { conversation: "Oi" } } })).toBeNull();
  });
});
