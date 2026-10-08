import { describe, expect, it } from "vitest";
import type { InboxConversation, InboxList } from "@/modules/whatsapp/inbox-types";
import { latestInboxCursor, reconcileInboxList } from "@/modules/whatsapp/inbox-merge";
import { parseEvolutionPersonalHistory } from "@/modules/whatsapp/inbox-parse";

const old: InboxConversation = {
  id:"old", channelKey:"qr", remoteId:"5586999000000", isGroup:false, title:"Pessoa",
  clientId:null, clientName:null, favorite:false, unread:0,
  lastAt:"2026-10-07T10:00:00Z", preview:"Anterior", lastDirection:"in",
  lastKind:"text", lastStatus:null, lastInboundAt:"2026-10-07T10:00:00Z",
  archived:false, updatedAt:"2026-10-07T10:00:01Z",
};

describe("WhatsApp delta polling", () => {
  it("retains other 499 chats while applying a single new unread message", () => {
    const existing: InboxList = { ready:true, conversations:[old] };
    const changed = { ...old, unread:1, preview:"Nova mensagem", updatedAt:"2026-10-07T10:05:00Z" };
    const newChat = { ...old, id:"new", lastAt:"2026-10-07T10:06:00Z", updatedAt:"2026-10-07T10:06:01Z" };
    const merged = reconcileInboxList(existing, {ready:true, delta:true, conversations:[changed,newChat]});
    expect(merged.conversations).toHaveLength(2);
    expect(merged.conversations[0].id).toBe("new");
    expect(merged.conversations[1].unread).toBe(1);
    expect(latestInboxCursor(old.updatedAt!, [changed,newChat])).toBe(newChat.updatedAt);
  });

  it("clears stale entries on full reconciliation but not on empty delta", () => {
    const existing: InboxList = {ready:true, conversations:[old]};
    expect(reconcileInboxList(existing, {ready:true,delta:true,conversations:[]})).toEqual(existing);
    expect(reconcileInboxList(existing, {ready:true,conversations:[]})).toEqual({ready:true,conversations:[]});
  });
});

describe("private conversation history", () => {
  it("imports only one-to-one messages, including sent messages, ignoring group history", () => {
    const data = [
      {key:{remoteJid:"5586999000000@s.whatsapp.net", id:"personal-1", fromMe:false}, message:{conversation:"Oi"}, messageTimestamp:1791420000},
      {key:{remoteJid:"120363150097840207@g.us", id:"group-1"}, message:{conversation:"Grupo"}, messageTimestamp:1791420001},
      {key:{remoteJid:"5586999000000@s.whatsapp.net", id:"personal-2", fromMe:true}, message:{conversation:"Resposta"}, messageTimestamp:1791420002},
    ];
    const result = parseEvolutionPersonalHistory({event:"MESSAGES_SET",data});
    expect(result.map(row=>row.externalId)).toEqual(["personal-1","personal-2"]);
    expect(result.map(row=>row.direction)).toEqual(["in","out"]);
    expect(result.every(row=>!row.isGroup)).toBe(true);
    expect(parseEvolutionPersonalHistory({event:"MESSAGES_UPSERT",data})).toEqual([]);
  });
});
