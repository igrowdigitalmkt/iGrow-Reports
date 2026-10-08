import type { InboxMessage } from "./inbox-parse";

export type InboxReactionEvent = {
  remoteId: string;
  targetExternalId: string;
  reactorId: string;
  emoji: string;
  at: string;
};
export type InboxReaction = { emoji: string; reactorId: string };
export type ReactionSummary = { emoji: string; count: number; mine: boolean };

/** Group individual reactions by emoji, without losing the identity of each sender. */
export function groupReactions(reactions: InboxReaction[]): ReactionSummary[] {
  const map = new Map<string, ReactionSummary>();
  for (const reaction of reactions) {
    if (!reaction.emoji) continue;
    const current = map.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    current.count++;
    if (reaction.reactorId === "me") current.mine = true;
    map.set(reaction.emoji, current);
  }
  return [...map.values()];
}
const MAX_EMOJI_LENGTH = 32;
const jidDigits = (jid: string) => jid.endsWith("@s.whatsapp.net")
  ? jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") || null : null;
const iso = (value: unknown, fallback: Date) => {
  const stamp = typeof value === "object" && value !== null && "low" in value
    ? Number((value as { low: unknown }).low) : Number(value);
  return Number.isFinite(stamp) && stamp > 0
    ? new Date(stamp * 1000).toISOString() : fallback.toISOString();
};

type ReactionKey = { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; participant?: string; participantAlt?: string; id?: string; fromMe?: boolean };
type Content = { reactionMessage?: { key?: ReactionKey; text?: string }; ephemeralMessage?: { message?: Content }; viewOnceMessage?: { message?: Content }; viewOnceMessageV2?: { message?: Content } };
function reactionContent(message?: Content): Content["reactionMessage"] | undefined {
  if (!message) return undefined;
  if (message.reactionMessage) return message.reactionMessage;
  return reactionContent(message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message);
}

/** Baileys MESSAGES_UPSERT/SEND_MESSAGE reaction: the nested key is the original message. */
export function parseEvolutionReaction(body: unknown, now = new Date()): InboxReactionEvent | null {
  const value = body as { event?: unknown; data?: { key?: ReactionKey; message?: Content; messageTimestamp?: unknown } } | null;
  if (!["messages.upsert", "MESSAGES_UPSERT", "send.message", "SEND_MESSAGE"].includes(String(value?.event))) return null;
  const outer = value?.data?.key;
  const reaction = reactionContent(value?.data?.message);
  const target = reaction?.key?.id;
  const emoji = reaction ? reaction.text ?? "" : undefined;
  if (!outer?.id || typeof target !== "string" || !target || target.length > 200
    || typeof emoji !== "string" || emoji.length > MAX_EMOJI_LENGTH) return null;
  const outerJid = outer.remoteJid;
  if (!outerJid || (!outerJid.endsWith("@s.whatsapp.net") && !outerJid.endsWith("@lid") && !outerJid.endsWith("@g.us"))) return null;
  const isGroup = outerJid.endsWith("@g.us");
  const phone = isGroup ? null : [outerJid, outer.remoteJidAlt, outer.senderPn]
    .filter((v): v is string => !!v).map(jidDigits).find(Boolean);
  const remoteId = isGroup ? outerJid : phone ?? outerJid;
  const fromMe = outer.fromMe === true || value?.event === "send.message" || value?.event === "SEND_MESSAGE";
  const groupActor = outer.participantAlt ?? outer.participant;
  const reactorId = fromMe ? "me" : isGroup ? groupActor : "contact";
  if (!reactorId || reactorId.length > 120) return null;
  return { remoteId, targetExternalId: target, reactorId, emoji, at: iso(value?.data?.messageTimestamp, now) };
}

export type CloudReactionEvent = InboxReactionEvent & { phoneNumberId: string };
type CloudReaction = { id?: string; from?: string; to?: string; timestamp?: unknown; type?: string; reaction?: { message_id?: string; emoji?: string } };
/** Meta Cloud API reactions and coexistence echoes; no synthetic chat messages. */
export function parseCloudReactions(body: unknown, now = new Date()): CloudReactionEvent[] {
  const result: CloudReactionEvent[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { metadata?: { phone_number_id?: string }; messages?: CloudReaction[]; message_echoes?: CloudReaction[] } })?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (typeof phoneNumberId !== "string" || !/^\d{5,30}$/.test(phoneNumberId)) continue;
      for (const [collection, actor] of [[value?.messages ?? [], "contact"], [value?.message_echoes ?? [], "me"]] as const) {
        for (const message of collection) {
          const target = message.reaction?.message_id;
          const emoji = message.reaction ? message.reaction.emoji ?? "" : undefined;
          const peer = (actor === "contact" ? message.from : message.to)?.replace(/\D/g, "");
          if (message.type !== "reaction" || !target || target.length > 200 || typeof emoji !== "string"
            || emoji.length > MAX_EMOJI_LENGTH || !peer || peer.length < 8 || peer.length > 15) continue;
          result.push({ phoneNumberId, remoteId: peer, targetExternalId: target, reactorId: actor, emoji, at: iso(message.timestamp, now) });
        }
      }
    }
  }
  return result;
}

/** A reaction never increments unread counts or changes last message previews. */
export function isReactionMessage(message: Pick<InboxMessage, "kind">) {
  return message.kind === "reaction";
}
