import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { qrPeerLinks } from "@/modules/whatsapp-qr/peer-identity";

describe("WhatsApp QR contact identity", () => {
  it("links real LID and phone evidence from a Baileys message", () => {
    const lid = "12717565952043@lid";
    const phone = "559180748371@s.whatsapp.net";
    expect(qrPeerLinks({ data: { key: { remoteJid: lid, remoteJidAlt: phone } } })).toEqual([{ lid, phone }]);
    expect(qrPeerLinks({ data: { key: { remoteJid: phone, lidJid: lid } } })).toEqual([{ lid, phone }]);
  });
  it("links chat state batches but does not guess from titles or matching photos", () => {
    const lid = "12717565952043@lid";
    const phone = "559180748371@s.whatsapp.net";
    expect(qrPeerLinks({ data: [{remoteJid:lid,remoteJidAlt:phone},{remoteJid:lid,name:"Same name"},{remoteJid: "1203630000@g.us",remoteJidAlt:phone}] })).toEqual([{lid,phone}]);
    expect(qrPeerLinks({data:[{remoteJid:lid,name:"Silvio Melo",avatar:"same"},{remoteJid:phone,name:"Silvio Melo",avatar:"same"}]})).toEqual([]);
  });
  it("rejects group, unvalidated JIDs, malformed numeric strings", () => {
    expect(qrPeerLinks({ data:[
      {remoteJid:"12036312@g.us",remoteJidAlt:"559180748371@s.whatsapp.net"},
      {remoteJid:"1234@lid",remoteJidAlt:"559180748371@s.whatsapp.net"},
      {remoteJid:"12717565952043@lid",remoteJidAlt:"not-phone@s.whatsapp.net"},
    ]})).toEqual([]);
  });
});
