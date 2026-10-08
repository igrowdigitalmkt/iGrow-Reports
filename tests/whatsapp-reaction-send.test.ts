import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";
import { WhatsAppGraph } from "@/modules/whatsapp/graph";

describe("outbound WhatsApp reactions", () => {
  it("uses the original Baileys message key, never a new text message", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{"key":{"id":"reaction-new"}}', { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = new EvolutionClient({ url: "https://bridge.example.test", key: "test-key" }, fetcher);
    await client.reactToMessage("igrow-test", { id: "ORIGINAL_ID", remoteJid: "12036300001@g.us", fromMe: false, participant: "5511988889999@s.whatsapp.net" }, "❤️");
    expect(requests[0].url).toContain("/message/sendReaction/igrow-test");
    expect(requests[0].body).toEqual({
      key: { id: "ORIGINAL_ID", remoteJid: "12036300001@g.us", fromMe: false, participant: "5511988889999@s.whatsapp.net" },
      reaction: "❤️",
    });
    await client.reactToMessage("igrow-test", { id: "ORIGINAL_ID", remoteJid: "12036300001@g.us", fromMe: true }, "");
    expect(requests[1].body).toMatchObject({ reaction: "", key: { id: "ORIGINAL_ID", fromMe: true } });
  });

  it("uses official reaction objects, including emoji removal", async () => {
    const original = globalThis.fetch;
    const sent: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response('{"messages":[{"id":"wamid.reaction"}]}', { status: 200 });
    }) as typeof fetch;
    try {
      const graph = new WhatsAppGraph({ apiVersion: "v23.0", accessToken: "test-key" });
      await graph.sendReaction("12345678901", "5511988889999", "wamid.original", "😂");
      await graph.sendReaction("12345678901", "5511988889999", "wamid.original", "");
      expect(sent[0]).toMatchObject({
        messaging_product: "whatsapp", type: "reaction", to: "5511988889999",
        reaction: { message_id: "wamid.original", emoji: "😂" },
      });
      expect(sent[1]).toMatchObject({ type: "reaction", reaction: { message_id: "wamid.original", emoji: "" } });
    } finally {
      globalThis.fetch = original;
    }
  });
});
