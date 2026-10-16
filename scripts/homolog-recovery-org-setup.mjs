/**
 * TESTE (não faz parte do produto): prepara, só no Supabase de HOMOLOGAÇÃO, uma organização e um proprietário FICTÍCIOS para o teste de
 * recuperação sem webhook. Não cria checkout, intenção, cliente financeiro nem pagamento.
 * A senha (8 letras + 4 números fáceis de digitar) é gerada aqui e gravada em .env.homolog-teste22<letra> (ignorado pelo Git); nada secreto é
 * impresso. Pode rodar de novo: reaproveita o que existe.
 * Uso: node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/homolog-recovery-org-setup.mjs <letra: d, e, f...>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { adminClient, homologConfig } from "./lib-homolog.mjs";

const SUFFIX = (process.argv[2] ?? "d").toLowerCase();
if (!/^[a-z]$/.test(SUFFIX)) throw new Error("Use uma letra: d, e, f...");
const K = `TESTE22${SUFFIX.toUpperCase()}`;
const FILE = `.env.homolog-teste22${SUFFIX}`;
const EMAIL = `teste22${SUFFIX}-dono@example.test`;
const ORG_NAME = `TESTE-2.2${SUFFIX.toUpperCase()} Org Recuperação sem webhook`;
const db = adminClient();
const stored = fs.existsSync(FILE) ? Object.fromEntries(fs.readFileSync(FILE, "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)])) : {};
const easy = () => {
  const letters = "abcdefghjkmnpqrstuvwxyz", digits = "23456789";
  const pick = (set) => set[crypto.randomInt(set.length)];
  return Array.from({ length: 8 }, () => pick(letters)).join("") + Array.from({ length: 4 }, () => pick(digits)).join("");
};
const password = stored[`${K}_OWNER_PASSWORD`] ?? easy();

const listed = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
let user = listed.data?.users.find((item) => item.email === EMAIL);
if (!user) {
  const created = await db.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (created.error) throw new Error(`Usuário de teste: ${created.error.message}`);
  user = created.data.user;
} else if (!stored[`${K}_OWNER_PASSWORD`]) {
  const updated = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (updated.error) throw new Error("Não foi possível definir a senha do usuário de teste.");
}
const found = await db.from("agencies").select("id").eq("name", ORG_NAME).maybeSingle();
let agencyId = found.data?.id;
if (!agencyId) {
  const created = await db.from("agencies").insert({ name: ORG_NAME }).select("id").single();
  if (created.error) throw new Error(`Organização de teste: ${created.error.message}`);
  agencyId = created.data.id;
}
const linked = await db.from("agency_users").upsert({ agency_id: agencyId, user_id: user.id, role: "owner" }, { onConflict: "agency_id,user_id" });
if (linked.error) throw new Error(`Vínculo de teste: ${linked.error.message}`);
fs.writeFileSync(FILE, `# Usuário e organização FICTÍCIOS do teste de recuperação sem webhook (homologação). Local, ignorado pelo Git. Não compartilhe.\n${K}_OWNER_EMAIL=${EMAIL}\n${K}_OWNER_PASSWORD=${password}\n${K}_OWNER_ID=${user.id}\n${K}_ORG_ID=${agencyId}\n${K}_ORG_NAME=${ORG_NAME}\n`);

// Verificação com a sessão do próprio proprietário fictício (o banco confere papel e organização).
const { url, key } = homologConfig();
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await client.auth.signInWithPassword({ email: EMAIL, password });
if (login.error) throw new Error("Login do proprietário fictício falhou.");
const billing = await client.rpc("get_agency_billing", { p_agency_id: agencyId });
const offers = await client.rpc("billing_list_offers", { p_agency_id: agencyId });
const memberships = await db.from("agency_users").select("agency_id").eq("user_id", user.id);
const b = billing.data ?? {};
console.log(JSON.stringify({
  organizacao: ORG_NAME, email: EMAIL, login_via_api: "ok", papel: b.role, pode_contratar: b.can_contract, assinatura: b.subscription ?? null, intencao_pendente: b.pending_checkout ?? null,
  ultima_intencao: b.last_intent ?? null, em_recuperacao: b.recovery ?? null, plano_atual: b.current_plan ?? null,
  ofertas: (offers.data ?? []).map((o) => `${o.name} v${o.version}: mensal ${o.price_monthly_cents / 100} / anual ${o.price_yearly_cents / 100}`),
  organizacoes_do_usuario: memberships.data?.length, credenciais: `gravadas em ${FILE} (não impressas)`,
}, null, 1));
