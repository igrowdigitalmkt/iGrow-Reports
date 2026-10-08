import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";

describe("WhatsApp leve", () => {
  it("não solicita histórico completo na criação de uma sessão", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = new EvolutionClient({ url: "https://evo.example.test", key: "key" }, (async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await client.create("igrow-test");
    expect(calls[0].body).toMatchObject({ instanceName: "igrow-test", syncFullHistory: false });
  });

  it("inscreve apenas eventos ao vivo e não habilita importação histórica", async () => {
    const calls: unknown[] = [];
    const client = new EvolutionClient({ url: "https://evo.example.test", key: "key" }, (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await client.setWebhook("igrow-test", "https://app.example.test/api/webhooks/evolution", "signature");
    const config = (calls[0] as { webhook: { events: string[] } }).webhook;
    expect(config.events).toContain("MESSAGES_UPSERT");
    expect(config.events).not.toContain("MESSAGES_SET");
    expect(config.events).not.toContain("CHATS_SET");
    expect(config.events).not.toContain("CHATS_UPSERT");
    expect(config.events).toContain("CONNECTION_UPDATE");
  });
});
