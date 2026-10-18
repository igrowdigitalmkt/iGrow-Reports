import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";
const client = (response: unknown) => new EvolutionClient({ url: "https://provider.test", key: "test-key" },
  (async () => Response.json(response)) as typeof fetch);
const jid = "123456789012@lid";

describe("confirmações das etiquetas nativas", () => {
  it.each([null, {}, { numberJid: jid, labelId: "4", remove: true }, { numberJid: "other@lid", labelId: "4", add: true },
    { numberJid: jid, labelId: "5", add: true }, { numberJid: jid, labelId: "4", add: true, remove: true }])
  ("recusa inclusão não confirmada pelo mesmo contato, etiqueta e ação: %j", async response => {
    await expect(client(response).setChatLabel("instance", jid, "4", true)).rejects.toThrow("não confirmou");
  });
  it("aceita apenas a ação de associação confirmada", async () => {
    await expect(client({ numberJid: jid, labelId: "4", add: true }).setChatLabel("instance", jid, "4", true)).resolves.toMatchObject({ add: true });
    await expect(client({ numberJid: jid, labelId: "4", remove: true }).setChatLabel("instance", jid, "4", false)).resolves.toMatchObject({ remove: true });
    await expect(client({ numberJid: jid, labelId: "4", add: true }).setChatLabel("instance", jid, "4", false)).rejects.toThrow("não confirmou");
  });
  it.each([null, {}, { id: "5" }, { id: 4 }, { id: "invalid" }])("recusa metadados sem confirmação do ID solicitado: %j", async response => {
    await expect(client(response).editLabel("instance", { id: "4", name: "Teste", color: 1 })).rejects.toThrow("não confirmou");
  });
  it("aceita o ID nativo criado ou editado", async () => {
    await expect(client({ id: "4" }).editLabel("instance", { name: "Teste", color: 1 })).resolves.toEqual({ id: "4" });
    await expect(client({ id: "4" }).editLabel("instance", { id: "4", deleted: true })).resolves.toEqual({ id: "4" });
  });
  it.each([null, {}, { labels: [], chats: null }, { labels: [{ id: "4", name: "Teste" }], chats: [] },
    { labels: [], chats: [{ remoteJid: jid, labels: [4] }] }])("recusa snapshot inválido em vez de apresentar uma lista vazia: %j", async response => {
    await expect(client(response).labelSnapshot("instance")).rejects.toThrow("não confirmou");
  });
  it("aceita um snapshot vazio validamente confirmado", async () => {
    await expect(client({ labels: [], chats: [] }).labelSnapshot("instance")).resolves.toEqual({ labels: [], chats: [] });
  });
});
