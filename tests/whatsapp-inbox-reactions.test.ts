import { describe, expect, it } from "vitest";
import { groupReactions, parseCloudReactions, parseEvolutionReaction } from "@/modules/whatsapp/inbox-reactions";
import { describeBaileysContent, parseEvolutionMessage, parseEvolutionRecentHistory, parseCloudMessages } from "@/modules/whatsapp/inbox-parse";

const privateReaction = (emoji: string, fromMe = false) => ({
  event: "MESSAGES_UPSERT",
  data: {
    key: { id: "REACTION_EVENT_1", remoteJid: "5586999999999@s.whatsapp.net", fromMe },
    messageTimestamp: 1791450000,
    message: { reactionMessage: { key: { id: "TARGET_123", remoteJid: "5586999999999@s.whatsapp.net", fromMe: true }, text: emoji } },
  },
});

describe("WhatsApp reactions", () => {
  it("pins a received emoji to the original external message instead of a new bubble", () => {
    const reaction = parseEvolutionReaction(privateReaction("❤️"));
    expect(reaction).toMatchObject({
      remoteId: "5586999999999", targetExternalId: "TARGET_123", reactorId: "contact", emoji: "❤️",
    });
    expect(parseEvolutionMessage(privateReaction("❤️"))).toBeNull();
    expect(describeBaileysContent(privateReaction("❤️").data.message)).toBeNull();
  });

  it("distinguishes own and group senders, including private LID aliases", () => {
    expect(parseEvolutionReaction(privateReaction("👍", true))?.reactorId).toBe("me");
    const group = {
      event: "MESSAGES_UPSERT",
      data: {
        key: { id: "REACTION_EVENT_GROUP", remoteJid: "120363987654321@g.us", fromMe: false, participant: "127879342345678@lid", participantAlt: "5586999911111@s.whatsapp.net" },
        message: { reactionMessage: { key: { id: "GRP_TARGET", remoteJid: "120363987654321@g.us", fromMe: false }, text: "😂" } },
      },
    };
    expect(parseEvolutionReaction(group)).toMatchObject({
      remoteId: "120363987654321@g.us", targetExternalId: "GRP_TARGET", reactorId: "5586999911111@s.whatsapp.net",
    });
    const lid = privateReaction("🔥");
    lid.data.key.remoteJid = "123456789876543@lid";
    Object.assign(lid.data.key, { remoteJidAlt: "5586988887777@s.whatsapp.net" });
    expect(parseEvolutionReaction(lid)?.remoteId).toBe("5586988887777");
  });

  it("retains verified group participant JIDs for reacting to the original sender", () => {
    const payload = {
      event: "MESSAGES_UPSERT",
      data: {
        key: { id: "ORIGINAL_GROUP_MESSAGE", remoteJid: "120363987654321@g.us",
          participant: "1299898887776@lid", participantAlt: "5586999911111@s.whatsapp.net", fromMe: false },
        message: { conversation: "Uma mensagem recebida no grupo" },
      },
    };
    expect(parseEvolutionMessage(payload)).toMatchObject({
      isGroup: true, remoteId: "120363987654321@g.us",
      externalId: "ORIGINAL_GROUP_MESSAGE", participantJid: "5586999911111@s.whatsapp.net",
    });
  });

  it("treats removal as an empty update, not an unread chat message", () => {
    const result = parseEvolutionReaction(privateReaction(""));
    expect(result?.emoji).toBe("");
    expect(parseEvolutionMessage(privateReaction(""))).toBeNull();
    const absentEmoji = privateReaction("");
    delete (absentEmoji.data.message.reactionMessage as {text?: string}).text;
    expect(parseEvolutionReaction(absentEmoji)?.emoji).toBe("");
    expect(parseEvolutionReaction({ event: "MESSAGES_UPSERT", data: {
      key: { id: "r", remoteJid: "120363987654321@g.us", fromMe: false },
      message: { reactionMessage: { key: { id: "other" }, text: "👍" } },
    } })).toBeNull();
  });

  it("does not import historical reactions as separate messages", () => {
    const item = { ...privateReaction("❤️").data, messageTimestamp: 1791450000 };
    expect(parseEvolutionRecentHistory({ event: "MESSAGES_SET", data: [item] })).toEqual([]);
  });

  it("parses official Cloud API reactions and removals independently of messages", () => {
    const payload = { entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "12345678901" }, messages: [
        { id: "R1", type: "reaction", from: "558698887777", timestamp: "1791450000", reaction: { message_id: "wamid.original", emoji: "🥰" } },
        { id: "R2", type: "reaction", from: "558698887777", timestamp: "1791451000", reaction: { message_id: "wamid.original", emoji: "" } },
      ],
    } }] }] };
    const reactions = parseCloudReactions(payload);
    expect(reactions).toHaveLength(2);
    expect(reactions[0]).toMatchObject({ phoneNumberId: "12345678901", targetExternalId: "wamid.original", reactorId: "contact", emoji: "🥰" });
    expect(reactions[1]?.emoji).toBe("");
    expect(parseCloudMessages(payload)).toHaveLength(0);
  });

  it("counts separate senders without making an extra chat row", () => {
    expect(groupReactions([
      { emoji: "❤️", reactorId: "contact-a" }, { emoji: "❤️", reactorId: "me" },
      { emoji: "👍", reactorId: "contact-b" },
    ])).toEqual([
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "👍", count: 1, mine: false },
    ]);
  });
});
