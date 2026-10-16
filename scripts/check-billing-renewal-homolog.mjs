/**
 * TESTE (não faz parte do produto): LEITURA do estado de uma organização de teste de ciclo de vida (i, j, k, m...) no iGrow (via a sessão do
 * próprio proprietário fictício) e no Asaas Sandbox (somente GET). Não cria cobrança, não confirma, não vence, não cancela e não imprime segredos.
 * Uso: node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/check-billing-renewal-homolog.mjs <letra>
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { homologConfig } from "./lib-homolog.mjs";

const letter = (process.argv[2] ?? "").toLowerCase();
if (!/^[a-z]$/.test(letter)) throw new Error("Use a letra da organização: i, j, k, m...");
const K = `TESTE22${letter.toUpperCase()}`;
const file = `.env.homolog-teste22${letter}`;
const env = Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim()]));
const { url, key } = homologConfig();
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const login = await client.auth.signInWithPassword({ email: env[`${K}_OWNER_EMAIL`], password: env[`${K}_OWNER_PASSWORD`] });
if (login.error) throw new Error("Login do proprietário fictício falhou.");
const agency = env[`${K}_ORG_ID`];
const billing = (await client.rpc("get_agency_billing", { p_agency_id: agency })).data ?? {};
const sub = billing.subscription ?? null;
console.log("== iGrow ==");
console.log(JSON.stringify({ organizacao: env[`${K}_ORG_NAME`], papel: billing.role, plano: billing.current_plan?.name ?? null, assinatura: sub && { id_asaas: sub.asaas_subscription_id, status: sub.status, ciclo: sub.cycle, valor_centavos: sub.amount_cents, periodo_ate: sub.current_period_end, proximo_vencimento: sub.next_due_date, tolerancia_ate: sub.grace_ends_at, em_atraso_desde: sub.overdue_due_date, cancelamento: sub.cancel_at_period_end }, pagamentos: (billing.payments ?? []).map((p) => `${p.asaas_payment_id} ${p.status} ${p.amount_cents / 100} venc ${p.due_date}`) }, null, 1));
if (!sub?.asaas_subscription_id || !process.env.ASAAS_API_KEY) process.exit(0);
const headers = { access_token: process.env.ASAAS_API_KEY };
const base = "https://api-sandbox.asaas.com/v3";
const remote = await (await fetch(`${base}/subscriptions/${sub.asaas_subscription_id}`, { headers })).json();
const list = await (await fetch(`${base}/payments?subscription=${sub.asaas_subscription_id}&limit=50`, { headers })).json();
console.log("== Asaas (somente leitura) ==");
console.log(`assinatura ${remote.status} ${remote.cycle} ${remote.value} próximo vencimento ${remote.nextDueDate} excluída:${remote.deleted}`);
for (const p of list.data ?? []) console.log(`${p.id} ${p.status} ${p.value} venc ${p.dueDate} ${p.billingType} confirmada:${p.confirmedDate ?? "-"} excluída:${p.deleted}`);
console.log(`total de cobranças: ${list.totalCount}`);
