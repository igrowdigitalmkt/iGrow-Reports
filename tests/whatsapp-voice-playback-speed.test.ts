import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "igrow.whatsapp.voice-speed.v1";

type StorageListener = (event: { key: string | null; newValue: string | null }) => void;

let storage: Map<string, string>;
let onStorage: StorageListener | undefined;
let broadcasts: unknown[];

beforeEach(() => {
  storage = new Map();
  broadcasts = [];
  onStorage = undefined;
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
    addEventListener: (event: string, handler: StorageListener) => {
      if (event === "storage") onStorage = handler;
    },
  });
  vi.stubGlobal("BroadcastChannel", class {
    onmessage?: (event: { data: unknown }) => void;
    constructor(readonly name: string) {}
    postMessage(message: unknown) { broadcasts.push(message); }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WhatsApp voice speed preference", () => {
  it("uses one speed across subscribers and cycles only when explicitly updated", async () => {
    const store = await import("../src/modules/whatsapp/voice-playback-speed");
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const offA = store.subscribeVoicePlaybackSpeed(listenerA);
    const offB = store.subscribeVoicePlaybackSpeed(listenerB);
    expect(store.getVoicePlaybackSpeed()).toBe(1);

    store.setVoicePlaybackSpeed(1.5);
    expect(store.getVoicePlaybackSpeed()).toBe(1.5);
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    store.setVoicePlaybackSpeed(1.5);
    expect(listenerA).toHaveBeenCalledTimes(1);
    store.setVoicePlaybackSpeed(2);
    expect(store.getVoicePlaybackSpeed()).toBe(2);
    expect(storage.get(KEY)).toBe("2");
    expect(broadcasts).toEqual([
      { type: "speed", value: 1.5 },
      { type: "speed", value: 2 },
    ]);
    offA();
    offB();
  });

  it("loads a saved speed after a new page/module starts and keeps SSR stable", async () => {
    storage.set(KEY, "1.5");
    let store = await import("../src/modules/whatsapp/voice-playback-speed");
    expect(store.getServerVoicePlaybackSpeed()).toBe(1);
    expect(store.getVoicePlaybackSpeed()).toBe(1.5);

    store.setVoicePlaybackSpeed(2);
    vi.resetModules(); // A new page reloads its module state from localStorage.
    store = await import("../src/modules/whatsapp/voice-playback-speed");
    expect(store.getVoicePlaybackSpeed()).toBe(2);
  });

  it("synchronizes changes made in another tab via the storage event", async () => {
    const store = await import("../src/modules/whatsapp/voice-playback-speed");
    const notify = vi.fn();
    store.subscribeVoicePlaybackSpeed(notify);
    expect(onStorage).toBeTypeOf("function");
    onStorage?.({ key: KEY, newValue: "2" });
    expect(store.getVoicePlaybackSpeed()).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    onStorage?.({ key: "other-preference", newValue: "1" });
    expect(store.getVoicePlaybackSpeed()).toBe(2);
    onStorage?.({ key: KEY, newValue: null });
    expect(store.getVoicePlaybackSpeed()).toBe(1);
  });

  it("ignores corrupted saved values and unsupported playback rates", async () => {
    storage.set(KEY, "3.75");
    const store = await import("../src/modules/whatsapp/voice-playback-speed");
    expect(store.getVoicePlaybackSpeed()).toBe(1);
    store.setVoicePlaybackSpeed(1.5);
    store.setVoicePlaybackSpeed(99 as 1);
    expect(store.getVoicePlaybackSpeed()).toBe(1.5);
    expect(storage.get(KEY)).toBe("1.5");
  });
});
