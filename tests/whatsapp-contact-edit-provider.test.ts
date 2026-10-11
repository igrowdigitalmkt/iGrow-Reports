import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget } from "typescript";
import { expect, it, vi } from "vitest";
const patch = readFileSync("infra/evolution/igrow-labels.patch", "utf8");
const method = patch.match(/\+  public igrowContact\(data:[\s\S]*?\n\+  }/)?.[0].replace(/^\+/gm, "");
if (!method) throw new Error("Contact bridge missing");
const source = transpileModule(`class Bridge { ${method} }; Bridge;`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const Constructor = runInNewContext(source, { BadRequestException: Error, setTimeout: (callback: () => void) => callback() }) as new () => {
  stateConnection: { state: string }; igrowContactsReady: boolean; igrowContacts: Map<string, Record<string, unknown>>;
  igrowContactQueue: Promise<unknown>; mappedPhoneJid: ReturnType<typeof vi.fn>; eventProcessingQueue: Promise<void>;
  client: { chatModify: ReturnType<typeof vi.fn>; resyncAppState: ReturnType<typeof vi.fn> };
  igrowContact(data: { peer: string; fullName?: string; firstName?: string; expectedFullName?: string }): Promise<unknown>;
};
const peer = "5586999999999@s.whatsapp.net", lid = "123456789@lid";
function bridge() {
  const result = new Constructor(); result.stateConnection = { state: "open" }; result.igrowContactsReady = true;
  result.igrowContactQueue = Promise.resolve(); result.eventProcessingQueue = Promise.resolve();
  result.mappedPhoneJid = vi.fn().mockResolvedValue(undefined);
  result.igrowContacts = new Map([[peer, { fullName: "Contato antigo", firstName: "Contato", lidJid: lid, pnJid: peer, saveOnPrimaryAddressbook: true, username: "preservar" }]]);
  result.client = { resyncAppState: vi.fn().mockResolvedValue(undefined), chatModify: vi.fn().mockImplementation(async ({ contact }, jid) => { result.igrowContacts.set(jid, { ...contact }); }) };
  return result;
}
it("reads only the requested native contact, resolves an explicit PN/LID pair and never writes", async () => {
  const service = bridge();
  expect(await service.igrowContact({ peer: lid })).toEqual({ fullName: "Contato antigo", firstName: "Contato", canEdit: true });
  expect(service.client.chatModify).not.toHaveBeenCalled();
});
it("preserves all native contact fields and verifies the echoed name after app-state sync", async () => {
  const service = bridge();
  expect(await service.igrowContact({ peer: lid, fullName: "Novo ❤️", firstName: "Novo", expectedFullName: "Contato antigo" })).toEqual({ fullName: "Novo ❤️", firstName: "Novo", canEdit: true });
  expect(service.client.chatModify).toHaveBeenCalledWith({ contact: { fullName: "Novo ❤️", firstName: "Novo", pnJid: peer, lidJid: lid, saveOnPrimaryAddressbook: true, username: "preservar" } }, peer);
  expect(service.client.resyncAppState).toHaveBeenCalledTimes(2);
});
it("refuses unsaved identities and stale names before mutation; recovers its queue", async () => {
  const service = bridge();
  await expect(service.igrowContact({ peer: "999999999@lid", fullName: "Novo", firstName: "Novo", expectedFullName: "Contato antigo" })).rejects.toThrow("NOT_SAVED");
  await expect(service.igrowContact({ peer, fullName: "Novo", firstName: "Novo", expectedFullName: "Desatualizado" })).rejects.toThrow("CHANGED");
  expect(service.client.chatModify).not.toHaveBeenCalled();
  expect(await service.igrowContact({ peer })).toMatchObject({ fullName: "Contato antigo" });
});
it("does not claim success without native confirmation and rejects disconnected sessions", async () => {
  const service = bridge(); service.client.chatModify.mockResolvedValue(undefined);
  await expect(service.igrowContact({ peer, fullName: "Novo", firstName: "Novo", expectedFullName: "Contato antigo" })).rejects.toThrow("NOT_CONFIRMED");
  service.stateConnection.state = "close";
  await expect(service.igrowContact({ peer })).rejects.toThrow("disconnected");
});
