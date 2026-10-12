// Input is a DOM export of visible WhatsApp Web messages, never private browser stores.
// Exact message ID + agency + QR channel; fill missing fields only. No deletion or merge.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const env = parseEnv(readFileSync(".env.production.local", "utf8"));
const agency = "4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Prefer: "return=representation" };
async function db(table, filters, patch) {
  const url = new URL(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers, method: patch ? "PATCH" : "GET", ...(patch ? { body: JSON.stringify(patch) } : {}) });
  if (!response.ok) throw Error(`Scoped repair refused: ${response.status}`);
  return response.status === 204 ? [] : response.json();
}
const [guard] = await db("whatsapp_qr_reset_guards", { select: "blocked,fresh_after", agency_id: `eq.${agency}` });
if (!guard || guard.blocked) throw Error("Current pairing unavailable");
const exported = JSON.parse(readFileSync(process.argv[2], "utf8"));
const native = new Map();
for (const row of exported) {
  if (typeof row.externalId !== "string" || !/^[a-zA-Z0-9_:-]{1,200}$/.test(row.externalId) || typeof row.body !== "string" || !row.body.trim() || row.body.length > 8000) continue;
  const name = row.contactName ?? /^\[[^\]]+\] (.+): $/.exec(row.pre ?? "")?.[1];
  const clock = /^\[(\d{1,2}:\d{2}),/.exec(row.pre ?? "")?.[1];
  const originalBody = row.body;
  const withoutClock = clock && originalBody.trimEnd().endsWith("\n"+clock) ? originalBody.trimEnd().slice(0,-clock.length-1).trimEnd() : originalBody;
  const body = withoutClock.replace(/\n{3,}/g,"\n\n");
  if (native.has(row.externalId) && native.get(row.externalId).body !== body) throw Error("Conflicting native message exports");
  const buttons = Array.isArray(row.buttons) ? row.buttons.slice(0,8).filter(button => typeof button?.label === "string" && button.label.trim() && button.label.length<=120).map(button=>({label:button.label})) : [];
  native.set(row.externalId, { body, originalBody, withoutClock, buttons, name: typeof name === "string" && name.trim() && name.length <= 200 && !/[\x00-\x1f]/.test(name) ? name : null });
}
const conversations = await db("whatsapp_conversations", { select: "id,title,last_message_at", agency_id: `eq.${agency}`, channel_key: "eq.qr" });
const chats = new Map(conversations.map(chat => [chat.id, chat]));
const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
const messages = await db("whatsapp_messages", { select: "id,conversation_id,external_id,body,sent_at,kind", agency_id: `eq.${agency}`, sent_at: `gte.${cutoff}`, revoked_at: "is.null" });
const counts = { matched: 0, recovered: 0, names: 0 };
for (const message of messages) {
  const content = native.get(message.external_id), chat = chats.get(message.conversation_id);
  if (!content || !chat) continue;
  if (messages.filter(row => row.external_id === message.external_id).length !== 1) throw Error("Ambiguous native identity");
  counts.matched++;
  if (process.argv.includes("--dry-run")) continue;
  const [current] = await db("whatsapp_qr_reset_guards", { select: "blocked,fresh_after", agency_id: `eq.${agency}` });
  if (current?.blocked || current?.fresh_after !== guard.fresh_after) throw Error("Pairing changed during repair");
  if (message.body === null || (message.kind === "template" && [content.originalBody,content.withoutClock].includes(message.body) && content.body !== message.body)) {
    const repaired = await db("whatsapp_messages", { agency_id: `eq.${agency}`, id: `eq.${message.id}`, conversation_id: `eq.${chat.id}`, external_id: `eq.${message.external_id}`, body: message.body === null ? "is.null" : "eq."+message.body, revoked_at: "is.null" }, { body: content.body });
    if (repaired.length) {
      counts.recovered++;
      await db("whatsapp_conversations", { agency_id: `eq.${agency}`, channel_key: "eq.qr", id: `eq.${chat.id}`, last_message_at: `eq.${message.sent_at}` }, { last_message_preview: content.body.slice(0, 300), updated_at: new Date().toISOString() });
    }
  }
  if (message.kind === "template" && content.buttons.length) await db("whatsapp_messages", { agency_id:`eq.${agency}`,conversation_id:`eq.${chat.id}`,id:`eq.${message.id}`,media_ref:"is.null",revoked_at:"is.null" }, {media_ref:{type:"templateMessage",data:{buttons:content.buttons}}});
  if (!chat.title && content.name) {
    const updated = await db("whatsapp_conversations", { agency_id: `eq.${agency}`, channel_key: "eq.qr", id: `eq.${chat.id}`, title: "is.null" }, { title: content.name, updated_at: new Date().toISOString() });
    if (updated.length) { counts.names++; chat.title = content.name; }
  }
}
console.log(JSON.stringify(counts));
