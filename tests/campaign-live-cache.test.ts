import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ getMetaEntityStatuses: vi.fn() }));
import { cachedLiveReader, clearLiveCache, LIVE_CACHE_TTL_MS } from "@/modules/campaigns/live-cache";

const input = { agencyId: "a", clientId: "c", accountIds: ["x", "y"] };
const fakeRead = (ok = true) => vi.fn(async (_input, thumbs, catalog, raw, report) => {
  thumbs["x:ad:1"] = "https://scontent.fbcdn.net/t.jpg"; catalog.push({ accountId: "x", id: "1", name: "C" });
  raw["x:campaign:1"] = { configured: "ACTIVE", status: "ACTIVE", issues: false, accountBlocked: false };
  report.entities.push({ accountId: "x", level: "campaign", id: "1", name: "C", parentId: null, campaignId: "1" });
  report.accountsRead.push("x"); (ok ? report.accountsRead : report.accountsFailed).push("y");
  return { "x:campaign:1": "ACTIVE" };
});
const call = (reader: ReturnType<typeof cachedLiveReader>) => {
  const out = { thumbs: {} as Record<string, string>, catalog: [] as never[], raw: {} as never, report: { entities: [], accountsRead: [], accountsFailed: [] } as never };
  return reader(input, out.thumbs, out.catalog, out.raw, out.report).then(statuses => ({ statuses, ...out }));
};
beforeEach(() => clearLiveCache());

describe("cache curto da leitura ao vivo (somente visualização)", () => {
  it("reaproveita uma leitura completa dentro do prazo e repassa todos os dados", async () => {
    let now = 1_000; const read = fakeRead(); const seen: boolean[] = [];
    const reader = cachedLiveReader((_at, cached) => seen.push(cached), () => now, read as never);
    const first = await call(reader); now += LIVE_CACHE_TTL_MS - 1; const second = await call(reader);
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([false, true]);
    expect(second.statuses).toEqual(first.statuses);
    expect((second.report as unknown as { accountsRead: string[] }).accountsRead).toEqual(["x", "y"]);
    expect(second.thumbs["x:ad:1"]).toBeTruthy();
  });
  it("lê de novo depois do prazo e nunca reaproveita leitura incompleta", async () => {
    let now = 1_000; const ok = fakeRead(); const reader = cachedLiveReader(undefined, () => now, ok as never);
    await call(reader); now += LIVE_CACHE_TTL_MS + 1; await call(reader);
    expect(ok).toHaveBeenCalledTimes(2);
    clearLiveCache();
    const bad = fakeRead(false); const badReader = cachedLiveReader(undefined, () => now, bad as never);
    await call(badReader); await Promise.resolve(); await call(badReader);
    expect(bad).toHaveBeenCalledTimes(2);
  });
  it("não mistura clientes, organizações ou contas", async () => {
    const read = fakeRead(); const reader = cachedLiveReader(undefined, () => 1, read as never);
    await call(reader);
    await reader({ ...input, clientId: "outro" }, {}, [], {}, { entities: [], accountsRead: [], accountsFailed: [] });
    await reader({ ...input, agencyId: "b" }, {}, [], {}, { entities: [], accountsRead: [], accountsFailed: [] });
    await reader({ ...input, accountIds: ["z"] }, {}, [], {}, { entities: [], accountsRead: [], accountsFailed: [] }); // conta fora do que já foi lido
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("um subconjunto de contas reaproveita a leitura completa que o contém, sem trazer dados das outras contas", async () => {
    const read = vi.fn(async (_input, thumbs, catalog, raw, report) => {
      for (const id of ["x", "y"]) {
        thumbs[`${id}:ad:1`] = "https://scontent.fbcdn.net/t.jpg"; catalog.push({ accountId: id, id: "1", name: `C-${id}` });
        raw[`${id}:campaign:1`] = { configured: "ACTIVE", status: "ACTIVE", issues: false, accountBlocked: false };
        report.entities.push({ accountId: id, level: "campaign", id: "1", name: `C-${id}`, parentId: null, campaignId: "1" }); report.accountsRead.push(id);
      }
      return { "x:campaign:1": "ACTIVE", "y:campaign:1": "INACTIVE" };
    });
    const seen: boolean[] = [];
    const reader = cachedLiveReader((_at, cached) => seen.push(cached), () => 1, read as never);
    await call(reader); // x e y
    const out = { thumbs: {} as Record<string, string>, catalog: [] as { accountId: string }[], raw: {} as Record<string, unknown>, report: { entities: [] as { accountId: string }[], accountsRead: [] as string[], accountsFailed: [] as string[] } };
    const statuses = await reader({ ...input, accountIds: ["y"] }, out.thumbs, out.catalog as never, out.raw as never, out.report as never);
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([false, true]);
    expect(statuses).toEqual({ "y:campaign:1": "INACTIVE" });
    expect(Object.keys(out.thumbs)).toEqual(["y:ad:1"]);
    expect(Object.keys(out.raw)).toEqual(["y:campaign:1"]);
    expect(out.catalog.every(item => item.accountId === "y") && out.report.entities.every(item => item.accountId === "y")).toBe(true);
    expect(out.report.accountsRead).toEqual(["y"]);
  });
  it("não reaproveita uma leitura que não cobriu todas as contas pedidas", async () => {
    const bad = fakeRead(false); // x lida, y falhou
    const reader = cachedLiveReader(undefined, () => 1, bad as never);
    await call(reader); await Promise.resolve();
    await reader({ ...input, accountIds: ["y"] }, {}, [], {}, { entities: [], accountsRead: [], accountsFailed: [] });
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
