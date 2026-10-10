import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
// Execute the real method shipped in the provider patch, without accessing a real contact.
const patch = readFileSync("infra/evolution/igrow-labels.patch", "utf8");
const method = patch.match(/\+  public async igrowContactBlock\(data:[\s\S]*?\n\+  }/)?.[0].replace(/^\+/gm, "");
if (!method) throw new Error("Native block bridge missing");
const source = transpileModule(`class Bridge { ${method} }; Bridge;`, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
type Bridge = { stateConnection: { state: string }; mappedPhoneJid: ReturnType<typeof vi.fn>; client: { user: { id: string }; updateBlockStatus: ReturnType<typeof vi.fn>; fetchBlocklist: ReturnType<typeof vi.fn> }; igrowContactBlock(data: { peer: string; blocked?: boolean }): Promise<{ blocked: boolean }> };
const Constructor = runInNewContext(source, { BadRequestException: Error, jidNormalizedUser: (jid: string) => jid.replace(/:\d+(?=@)/, "") }) as new () => Bridge;
let bridge: Bridge;
beforeEach(() => {
  bridge = new Constructor(); bridge.stateConnection = { state: "open" };
  bridge.mappedPhoneJid = vi.fn().mockResolvedValue("5586999999999@s.whatsapp.net");
  bridge.client = { user: { id: "5586888888888:12@s.whatsapp.net" }, updateBlockStatus: vi.fn().mockResolvedValue(undefined), fetchBlocklist: vi.fn().mockResolvedValue([]) };
});
it("queries fresh native state without mutation and returns no block-list identities", async () => {
  bridge.client.fetchBlocklist.mockResolvedValue(["5586999999999@s.whatsapp.net", "5586777777777@s.whatsapp.net"]);
  expect(await bridge.igrowContactBlock({ peer: "123456789@lid" })).toEqual({ blocked: true });
  expect(bridge.mappedPhoneJid).toHaveBeenCalledWith("123456789@lid"); expect(bridge.client.updateBlockStatus).not.toHaveBeenCalled();
});
it("blocks only a proven identity and verifies the fresh block-list result", async () => {
  bridge.client.fetchBlocklist.mockResolvedValue(["5586999999999@s.whatsapp.net"]);
  expect(await bridge.igrowContactBlock({ peer: "123456789@lid", blocked: true })).toEqual({ blocked: true });
  expect(bridge.client.updateBlockStatus).toHaveBeenCalledWith("5586999999999@s.whatsapp.net", "block");
  bridge.client.fetchBlocklist.mockResolvedValue([]);
  expect(await bridge.igrowContactBlock({ peer: "5586999999999@s.whatsapp.net", blocked: false })).toEqual({ blocked: false });
  expect(bridge.client.updateBlockStatus).toHaveBeenLastCalledWith("5586999999999@s.whatsapp.net", "unblock");
  await expect(bridge.igrowContactBlock({ peer: "5586999999999@s.whatsapp.net", blocked: true })).rejects.toThrow("did not confirm");
});
it("refuses an unknown LID, disconnected session and connected account without native writes", async () => {
  bridge.mappedPhoneJid.mockResolvedValue(undefined);
  await expect(bridge.igrowContactBlock({ peer: "123456789@lid", blocked: true })).rejects.toThrow("identity unavailable");
  await expect(bridge.igrowContactBlock({ peer: "5586888888888@s.whatsapp.net", blocked: true })).rejects.toThrow("connected account");
  bridge.stateConnection.state = "close";
  await expect(bridge.igrowContactBlock({ peer: "5586999999999@s.whatsapp.net", blocked: true })).rejects.toThrow("disconnected");
  expect(bridge.client.updateBlockStatus).not.toHaveBeenCalled(); expect(bridge.client.fetchBlocklist).not.toHaveBeenCalled();
});
