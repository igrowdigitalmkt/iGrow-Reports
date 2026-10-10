import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EvolutionClient, EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { formatJidPhone, formatPairingCode, instanceNameFor, normalizePairingPhone } from "@/modules/whatsapp-qr/format";

describe("formatação", () => {
  it("aceita número brasileiro com ou sem +55 e recusa número curto", () => {
    expect(normalizePairingPhone("(86) 99403-7823")).toBe("5586994037823");
    expect(normalizePairingPhone("+55 86 9403-7823")).toBe("558694037823");
    expect(normalizePairingPhone("+1 415 555 0100")).toBe("14155550100");
    expect(normalizePairingPhone("9999-9999")).toBeNull();
  });

  it("mostra o número conectado e o código em formato legível", () => {
    expect(formatJidPhone("5586994037823@s.whatsapp.net")).toBe("+55 (86) 99403-7823");
    expect(formatJidPhone("5586994037823:12@s.whatsapp.net")).toBe("+55 (86) 99403-7823");
    expect(formatJidPhone(null)).toBeNull();
    expect(formatPairingCode("k2xxgdez")).toBe("K2XX-GDEZ");
    expect(instanceNameFor("abc")).toBe("igrow-abc");
  });
});

describe("EvolutionClient", () => {
  const config = { url: "https://evo.example.test", key: "segredo" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("envia a chave em todo pedido e lê o estado da conexão", async () => {
    const fetcher = vi.fn(async () => reply(200, { instance: { instanceName: "igrow-a", state: "open" } }));
    const client = new EvolutionClient(config, fetcher as unknown as typeof fetch);
    expect(await client.state("igrow-a")).toBe("open");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.example.test/instance/connectionState/igrow-a");
    expect((init.headers as Record<string, string>).apikey).toBe("segredo");
  });

  it("instância inexistente vira nulo, e outros erros são explicados", async () => {
    const missing = new EvolutionClient(config, (async () => reply(404, { error: "not found" })) as unknown as typeof fetch);
    expect(await missing.state("igrow-x")).toBeNull();
    const broken = new EvolutionClient(config, (async () => reply(500, {})) as unknown as typeof fetch);
    await expect(broken.state("igrow-x")).rejects.toBeInstanceOf(EvolutionError);
    const offline = new EvolutionClient(config, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    await expect(offline.state("igrow-x")).rejects.toThrow("O servidor do WhatsApp não respondeu.");
  });

  it("devolve só grupos de verdade, com nome padrão quando falta", async () => {
    const client = new EvolutionClient(config, (async () => reply(200, [
      { id: "1203@g.us", subject: " Diretoria ", size: 5 }, { id: "x@s.whatsapp.net", subject: "Contato" }, { id: "99@g.us" },
    ])) as unknown as typeof fetch);
    expect(await client.groups("igrow-a")).toEqual([
      { id: "1203@g.us", subject: "Diretoria", size: 5 }, { id: "99@g.us", subject: "Grupo sem nome", size: null },
    ]);
  });

  it("confirma grupos em comum por telefone ou LID sem expor participantes", async () => {
    const fetcher = vi.fn(async () => reply(200, [
      { id: "1@g.us", subject: " Equipe ", participants: [{ id: "123@lid", phoneNumber: "5586999999999@s.whatsapp.net" }] },
      { id: "2@g.us", participants: [{ id: "5586999999999:2@s.whatsapp.net" }] },
      { id: "3@g.us", participants: [{ id: "999@lid" }] },
      { id: "4@s.whatsapp.net", participants: [{ id: "5586999999999@s.whatsapp.net" }] },
    ]));
    const client = new EvolutionClient(config, fetcher as unknown as typeof fetch);
    expect(await client.commonGroups("igrow-a", "5586999999999")).toEqual({ groups: [{ id: "1@g.us", subject: "Equipe" }, { id: "2@g.us", subject: "Grupo sem nome" }], incomplete: true });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain("getParticipants=true");
    expect(await client.commonGroups("igrow-a", "123@lid")).toEqual({ groups: [{ id: "1@g.us", subject: "Equipe" }], incomplete: false });
  });

  it("envia texto com atraso de digitação", async () => {
    const fetcher = vi.fn(async () => reply(201, { key: { id: "abc" } }));
    await new EvolutionClient(config, fetcher as unknown as typeof fetch).sendText("igrow-a", "5586994037823", "Olá");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.example.test/message/sendText/igrow-a");
    expect(JSON.parse(String(init.body))).toEqual({ number: "5586994037823", text: "Olá", delay: 1200 });
  });
});
