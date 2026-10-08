import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { resetQrSession } from "@/modules/whatsapp-qr/server";
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";

const agency = "4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const name = `igrow-${agency}`;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("reset QR e verificação da instância", () => {
  it("não considera estado close como prova de que uma instância removida ainda existe", async () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test");
    vi.stubEnv("EVOLUTION_API_KEY", "test-key");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("connectionState")) return reply({ instance: { state: "close" } });
      if (url.includes("fetchInstances")) return reply([]);
      throw new Error(`Unexpected request ${url}`);
    }));
    await expect(resetQrSession(agency)).resolves.toBeUndefined();
    expect(urls.every(url => url.includes("fetchInstances"))).toBe(true);
    expect(urls).toHaveLength(2);
  });

  it("apaga a instância existente e só conclui quando fetchInstances confirma", async () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test");
    vi.stubEnv("EVOLUTION_API_KEY", "test-key");
    let present = true;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("fetchInstances")) return reply(present ? [{ name, connectionStatus: "close" }] : []);
      if (url.includes("/instance/logout/")) return reply({ error: "já desconectado" }, 404);
      if (url.includes("/instance/delete/")) { present = false; return reply({ ok: true }); }
      throw new Error(`Unexpected request ${url}`);
    }));
    await expect(resetQrSession(agency)).resolves.toBeUndefined();
    expect(urls.some(url => url.includes("/instance/delete/"))).toBe(true);
    expect(present).toBe(false);
  });

  it("só reconhece a instância exata, mesmo que a API retorne outros nomes", async () => {
    const client = new EvolutionClient({ url: "https://evolution.example.test", key: "test-key" },
      (async () => reply([{ name: name + "-different", connectionStatus: "open" }])) as typeof fetch);
    await expect(client.instance(name)).resolves.toBeNull();
  });
});
