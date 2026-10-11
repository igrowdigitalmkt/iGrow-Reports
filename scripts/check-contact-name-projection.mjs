// Read-only integration check. Contact names, phone numbers and credentials stay in memory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
const env = parseEnv(readFileSync(".env.production.local", "utf8"));
const agency = "4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const db = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(db && secret, "Verification environment unavailable");
// SSH output is captured inside this process, never written to the terminal or fixtures.
const bootstrap = readFileSync("scripts/check-contact-edit-provider.py", "utf8").replace(/\r\n/g,"\n").split("try:\n    phone = api(")[0];
const input = bootstrap + '\ncontact = api("/label/igrowContact/" + instance, {"peer": person["phoneNumber"]})\nprint(json.dumps({"remoteId": person["phoneNumber"].split("@")[0], "fullName": contact["fullName"]}))\n';
let contact;
try {
  contact = JSON.parse(execFileSync("ssh", ["-i",join(homedir(),".ssh","igrow_vps"),"-o","BatchMode=yes","root@179.236.250.51","python3 -"], {input,encoding:"utf8",timeout:75_000,stdio:["pipe","pipe","pipe"]}));
} catch { throw new Error("Native contact read unavailable"); }
const query = new URL(`${db}/rest/v1/whatsapp_conversations`);
query.searchParams.set("select","title"); query.searchParams.set("agency_id",`eq.${agency}`);
query.searchParams.set("channel","eq.qr"); query.searchParams.set("is_group","eq.false");
query.searchParams.set("remote_id",`eq.${contact.remoteId}`);
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
