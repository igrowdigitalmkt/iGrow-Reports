import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
vi.mock("server-only", () => ({}));
import { parseQrContactNames, syncQrContactNames } from "@/modules/whatsapp-qr/contact-names";
it("accepts only native saved names from contact events, with valid identities and bounded text", () => {
  const rows = [
    { remoteJid: "5586999999999@s.whatsapp.net", igrowSavedName: " Amor ❤️ " },
    { remoteJid: "123456789@lid", igrowSavedName: "Nome salvo" },
    { remoteJid: "5586999999998@s.whatsapp.net", pushName: "Nome de perfil" },
    { remoteJid: "123456789@g.us", igrowSavedName: "Grupo" },
    { remoteJid: "5586999999997@s.whatsapp.net", igrowSavedName: "" },
    { remoteJid: "5586999999996@s.whatsapp.net", igrowSavedName: "x".repeat(201) },
  ];
  expect(parseQrContactNames({ event: "CONTACTS_UPSERT", data: rows })).toEqual([{ remoteId: rows[0].remoteJid, name: "Amor ❤️" }, { remoteId: rows[1].remoteJid, name: "Nome salvo" }]);
  expect(parseQrContactNames({ event: "messages.upsert", data: rows })).toEqual([]);
});
it("updates only existing QR contacts in the authenticated agency and exact session alias", async () => {
  const calls: Array<{ url: URL; method: string; body?: unknown }> = [];
  const client = createClient<Database>("https://db.example.test", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.pathname.endsWith("whatsapp_qr_peer_links") ? [{ lid: "123456789@lid", phone: "5586999999999" }] : []), { headers: { "Content-Type": "application/json" } });
  } } });
  await syncQrContactNames(client, "agency", "2026-10-10T00:00:00Z", { event: "contacts.upsert", data: [{ remoteJid: "123456789@lid", igrowSavedName: "Atualizado ❤️" }] });
  expect(calls[0].url.searchParams.get("session_epoch")).toBe("eq.2026-10-10T00:00:00Z");
  expect(calls[1].method).toBe("PATCH");
  expect(calls[1].url.searchParams.get("agency_id")).toBe("eq.agency");
  expect(calls[1].url.searchParams.get("channel")).toBe("eq.qr");
  expect(calls[1].url.searchParams.get("is_group")).toBe("eq.false");
  expect(calls[1].url.searchParams.get("remote_id")).toBe("eq.5586999999999");
  expect(calls[1].body).toMatchObject({ title: "Atualizado ❤️" });
});
