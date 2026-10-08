import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { parseEvolutionRecentHistory } from "@/modules/whatsapp/inbox-parse";
import { isRecentQrMessage } from "@/modules/whatsapp/recent-policy";
import { validWebhookToken, webhookToken } from "@/modules/whatsapp-qr/server";

const instance = "igrow-4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const epoch = "2026-10-08T06:56:41.28672+00:00";
const now = new Date("2026-10-08T07:05:00Z").getTime();
const message = (time: string, jid = "5586999991234@s.whatsapp.net", id = "abc") => ({
  key: { id, remoteJid: jid, fromMe: false },
  message: { conversation: "Mensagem anterior" },
  messageTimestamp: Math.floor(Date.parse(time) / 1000),
  pushName: "Maria",
});

describe("histórico recente importado ao vincular QR", () => {
  it("autentica a sessão vinculada e rejeita chave de sessão anterior", () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://example.org");
    vi.stubEnv("EVOLUTION_API_KEY", "key-test-only");
    try {
      const legacy = webhookToken(instance);
      const current = webhookToken(instance, epoch);
      expect(current).toBeTruthy();
      expect(current).not.toBe(legacy);
      expect(validWebhookToken(instance, current, epoch)).toBe(true);
      expect(validWebhookToken(instance, legacy, epoch)).toBe(false);
      expect(validWebhookToken(instance, current, "2026-10-08T07:10:00Z")).toBe(false);
      expect(validWebhookToken(instance, legacy)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("considera mensagens privadas e grupos na janela dos últimos 7 dias", () => {
    const parsed = parseEvolutionRecentHistory({
      event: "MESSAGES_SET",
      data: [
        message("2026-10-07T08:00:00Z", "5586999991234@s.whatsapp.net", "recent"),
        message("2026-10-07T09:00:00Z", "120363000000001@g.us", "group"),
        message("2026-09-29T08:00:00Z", "5586999991234@s.whatsapp.net", "old"),
        message("2026-10-07T08:00:00Z", "1234567890@lid", "lid"),
      ],
    });
    expect(parsed.map(m => m.externalId)).toEqual(["recent", "group", "old", "lid"]);
    expect(parsed.filter(m => isRecentQrMessage(m.sentAt, now)).map(m => m.externalId)).toEqual(["recent", "group", "lid"]);
    expect(parsed.find(m => m.externalId === "group")).toMatchObject({ isGroup: true, remoteId: "120363000000001@g.us" });
  });

  it("não importa evento diferente, sem horário nem lotes excessivos", () => {
    const valid = message("2026-10-07T08:00:00Z");
    expect(parseEvolutionRecentHistory({ event: "MESSAGES_UPSERT", data: [valid] })).toEqual([]);
    expect(parseEvolutionRecentHistory({ event: "MESSAGES_SET", data: [{ ...valid, messageTimestamp: null }] })).toEqual([]);
    expect(parseEvolutionRecentHistory({ event: "MESSAGES_SET", data: Array.from({ length: 21 }, (_, i) => message("2026-10-07T08:00:00Z", undefined, String(i))) })).toEqual([]);
  });
});
