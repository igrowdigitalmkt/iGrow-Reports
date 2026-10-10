import { describe, expect, it } from "vitest";
import { voiceDurationFromRef } from "../src/modules/whatsapp/voice-metadata";

describe("voiceDurationFromRef", () => {
  it("accepts duration on a Baileys audio reference", () =>
    expect(voiceDurationFromRef({ type: "audioMessage", data: { seconds: 17, mediaKey: "secret" } })).toBe(17));
  it("supports protobuf integer payload", () =>
    expect(voiceDurationFromRef({ type: "audioMessage", data: { seconds: { low: 5, high: 0 } } })).toBe(5));
  it("does not leak unrelated metadata via the read model", () =>
    expect(voiceDurationFromRef({ type: "imageMessage", data: { seconds: 9 } })).toBeNull());
  it("rejects invalid and implausible durations", () => {
    for (const ref of [null, {}, { type: "audioMessage", data: { seconds: 0 } }, { type: "audioMessage", data: { seconds: "x" } }, { type: "audioMessage", data: { seconds: 99000 } }]) {
      expect(voiceDurationFromRef(ref)).toBeNull();
    }
  });
});
