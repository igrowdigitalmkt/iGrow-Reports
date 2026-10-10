import { expect, it } from "vitest";
import { commonGroupPreview, commonGroupMembersText } from "@/modules/whatsapp/common-groups";
import type { InboxConversation } from "@/modules/whatsapp/inbox-types";
const contact = (remoteId: string, title: string, channelKey = "qr") => ({ remoteId, title, channelKey, isGroup: false }) as InboxConversation;
it("identifies the connected account from native aliases and never turns LIDs into phone numbers", () => {
  const preview = commonGroupPreview([
    { id: "123456789@lid", phoneNumber: "5586888888888@s.whatsapp.net" },
    { id: "5586999999999:2@s.whatsapp.net" },
    { id: "987654321@lid" },
  ], "5586888888888:12@s.whatsapp.net");
  expect(preview.map(member => member.label)).toEqual(["+55 86 99999-9999", "Participante", "Você"]);
  expect(preview[1].remoteId).toBe("987654321@lid"); expect(preview[2].remoteId).toBeNull();
});
it("uses exact identities of existing QR contacts, preserving names and emoji", () => {
  const group = { id: "1@g.us", subject: "Equipe", memberCount: 2,
    memberPreview: commonGroupPreview([{ id: "5586999999999@s.whatsapp.net" }, { id: "5586888888888@s.whatsapp.net" }], "5586888888888@s.whatsapp.net") };
  expect(commonGroupMembersText(group, [contact("5586999999999", "Silvio ❤️")])).toBe("Silvio ❤️, Você");
  expect(commonGroupMembersText(group, [contact("5586999999999", "Outro canal", "official")])).toBe("+55 86 99999-9999, Você");
  expect(commonGroupMembersText(group, [contact("5586999999998", "Mesmo nome")])).toBe("+55 86 99999-9999, Você");
});
it("bounds the preview and reports the remaining members without exposing their identifiers", () => {
  const people = Array.from({ length: 30 }, (_, index) => ({ id: `${5586999990000 + index}@s.whatsapp.net` }));
  const group = { id: "1@g.us", subject: "Equipe", memberCount: 30, memberPreview: commonGroupPreview(people) };
  expect(group.memberPreview).toHaveLength(3);
  expect(commonGroupMembersText(group, [])).toContain("e mais 27");
  expect(commonGroupMembersText({ id: "1@g.us", subject: "Equipe", memberCount: 2 }, [])).toBe("2 participantes");
  expect(commonGroupMembersText({ id: "1@g.us", subject: "Equipe" }, [])).toBe("");
});
it("resolves a cached LID title only from an explicit native phone/LID association", () => {
  const people = [{ id: "987654321@lid", phoneNumber: "5586999999999@s.whatsapp.net" }];
  const group = { id: "1@g.us", subject: "Equipe", memberPreview: commonGroupPreview(people) };
  expect(commonGroupMembersText(group, [contact("987654321@lid", "Silvio")])).toBe("Silvio");
  expect(commonGroupMembersText(group, [contact("123456789@lid", "Nome parecido")])).toBe("+55 86 99999-9999");
});
