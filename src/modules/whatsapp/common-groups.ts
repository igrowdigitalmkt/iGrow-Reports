import { formatWhatsAppPhone } from "./inbox-format";
import type { InboxConversation } from "./inbox-types";

export type CommonGroup = {
  id: string; subject: string; memberCount?: number;
  memberPreview?: Array<{ remoteId: string | null; linkedId?: string; label: string; isSelf: boolean }>;
};

const identity = (jid: string) => jid.replace(/:\d+(?=@)/g, "").replace(/@s\.whatsapp\.net$/, "");

/** A bounded preview from native group metadata; never invent phone numbers from LIDs. */
export function commonGroupPreview(participants: Array<{ id?: string; phoneNumber?: string; lid?: string }>, selfJid?: string | null) {
  const self = selfJid ? identity(selfJid) : null;
  const members = participants.map(person => {
    const aliases = [person.phoneNumber, person.id, person.lid].filter((value): value is string => typeof value === "string");
    const isSelf = self !== null && aliases.some(value => identity(value) === self);
    const phone = aliases.map(identity).find(value => /^[0-9]{8,15}$/.test(value));
    const lid = aliases.map(identity).find(value => /^[0-9]{8,20}@lid$/.test(value));
    return { remoteId: isSelf ? null : phone ?? lid ?? null,
      ...(!isSelf && phone && lid ? { linkedId: lid } : {}),
      label: isSelf ? "Você" : phone ? formatWhatsAppPhone(phone) : "Participante", isSelf };
  });
  // Place the connected account last, as in reference 09.
  return members.filter(member => !member.isSelf).concat(members.filter(member => member.isSelf)).slice(0, 3);
}

export function commonGroupMembersText(group: CommonGroup, conversations: InboxConversation[]) {
  const preview = group.memberPreview ?? [];
  const names = preview.map(member => {
    if (member.isSelf) return "Você";
    const contact = member.remoteId ? conversations.find(item => item.channelKey === "qr" && !item.isGroup
      && [member.remoteId, member.linkedId].some(alias => alias && identity(item.remoteId) === identity(alias))) : null;
    return contact?.title?.trim() || member.label;
  });
  const more = Math.max(0, (group.memberCount ?? preview.length) - preview.length);
  if (!names.length) return group.memberCount ? `${group.memberCount} participantes` : "";
  return `${names.join(", ")}${more ? ` e mais ${more}` : ""}`;
}
