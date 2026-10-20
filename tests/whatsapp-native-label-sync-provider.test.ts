import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("infra/evolution/native-label-sync.mjs", "utf8");
// Aceita LF e CRLF (checkout do Windows com autocrlf): dividir só por "\n" capturava o arquivo inteiro e acusava palavras do instalador.
const methods = source.split("const methods=String.raw`")[1].split(/`;\r?\n/)[0];
type Label = { id: string; name: string; color: number; deleted?: boolean; igrowLabelAction?: Record<string, unknown> };
type Projection = { labels: Map<string, Label>; chats: Map<string, Set<string>> };
type Snapshot = { labels: Label[]; syncVersions: { regular: number }; chats: Array<{ remoteJid: string; labels: string[]; remoteJidAlt: string | null }> };
interface Bridge {
  stateConnection: { state: string };
  igrowLabelsReady: boolean;
  igrowLabelSyncProjection: Projection | undefined;
  eventProcessingQueue: Promise<void>;
  client: { authState: { keys: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } }; resyncAppState: ReturnType<typeof vi.fn>;
    user: { id: string }; addChatLabel: ReturnType<typeof vi.fn>; removeChatLabel: ReturnType<typeof vi.fn>; addLabel: ReturnType<typeof vi.fn> };
  igrowNativeLists: Map<string, Label>;
  igrowLabelQueue: Promise<unknown>;
  prismaRepository: { label: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> }; chat: { findMany: ReturnType<typeof vi.fn> } };
  addLabel: ReturnType<typeof vi.fn>;
  removeLabel: ReturnType<typeof vi.fn>;
  handleLabel(input: { number: string; labelId: string; action: string }): Promise<unknown>;
  igrowEditLabel(input: { id?: string; name?: string; color?: number; deleted?: boolean }): Promise<{ id: string }>;
  mappedPhoneJid: ReturnType<typeof vi.fn>;
  igrowCaptureNativeLabel(label: Label): void;
  igrowCaptureNativeLabelAssociation(event: { type: string; association: { type: string; chatId: string; labelId: string } }): void;
  igrowLabelSnapshot(): Promise<Snapshot>;
}
// Exercise the installer and the actual write methods extracted from the pinned
// base image, rather than a mock that emits events the live provider disables.
function patchedProvider() {
  const root = mkdtempSync(join(tmpdir(), "groow-provider-test-"));
  try {
    const fixture = JSON.parse(readFileSync("tests/fixtures/evolution-label-provider.json", "utf8")) as { methods: string };
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/main.js"), `class Provider {${fixture.methods}\nhandlers={"labels.edit":async e=>{},"labels.association":async(e,t)=>{}};}`);
    execFileSync(process.execPath, [resolve("infra/evolution/native-label-sync.mjs")], { cwd: root });
    const patched = readFileSync(join(root, "dist/main.js"), "utf8");
    return new Function("f", "F", `${patched};return Provider`)(Error, Error) as new () => Bridge;
  } finally {
    // mkdtemp owns this exact directory; never remove a caller-supplied path.
    rmSync(root, { recursive: true, force: true });
  }
}
const Provider = patchedProvider();
let bridge: Bridge;
let regular: { version: number } | null;
let replay: () => Promise<void>;

const label = (id = "4", name = "Cliente") => bridge.igrowCaptureNativeLabel({ id, name, color: 1,
  igrowLabelAction: { name, color: 1, type: 5, isActive: true, orderIndex: 2 } });
const member = (labelId = "4", type = "add", chatId = "123456789012@lid", associationType = "label_jid") =>
  bridge.igrowCaptureNativeLabelAssociation({ type, association: { type: associationType, chatId, labelId } });

beforeEach(() => {
  regular = { version: 7 };
  bridge = new Provider();
  bridge.stateConnection = { state: "open" };
  bridge.igrowLabelsReady = false;
  bridge.eventProcessingQueue = Promise.resolve();
  bridge.mappedPhoneJid = vi.fn().mockResolvedValue(null);
  bridge.igrowNativeLists = new Map();
  bridge.igrowLabelQueue = Promise.resolve();
  bridge.addLabel = vi.fn().mockResolvedValue(undefined);
  bridge.removeLabel = vi.fn().mockResolvedValue(undefined);
  bridge.prismaRepository = { label: { upsert: vi.fn(), deleteMany: vi.fn() }, chat: { findMany: vi.fn().mockResolvedValue([]) } };
  replay = async () => { label(); member(); regular = { version: 7 }; };
  bridge.client = {
    user: { id: "999@s.whatsapp.net" },
    // Baileys emitOwnEvents:false: ack advances the version, emits no events.
    addChatLabel: vi.fn(async () => { regular = { version: regular!.version + 1 }; }),
    removeChatLabel: vi.fn(async () => { regular = { version: regular!.version + 1 }; }),
    addLabel: vi.fn(async () => { regular = { version: regular!.version + 1 }; }),
    authState: { keys: {
      get: vi.fn(async (_type, names: string[]) => {
        // Exactly the live failure: regular exists, regular_low does not.
        expect(names).toEqual(["regular"]);
        return { regular };
      }),
      set: vi.fn(async (data) => {
        expect(data).toEqual({ "app-state-sync-version": { regular: null } });
        regular = null;
      }),
    } },
    resyncAppState: vi.fn(async (names: string[]) => { expect(names).toEqual(["regular"]); await replay(); }),
  };
});
afterEach(() => vi.restoreAllMocks());

describe("sincronização nativa de etiquetas", () => {
  const change = (action: string, number = "123456789012@lid") => bridge.handleLabel({ number, labelId: "4", action });
  const current = () => bridge.igrowLabelSnapshot();
  async function initialized() {
    await current();
    replay = async () => {};
  }

  it("mantém remoções e inclusões confirmadas sem eventos locais do SDK", async () => {
    await initialized();
    await change("remove");
    expect((await current()).chats).toEqual([]);
    await change("add");
    expect((await current()).chats[0].labels).toEqual(["4"]);
    expect((await current()).chats[0].labels).toEqual(["4"]);
    expect(bridge.client.addChatLabel).toHaveBeenCalledTimes(1);
    expect(bridge.client.removeChatLabel).toHaveBeenCalledTimes(1);
  });

  it("ordena cliques rápidos de remover/incluir e incluir/remover", async () => {
    await initialized();
    await Promise.all([change("remove"), change("add")]);
    expect((await current()).chats[0].labels).toEqual(["4"]);
    await Promise.all([change("add"), change("remove")]);
    expect((await current()).chats).toEqual([]);
  });

  it("não aplica escrita rejeitada e continua processando a fila", async () => {
    await initialized();
    bridge.client.removeChatLabel.mockRejectedValueOnce(Error("Rejected by WhatsApp"));
    await expect(change("remove")).rejects.toThrow("Unable to remove");
    expect((await current()).chats[0].labels).toEqual(["4"]);
    await change("remove");
    expect((await current()).chats).toEqual([]);
    bridge.client.addChatLabel.mockRejectedValueOnce(Error("Rejected by WhatsApp"));
    await expect(change("add")).rejects.toThrow("Unable to add");
    expect((await current()).chats).toEqual([]);
  });

  it("mantém o resultado confirmado no WhatsApp mesmo se o espelho Prisma falhar", async () => {
    await initialized();
    bridge.removeLabel.mockRejectedValueOnce(Error("Database unavailable"));
    await expect(change("remove")).rejects.toThrow();
    expect((await current()).chats).toEqual([]);
  });

  it("não reaproveita snapshot anterior à escrita nem libera leitura durante o ack", async () => {
    await initialized();
    let releaseRead!: () => void;
    let releaseWrite!: () => void;
    bridge.mappedPhoneJid.mockImplementationOnce(() => new Promise(resolve => { releaseRead = () => resolve(null); }));
    const oldRead = current();
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
    bridge.client.removeChatLabel.mockImplementationOnce(() => new Promise<void>(resolve => { releaseWrite = resolve; }));
    const write = change("remove");
    const afterWrite = current();
    let readCompleted = false;
    void afterWrite.then(() => { readCompleted = true; });
    releaseRead();
    expect((await oldRead).chats[0].labels).toEqual(["4"]);
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"));
    expect(readCompleted).toBe(false);
    expect(bridge.igrowLabelSyncProjection!.chats.get("123456789012@lid")).toEqual(new Set(["4"]));
    releaseWrite();
    await write;
    expect((await afterWrite).chats).toEqual([]);
  });

  it("cria, renomeia e exclui metadados após confirmação, sem depender de labels.edit", async () => {
    await initialized();
    const created = await bridge.igrowEditLabel({ name: "Nova", color: 2 });
    expect((await current()).labels).toContainEqual(expect.objectContaining({ id: created.id, name: "Nova" }));
    await bridge.igrowEditLabel({ id: created.id, name: "Renomeada", color: 3 });
    expect((await current()).labels).toContainEqual(expect.objectContaining({ id: created.id, name: "Renomeada", color: 3 }));
    await bridge.igrowEditLabel({ id: "4", name: "Cliente", color: 1, deleted: true });
    expect((await current()).labels.map(label => label.id)).not.toContain("4");
    expect((await current()).chats).toEqual([]);
  });

  it("não publica metadados quando o SDK rejeita a edição", async () => {
    await initialized();
    bridge.client.addLabel.mockRejectedValueOnce(Error("Rejected"));
    await expect(bridge.igrowEditLabel({ id: "4", name: "Inválida", color: 2 })).rejects.toThrow("Rejected");
    expect((await current()).labels[0].name).toBe("Cliente");
    await bridge.igrowEditLabel({ id: "4", name: "Confirmada", color: 2 });
    expect((await current()).labels[0].name).toBe("Confirmada");
  });

  it("não espelha o ack de uma sessão substituída enquanto a escrita estava em andamento", async () => {
    await initialized();
    bridge.client.removeChatLabel.mockImplementationOnce(async () => { bridge.client = { ...bridge.client }; });
    await expect(change("remove")).rejects.toThrow();
    replay = async () => { label("6", "Outra sessão"); regular = { version: 2 }; };
    expect((await current()).labels.map(label => label.id)).toEqual(["6"]);
    expect((await current()).chats).toEqual([]);
  });

  it("continua recebendo alterações externas depois de uma escrita local confirmada", async () => {
    await initialized();
    await change("remove");
    replay = async () => { member(); regular = { version: regular!.version + 1 }; };
    expect((await current()).chats[0].labels).toEqual(["4"]);
    replay = async () => { member("4", "remove"); regular = { version: regular!.version + 1 }; };
    expect((await current()).chats).toEqual([]);
    expect(bridge.client.authState.keys.set).toHaveBeenCalledTimes(1);
  });

  it("mantém eventos recebidos do celular em consultas posteriores sem novos eventos", async () => {
    await initialized();
    // Push events arrive outside the HTTP snapshot request. An incremental
    // resync at the same version must preserve them rather than replaying them.
    member("4", "remove");
    for (let index = 0; index < 3; index++) expect((await current()).chats).toEqual([]);
    member("4", "add");
    for (let index = 0; index < 3; index++) expect((await current()).chats[0].labels).toEqual(["4"]);
    label("4", "Alterada no celular");
    for (let index = 0; index < 3; index++) expect((await current()).labels[0].name).toBe("Alterada no celular");
  });

  it("reconstrói o estado confirmado após reabrir o serviço sem depender da memória anterior", async () => {
    const remoteMembers = new Set(["4"]);
    let remoteVersion = 7;
    bridge.client.resyncAppState.mockImplementation(async (_collections: string[], rebuild: boolean) => {
      if (rebuild) { label(); for (const id of remoteMembers) member(id); }
      regular = { version: remoteVersion };
    });
    bridge.client.removeChatLabel.mockImplementation(async () => { remoteMembers.delete("4"); regular = { version: ++remoteVersion }; });
    bridge.client.addChatLabel.mockImplementation(async () => { remoteMembers.add("4"); regular = { version: ++remoteVersion }; });
    const reopen = () => {
      const previous = bridge;
      bridge = new Provider();
      Object.assign(bridge, {
        client: previous.client, stateConnection: { state: "open" }, eventProcessingQueue: Promise.resolve(),
        mappedPhoneJid: previous.mappedPhoneJid, igrowNativeLists: new Map(), igrowLabelQueue: Promise.resolve(),
        addLabel: previous.addLabel, removeLabel: previous.removeLabel, prismaRepository: previous.prismaRepository,
      });
      expect(bridge.igrowLabelSyncProjection).toBeUndefined();
    };
    await current();
    await change("remove");
    reopen();
    expect((await current()).chats).toEqual([]);
    await change("add");
    reopen();
    expect((await current()).chats[0].labels).toEqual(["4"]);
    // A phone change made while the bridge was closed is in the authoritative
    // remote state and must also survive a fresh projection and later reads.
    remoteMembers.delete("4"); remoteVersion++;
    reopen();
    expect((await current()).chats).toEqual([]);
    expect((await current()).chats).toEqual([]);
  });

  it("reflete remoção dos dois aliases comprovados sem manter um vínculo antigo", async () => {
    await initialized();
    await change("add", "5511999999999@s.whatsapp.net");
    expect((await current()).chats).toHaveLength(2);
    await change("remove");
    await change("remove", "5511999999999@s.whatsapp.net");
    expect((await current()).chats).toEqual([]);
  });

  it("aceita regular válido quando regular_low não existe, preservando metadados e vínculos", async () => {
    const result = await bridge.igrowLabelSnapshot();
    expect(result.labels).toEqual([expect.objectContaining({ id: "4", name: "Cliente", type: 5, isActive: true, orderIndex: 2 })]);
    expect(result.chats).toEqual([{ remoteJid: "123456789012@lid", labels: ["4"], remoteJidAlt: null }]);
    expect(result.syncVersions).toEqual({ regular: 7 });
    expect(bridge.client.resyncAppState).toHaveBeenCalledWith(["regular"], true);
    expect(bridge.igrowLabelsReady).toBe(true);
  });

  it("não apaga tabelas, vínculos nem estados de outras coleções para obter o snapshot", async () => {
    // There is deliberately no Prisma repository: reads must not delete data.
    await bridge.igrowLabelSnapshot();
    expect(bridge.client.authState.keys.set).toHaveBeenCalledTimes(1);
    expect(methods).not.toMatch(/deleteMany|updateMany|regular_low|critical_unblock_low|fetchMessageHistory/);
  });

  it("aceita coleção vazia somente com versão confirmada pelo provedor", async () => {
    replay = async () => { regular = { version: 0 }; };
    expect(await bridge.igrowLabelSnapshot()).toEqual({ labels: [], chats: [], syncVersions: { regular: 0 } });
  });

  it("recusa sincronização sem estado confirmado em vez de retornar sucesso vazio", async () => {
    replay = async () => { regular = null; };
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("IGROW_LABEL_STATE_UNAVAILABLE");
    expect(bridge.igrowLabelSyncProjection).toBeUndefined();
    expect(bridge.igrowLabelsReady).toBe(false);
  });

  it("não substitui o snapshot anterior por eventos parciais de uma sincronização que falhou", async () => {
    await bridge.igrowLabelSnapshot();
    const previous = bridge.igrowLabelSyncProjection;
    replay = async () => { label("9", "Parcial"); member("9"); regular = null; };
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("IGROW_LABEL_STATE_UNAVAILABLE");
    expect(bridge.igrowLabelSyncProjection).toBe(previous);
    expect([...previous!.labels.keys()]).toEqual(["4"]);
    expect([...previous!.chats.values()][0]).toEqual(new Set(["4"]));
  });

  it("limita novas tentativas após falha e recupera sem desconectar ou trocar a sessão", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    replay = async () => { throw Error("Synchronization unavailable"); };
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("IGROW_LABEL_STATE_UNAVAILABLE");
    clock.mockReturnValue(115_000);
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("IGROW_LABEL_STATE_UNAVAILABLE");
    expect(bridge.client.resyncAppState).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(131_000);
    replay = async () => { label("8", "Recuperada"); regular = { version: 8 }; };
    expect((await bridge.igrowLabelSnapshot()).labels[0].name).toBe("Recuperada");
    expect(bridge.client.resyncAppState).toHaveBeenCalledTimes(2);
    expect(bridge.stateConnection.state).toBe("open");
  });

  it("compartilha uma sincronização entre consultas concorrentes", async () => {
    const snapshots = await Promise.all([bridge.igrowLabelSnapshot(), bridge.igrowLabelSnapshot(), bridge.igrowLabelSnapshot()]);
    expect(bridge.client.resyncAppState).toHaveBeenCalledTimes(1);
    expect(snapshots[0]).toEqual(snapshots[2]);
  });

  it("usa sincronização incremental nas leituras seguintes sem zerar a versão", async () => {
    await bridge.igrowLabelSnapshot();
    replay = async () => { label("4", "Renomeada"); regular = { version: 8 }; };
    const result = await bridge.igrowLabelSnapshot();
    expect(result.labels[0].name).toBe("Renomeada");
    expect(bridge.client.authState.keys.set).toHaveBeenCalledTimes(1);
    expect(bridge.client.resyncAppState).toHaveBeenLastCalledWith(["regular"], false);
  });

  it("reconstrói sem conservar etiquetas e vínculos que não existem no novo snapshot", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    await bridge.igrowLabelSnapshot();
    regular = null;
    replay = async () => { throw Error("Unavailable"); };
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow();
    clock.mockReturnValue(131_000);
    replay = async () => { label("5", "Atual"); member("5"); regular = { version: 9 }; };
    const result = await bridge.igrowLabelSnapshot();
    expect(result.labels.map(item => item.id)).toEqual(["5"]);
    expect(result.chats[0].labels).toEqual(["5"]);
  });

  it("reflete remoções nativas de vínculo e etiqueta, sem incluir associações de mensagem", async () => {
    await bridge.igrowLabelSnapshot();
    replay = async () => { member("4", "remove"); member("4", "add", "outro@lid", "label_message"); };
    expect((await bridge.igrowLabelSnapshot()).chats).toEqual([]);
    replay = async () => { bridge.igrowCaptureNativeLabel({ id: "4", name: "Cliente", color: 1, deleted: true }); };
    expect((await bridge.igrowLabelSnapshot()).labels).toEqual([]);
  });

  it("não consulta nem modifica estado de uma sessão desconectada", async () => {
    bridge.stateConnection.state = "close";
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("WhatsApp disconnected");
    expect(bridge.client.authState.keys.get).not.toHaveBeenCalled();
    expect(bridge.client.resyncAppState).not.toHaveBeenCalled();
  });

  it("reconstrói a projeção quando o cliente da sessão muda, sem reutilizar as etiquetas anteriores", async () => {
    await bridge.igrowLabelSnapshot();
    bridge.client = { ...bridge.client };
    replay = async () => { label("6", "Nova sessão"); regular = { version: 2 }; };
    const result = await bridge.igrowLabelSnapshot();
    expect(result.labels.map(item => item.id)).toEqual(["6"]);
    expect(result.chats).toEqual([]);
    expect(bridge.client.resyncAppState).toHaveBeenLastCalledWith(["regular"], true);
  });

  it("não publica um snapshot obtido de um cliente substituído durante a sincronização", async () => {
    replay = async () => { label(); regular = { version: 7 }; bridge.client = { ...bridge.client }; };
    await expect(bridge.igrowLabelSnapshot()).rejects.toThrow("IGROW_LABEL_STATE_UNAVAILABLE");
    expect(bridge.igrowLabelsReady).toBe(false);
    expect(bridge.igrowLabelSyncProjection).toBeUndefined();
  });
});
