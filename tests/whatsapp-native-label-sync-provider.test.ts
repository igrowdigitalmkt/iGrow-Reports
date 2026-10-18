import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("infra/evolution/native-label-sync.mjs", "utf8");
const methods = source.split("const methods=String.raw`")[1].split("`;\n")[0];
type Label = { id: string; name: string; color: number; deleted?: boolean; igrowLabelAction?: Record<string, unknown> };
type Projection = { labels: Map<string, Label>; chats: Map<string, Set<string>> };
type Snapshot = { labels: Label[]; syncVersions: { regular: number }; chats: Array<{ remoteJid: string; labels: string[]; remoteJidAlt: string | null }> };
interface Bridge {
  stateConnection: { state: string };
  igrowLabelsReady: boolean;
  igrowLabelSyncProjection: Projection | undefined;
  eventProcessingQueue: Promise<void>;
  client: { authState: { keys: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } }; resyncAppState: ReturnType<typeof vi.fn> };
  mappedPhoneJid: ReturnType<typeof vi.fn>;
  igrowCaptureNativeLabel(label: Label): void;
  igrowCaptureNativeLabelAssociation(event: { type: string; association: { type: string; chatId: string; labelId: string } }): void;
  igrowLabelSnapshot(): Promise<Snapshot>;
}
const Provider = new Function("f", `return class {${methods}}`)(Error) as new () => Bridge;
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
  replay = async () => { label(); member(); regular = { version: 7 }; };
  bridge.client = {
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
