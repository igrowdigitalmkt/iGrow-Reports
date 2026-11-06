import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cachedGoogleRead, clearGoogleReadCache, googleCacheKey } from "@/modules/google-ads/read-cache";

const key = googleCacheKey({ kind: "sections", agencyId: "ag-1", clientId: "cl-1", dateFrom: "2026-11-01", dateTo: "2026-11-05" });

beforeEach(() => clearGoogleReadCache());

describe("cache curto das leituras do Google Ads", () => {
  it("a chave separa organização, cliente, tipo, período e contas (sem misturar dados)", () => {
    const base = { kind: "sections", agencyId: "ag-1", clientId: "cl-1", dateFrom: "2026-11-01", dateTo: "2026-11-05" };
    expect(googleCacheKey(base)).not.toBe(googleCacheKey({ ...base, agencyId: "ag-2" }));
    expect(googleCacheKey(base)).not.toBe(googleCacheKey({ ...base, clientId: "cl-2" }));
    expect(googleCacheKey(base)).not.toBe(googleCacheKey({ ...base, kind: "campaigns" }));
    expect(googleCacheKey(base)).not.toBe(googleCacheKey({ ...base, dateTo: "2026-11-06" }));
    expect(googleCacheKey({ ...base, accountIds: ["b", "a"] })).toBe(googleCacheKey({ ...base, accountIds: ["a", "b"] }));
    expect(googleCacheKey(base)).not.toBe(googleCacheKey({ ...base, accountIds: ["a"] }));
  });
  it("lê uma vez e reaproveita dentro do prazo; depois do prazo lê de novo", async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    let clock = 1_000;
    const options = { now: () => clock, ttlMs: 60_000 };
    expect(await cachedGoogleRead(key, load, options)).toEqual({ n: 1 });
    clock += 30_000;
    expect(await cachedGoogleRead(key, load, options)).toEqual({ n: 1 });
    clock += 31_000;
    expect(await cachedGoogleRead(key, load, options)).toEqual({ n: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("pedidos ao mesmo tempo compartilham uma única leitura", async () => {
    let release: (value: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const first = cachedGoogleRead(key, load);
    const second = cachedGoogleRead(key, load);
    release("ok");
    expect(await Promise.all([first, second])).toEqual(["ok", "ok"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("erro e resultado parcial não ficam guardados; fresh ignora o guardado", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("falhou")).mockResolvedValue("ok");
    await expect(cachedGoogleRead(key, failing)).rejects.toThrow("falhou");
    expect(await cachedGoogleRead(key, failing)).toBe("ok");
    expect(failing).toHaveBeenCalledTimes(2);

    const partial = vi.fn(async () => ({ failures: [1] }));
    await cachedGoogleRead(key + "x", partial, { cacheable: value => value.failures.length === 0 });
    await cachedGoogleRead(key + "x", partial, { cacheable: value => value.failures.length === 0 });
    expect(partial).toHaveBeenCalledTimes(2);

    const load = vi.fn(async () => load.mock.calls.length);
    await cachedGoogleRead(key + "y", load);
    expect(await cachedGoogleRead(key + "y", load, { fresh: true })).toBe(2);
  });
});
