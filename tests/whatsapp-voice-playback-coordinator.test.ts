import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimVoicePlayback,
  getActiveVoiceToken,
  releaseVoicePlayback,
  stopVoicePlayback,
  subscribeVoicePlayback,
} from "../src/modules/whatsapp/voice-playback-coordinator";

afterEach(() => stopVoicePlayback());

describe("exclusive WhatsApp voice playback", () => {
  it("pauses the previous audio when the next audio is activated", () => {
    const a = Symbol("message A");
    const b = Symbol("message B");
    const pauseA = vi.fn();
    const pauseB = vi.fn();
    claimVoicePlayback(a, pauseA);
    expect(getActiveVoiceToken()).toBe(a);
    claimVoicePlayback(b, pauseB);
    expect(pauseA).toHaveBeenCalledTimes(1);
    expect(pauseB).not.toHaveBeenCalled();
    expect(getActiveVoiceToken()).toBe(b);
  });

  it("switches ownership across conversations without retaining multiple active avatars", () => {
    const firstConversation = Symbol("conversation one");
    const secondConversation = Symbol("conversation two");
    const pause = vi.fn();
    claimVoicePlayback(firstConversation, pause);
    claimVoicePlayback(secondConversation, vi.fn());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(getActiveVoiceToken()).toBe(secondConversation);
    // An older component unmounting must not clear the new active player.
    releaseVoicePlayback(firstConversation);
    expect(getActiveVoiceToken()).toBe(secondConversation);
    releaseVoicePlayback(secondConversation);
    expect(getActiveVoiceToken()).toBeNull();
  });

  it("does not interrupt itself when the same paused note is resumed", () => {
    const player = Symbol("one voice");
    const pause = vi.fn();
    claimVoicePlayback(player, pause);
    claimVoicePlayback(player, pause);
    expect(pause).not.toHaveBeenCalled();
    expect(getActiveVoiceToken()).toBe(player);
  });

  it("notifies subscribers on claim and release", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoicePlayback(listener);
    const player = Symbol("voice");
    claimVoicePlayback(player, vi.fn());
    releaseVoicePlayback(player);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    claimVoicePlayback(Symbol("another"), vi.fn());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops the playing element when platform playback is stopped", () => {
    const player = Symbol("playing");
    const pause = vi.fn();
    claimVoicePlayback(player, pause);
    stopVoicePlayback();
    expect(pause).toHaveBeenCalledOnce();
    expect(getActiveVoiceToken()).toBeNull();
  });
});
