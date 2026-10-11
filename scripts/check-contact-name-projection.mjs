// Read-only integration check. Contact names, phone numbers and credentials stay in memory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const env = parseEnv(readFileSync(".env.production.local", "utf8"));
const agency = "4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const instance = `igrow-${agency}`;
const base = env.EVOLUTION_API_URL?.replace(/\/+$/, "");
const key = env.EVOLUTION_API_KEY;
const db = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(base && key && db && secret, "Verification environment unavailable");
async function native(path, body) {
  const response = await fetch(base + path, { headers: { apikey:key, "Content-Type":"application/json" },
    ...(body ? {method:"POST",body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(55_000) });
  assert.ok(response.ok,"Native read failed"); return response.json();
}
const account = (await native(`/instance/fetchInstances?instanceName=${instance}`)).find(item=>item.name===instance);
const owner = account.ownerJid.replace(/:\d+(?=@)/,"");
const groups = await native(`/group/fetchAllGroups/${instance}?getParticipants=true`);
const person = groups.flatMap(group=>group.participants??[]).find(person=>person.phoneNumber && person.phoneNumber!==owner);
assert.ok(person,"Native group contact unavailable");
const contact = await native(`/label/igrowContact/${instance}`, {peer:person.phoneNumber});
const query = new URL(`${db}/rest/v1/whatsapp_conversations`);
query.searchParams.set("select","title"); query.searchParams.set("agency_id",`eq.${agency}`);
query.searchParams.set("channel","eq.qr"); query.searchParams.set("is_group","eq.false");
query.searchParams.set("remote_id",`eq.${person.phoneNumber.replace("@s.whatsapp.net","")}`);
let confirmed = false;
for (let attempt = 0; attempt < 10; attempt++) {
  const response = await fetch(query,{headers:{apikey:secret,Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(15_000)});
  assert.ok(response.ok,"Scoped projection read failed");
  const rows=await response.json();
  if(rows.some(row=>row.title===contact.fullName)){confirmed=true;break;}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(confirmed,"Native saved name has not reached its scoped QR conversation");
console.log(JSON.stringify({native_name_matches_igrow:true,scoped_qr_contact:true,contact_mutations:0}));
