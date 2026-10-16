/**
 * TESTE (não é parte do produto): recuperação financeira (migration 0004) com CONCORRÊNCIA REAL, por conexões HTTP independentes,
 * contra o Supabase de HOMOLOGAÇÃO. Só organizações/clientes/assinaturas FICTÍCIOS "TESTE-2.2C"; nenhuma chamada ao Asaas; não imprime segredos.
 * Cada execução cria organizações NOVAS (registros financeiros são imutáveis por desenho, então não são apagados) e NUNCA toca na assinatura real
 * já confirmada. A expiração é simulada por SQL (relógio da intenção) entre as duas fases.
 * Uso:
 *   node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/check-billing-recovery-homolog.mjs prepare   (cria e escreve o estado)
 *   (simular a expiração das intenções fictícias listadas no estado)
 *   node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/check-billing-recovery-homolog.mjs run
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminClient, check, finish } from "./lib-homolog.mjs";

const db = adminClient();
const OWNER = "22000000-0000-4000-8000-000000000001";
const PLAN_VERSION = "22cccccc-0000-4000-8000-000000000001"; // 49,90/mês, 499,00/ano
const STATE = path.join(os.tmpdir(), "igrow-recovery-state.json");
const rpc = (name, args) => db.rpc(name, args);
const mode = process.argv[2];

const snapshot = (id, customer, value, cycle, session, extra = {}) => ({ id, customer, value, cycle, status: "ACTIVE", billingType: "CREDIT_CARD", checkoutSession: session, externalReference: null, ...extra });
const payment = (id, sub, customer, value) => ({ id, subscription: sub, customer, value, dueDate: "2026-10-15", status: "CONFIRMED", billingType: "CREDIT_CARD", confirmedDate: "2026-10-15", observedAt: new Date().toISOString() });
const tally = (settled) => settled.reduce((acc, item) => { const key = item.error ? `erro:${item.error.code}` : String(item.data); acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});

async function newOrg(label, stamp) {
  const { data, error } = await db.from("agencies").insert({ name: `TESTE-2.2C ${label} ${stamp}` }).select("id").single();
  if (error) throw new Error(`Organização de teste: ${error.message}`);
  const linked = await db.from("agency_users").insert({ agency_id: data.id, user_id: OWNER, role: "owner" });
  if (linked.error) throw new Error(`Vínculo de teste: ${linked.error.message}`);
  return data.id;
}
async function sentIntent(agency, customer, checkout, key, cycle = "monthly") {
  const set = await rpc("billing_set_customer", { p_agency_id: agency, p_environment: "sandbox", p_asaas_customer_id: customer });
  if (set.error) throw new Error(`Cliente: ${set.error.message}`);
  const created = await rpc("billing_create_intent", { p_agency_id: agency, p_user_id: OWNER, p_plan_version_id: PLAN_VERSION, p_cycle: cycle, p_request_key: key, p_environment: "sandbox" });
  if (created.error) throw new Error(`Intenção: ${created.error.message}`);
  const id = created.data.intent_id;
  await rpc("billing_mark_intent", { p_intent_id: id, p_status: "dispatching" });
  if (checkout) await rpc("billing_mark_intent", { p_intent_id: id, p_status: "awaiting_payment", p_checkout_id: checkout, p_checkout_url: `https://sandbox.example.test/${checkout}` });
  else await rpc("billing_mark_intent", { p_intent_id: id, p_status: "unknown", p_error: "timeout simulado" });
  return id;
}

if (mode === "prepare") {
  const stamp = Date.now().toString(36);
  const s = { stamp, orgs: {}, intents: {}, customers: {}, checkouts: {} };
  const add = async (name, { checkout = true, cycle = "monthly" } = {}) => {
    const agency = await newOrg(name, stamp);
    const customer = `cus_RC_${name}_${stamp}`.slice(0, 60);
    const chk = checkout ? `chk_RC_${name}_${stamp}`.slice(0, 70) : null;
    const intent = await sentIntent(agency, customer, chk, `rc-${name}-${stamp}`, cycle);
    s.orgs[name] = agency; s.customers[name] = customer; s.checkouts[name] = chk; s.intents[name] = intent;
  };
  for (const name of ["r1", "r3", "r6", "r7x", "r7y", "r9"]) await add(name, { checkout: name !== "r9" });
  await add("r8", { cycle: "yearly" });
  s.r2 = await newOrg("r2", stamp); // sem intenção: disputa de contratações
  fs.writeFileSync(STATE, JSON.stringify(s));
  console.log(`Estado gravado em ${STATE}. Intenções fictícias a expirar (SQL): ${Object.values(s.intents).join(", ")}`);
  process.exit(0);
}

if (mode !== "run") throw new Error("Use: prepare | run");
const s = JSON.parse(fs.readFileSync(STATE, "utf8"));

console.log("== 15: reivindicação simultânea de trabalho (8 execuções em paralelo) ==");
const claims = await Promise.all(Array.from({ length: 8 }, () => rpc("billing_reconcile_work", { p_limit: 20, p_environment: "sandbox" })));
const claimedIds = claims.flatMap((item) => (item.data?.intents ?? []).map((entry) => entry.id));
check("nenhuma execução falhou", claims.every((item) => !item.error));
check("nenhuma intenção foi reivindicada por duas execuções ao mesmo tempo", new Set(claimedIds).size === claimedIds.length, `${claimedIds.length} reivindicações`);
for (const name of ["r1", "r3", "r6", "r7x", "r7y", "r8"]) check(`a intenção expirada ${name} foi reivindicada exatamente uma vez`, claimedIds.filter((id) => id === s.intents[name]).length === 1);
const again = await rpc("billing_reconcile_work", { p_limit: 20, p_environment: "sandbox" });
check("nova execução imediata não repete as reivindicadas", !(again.data?.intents ?? []).some((entry) => Object.values(s.intents).includes(entry.id)));

console.log("\n== 1/2/5: pagamento com webhook atrasado, intenção expirada: 10 aplicações simultâneas da mesma assinatura ==");
const sub1 = snapshot(`sub_RC_r1_${s.stamp}`, s.customers.r1, 49.9, "MONTHLY", s.checkouts.r1);
const race1 = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: sub1, p_event_id: null })));
const t1 = tally(race1);
check("exatamente UMA assinatura criada e as demais idempotentes", t1.created === 1 && (t1.noop ?? 0) === 9, JSON.stringify(t1));
console.log("== 14: reprocessamento depois da falha: aplicar de novo não muda nada ==");
check("reaplicar a mesma assinatura é 'noop'", (await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: sub1, p_event_id: null })).data === "noop");
console.log("== pagamento confirmado: 10 aplicações simultâneas (webhook e cron) ==");
const pay1 = payment(`pay_RC_r1_${s.stamp}`, sub1.id, s.customers.r1, 49.9);
const payRace = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: pay1, p_event_id: null, p_signal: null })));
const tp = tally(payRace);
check("a cobrança ativa UMA vez; as outras são duplicidade segura", tp.activated === 1 && (tp.noop_duplicate ?? 0) + (tp.stale_snapshot ?? 0) === 9, JSON.stringify(tp));

console.log("\n== 6: duas tentativas de contratação em paralelo (organização sem intenção) ==");
const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => rpc("billing_create_intent", { p_agency_id: s.r2, p_user_id: OWNER, p_plan_version_id: PLAN_VERSION, p_cycle: "monthly", p_request_key: `rc-r2-${s.stamp}-${index}`, p_environment: "sandbox" })));
const fresh = attempts.filter((item) => !item.error && item.data.reused === false);
check("só UMA intenção nova; as demais reaproveitam a mesma", fresh.length === 1 && new Set(attempts.filter((item) => !item.error).map((item) => item.data.intent_id)).size === 1, `${fresh.length} novas`);

console.log("\n== 7: duas assinaturas diferentes para a mesma organização, ao mesmo tempo ==");
const subA = snapshot(`sub_RC_r3a_${s.stamp}`, s.customers.r3, 49.9, "MONTHLY", s.checkouts.r3);
const subB = snapshot(`sub_RC_r3b_${s.stamp}`, s.customers.r3, 49.9, "MONTHLY", s.checkouts.r3);
const dual = await Promise.all([subA, subB, subA, subB].map((snap) => rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: snap, p_event_id: null })));
const td = tally(dual);
check("UMA só assinatura ativada para a organização; a outra vira conflito (sem ser descartada)", td.created === 1 && (td.duplicate_subscription ?? 0) >= 1, JSON.stringify(td));

console.log("\n== 8/9: identificador de outra organização e checkout divergente ==");
const cross = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: snapshot(`sub_RC_r7x_${s.stamp}`, s.customers.r7x, 49.9, "MONTHLY", s.checkouts.r7y), p_event_id: null });
check("checkout de OUTRA organização nunca vincula", cross.data === "mismatch", String(cross.data));
const diverge = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: snapshot(`sub_RC_r7y_${s.stamp}`, s.customers.r7y, 49.9, "MONTHLY", "chk_DIVERGENTE_QUALQUER"), p_event_id: null });
check("checkout divergente do da intenção nunca ativa", diverge.data === "mismatch", String(diverge.data));
console.log("== 10: valor incorreto ==");
const wrong = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: snapshot(`sub_RC_r6_${s.stamp}`, s.customers.r6, 99.9, "MONTHLY", s.checkouts.r6), p_event_id: null });
check("valor diferente do contratado nunca ativa (mesmo com o checkout correto)", wrong.data === "mismatch", String(wrong.data));

console.log("\n== 12: assinatura anual (valor integral) em disputa ==");
const yearly = snapshot(`sub_RC_r8_${s.stamp}`, s.customers.r8, 499, "YEARLY", s.checkouts.r8);
const yr = await Promise.all(Array.from({ length: 6 }, () => rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: yearly, p_event_id: null })));
const ty = tally(yr);
check("anual: uma só criação", ty.created === 1 && (ty.noop ?? 0) === 5, JSON.stringify(ty));

console.log("\n== 1/4: coincidência sem identificador (resultado desconhecido) ==");
const unlinked = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: snapshot(`sub_RC_r9_${s.stamp}`, s.customers.r9, 49.9, "MONTHLY", "chk_QUE_NUNCA_CONHECEMOS"), p_event_id: null });
check("cliente + valor + ciclo + cartão iguais, SEM identificador verificável: não ativa, vai para revisão", unlinked.data === "unlinked_candidate", String(unlinked.data));
const blocked = await rpc("billing_create_intent", { p_agency_id: s.orgs.r9, p_user_id: OWNER, p_plan_version_id: PLAN_VERSION, p_cycle: "monthly", p_request_key: `rc-r9-novo-${s.stamp}`, p_environment: "sandbox" });
check("e nenhuma nova cobrança é aberta enquanto isso (bloqueio 55000)", blocked.error?.code === "55000", blocked.error?.code ?? "sem erro");

console.log("\n== 16/17: organização antiga e dados reais preservados (somente leitura) ==");
const old = await rpc("agency_billing_restricted", { p_agency_id: s.r2 });
check("organização sem assinatura não é restrita", old.data === false, String(old.data));
finish();
