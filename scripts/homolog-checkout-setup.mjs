/**
 * TESTE (não faz parte do produto): cria, só no Supabase de HOMOLOGAÇÃO, usuários e organizações FICTÍCIOS para testar a contratação:
 * organização "TESTE-2.2B" com proprietário, administrador e editor, e uma segunda organização com outro proprietário (isolamento).
 * As senhas são geradas aqui e gravadas em .env.homolog-teste22b (ignorado pelo Git); nada secreto é impresso. Pode rodar de novo:
 * reaproveita o que já existe e só reaplica as senhas se o arquivo não existir.
 * Uso: node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/homolog-checkout-setup.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { adminClient } from "./lib-homolog.mjs";

const FILE = ".env.homolog-teste22b";
const db = adminClient();
const stored = fs.existsSync(FILE) ? Object.fromEntries(fs.readFileSync(FILE, "utf8").split("\n").filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => [line.split("=")[0], line.slice(line.indexOf("=") + 1)])) : {};
const password = () => crypto.randomBytes(18).toString("base64url");
const people = [
  ["OWNER", "teste22b-dono@example.test", "owner"], ["ADMIN", "teste22b-admin@example.test", "admin"],
  ["EDITOR", "teste22b-editor@example.test", "editor"], ["OTHER", "teste22b-outro@example.test", null],
];

const ids = {};
const out = { ...stored };
for (const [key, email] of people) {
  const secret = stored[`TESTE22B_${key}_PASSWORD`] ?? password();
  const listed = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = listed.data?.users.find((item) => item.email === email);
  if (!user) {
    const created = await db.auth.admin.createUser({ email, password: secret, email_confirm: true });
    if (created.error) throw new Error(`Não foi possível criar o usuário de teste ${key}: ${created.error.message}`);
    user = created.data.user;
  } else if (!stored[`TESTE22B_${key}_PASSWORD`]) {
    const updated = await db.auth.admin.updateUserById(user.id, { password: secret, email_confirm: true });
    if (updated.error) throw new Error(`Não foi possível definir a senha de ${key}.`);
  }
  ids[key] = user.id;
  out[`TESTE22B_${key}_EMAIL`] = email;
  out[`TESTE22B_${key}_PASSWORD`] = secret;
  out[`TESTE22B_${key}_ID`] = user.id;
}

async function org(name, members) {
  const found = await db.from("agencies").select("id").eq("name", name).maybeSingle();
  let id = found.data?.id;
  if (!id) {
    const created = await db.from("agencies").insert({ name }).select("id").single();
    if (created.error) throw new Error(`Organização de teste: ${created.error.message}`);
    id = created.data.id;
  }
  for (const [userId, role] of members) {
    const linked = await db.from("agency_users").upsert({ agency_id: id, user_id: userId, role }, { onConflict: "agency_id,user_id" });
    if (linked.error) throw new Error(`Vínculo de teste: ${linked.error.message}`);
  }
  return id;
}
out.TESTE22B_ORG_ID = await org("TESTE-2.2B Org Checkout", [[ids.OWNER, "owner"], [ids.ADMIN, "admin"], [ids.EDITOR, "editor"]]);
out.TESTE22B_OTHER_ORG_ID = await org("TESTE-2.2B Org Outra", [[ids.OTHER, "owner"]]);

fs.writeFileSync(FILE, `# Usuários e organizações FICTÍCIOS de teste (homologação). Arquivo local, ignorado pelo Git. Não compartilhe.\n${Object.entries(out).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
console.log(`Usuários fictícios prontos (${people.length}) e 2 organizações de teste. Credenciais gravadas em ${FILE} (não impressas).`);
