/**
 * TESTE (não faz parte do produto): CONCORRÊNCIA REAL do ciclo de vida (etapa 2.2C) por conexões HTTP independentes contra o Supabase de
 * HOMOLOGAÇÃO. Só organizações/assinaturas FICTÍCIAS "TESTE-2.2L" que existem APENAS no banco (nada é criado ou cancelado no Asaas) e NUNCA
 * toca nas assinaturas dos testes anteriores. Não imprime segredos. As organizações novas ficam (registros financeiros são imutáveis por desenho).
 * Uso: node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/check-billing-lifecycle-homolog.mjs
 */
import { adminClient, check, finish } from "./lib-homolog.mjs";

const db = adminClient();
const stamp = Date.now().toString(36);
const OWNER = "22000000-0000-4000-8000-000000000001";
const PLAN_VERSION = "22cccccc-0000-4000-8000-000000000001"; // 49,90/mês, 499,00/ano
const rpc = (name, args) => db.rpc(name, args);
const tally = (settled) => settled.reduce((acc, item) => { const key = item.error ? `erro:${item.error.code}` : typeof item.data === "string" ? item.data : item.data === null ? "ok" : "obj"; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10); };
const payment = (id, sub, customer, due, status, observed = new Date()) => ({ id, subscription: sub, customer, value: 49.9, dueDate: due, status, billingType: "CREDIT_CARD", confirmedDate: status === "CONFIRMED" ? due : null, observedAt: observed.toISOString() });

async function activeSubscription(label, dueOffset) {
  const org = await db.from("agencies").insert({ name: `TESTE-2.2L ${label} ${stamp}` }).select("id").single();
  if (org.error) throw new Error(`Organização: ${org.error.message}`);
  const linked = await db.from("agency_users").insert({ agency_id: org.data.id, user_id: OWNER, role: "owner" });
  if (linked.error) throw new Error(`Vínculo: ${linked.error.message}`);
  const customer = `cus_LC_${label}_${stamp}`, checkout = `chk_LC_${label}_${stamp}`, sub = `sub_LC_${label}_${stamp}`;
  await rpc("billing_set_customer", { p_agency_id: org.data.id, p_environment: "sandbox", p_asaas_customer_id: customer });
  const intent = await rpc("billing_create_intent", { p_agency_id: org.data.id, p_user_id: OWNER, p_plan_version_id: PLAN_VERSION, p_cycle: "monthly", p_request_key: `lc-${label}-${stamp}`, p_environment: "sandbox" });
  if (intent.error) throw new Error(`Intenção: ${intent.error.message}`);
  await rpc("billing_mark_intent", { p_intent_id: intent.data.intent_id, p_status: "dispatching" });
  await rpc("billing_mark_intent", { p_intent_id: intent.data.intent_id, p_status: "awaiting_payment", p_checkout_id: checkout, p_checkout_url: `https://sandbox.example.test/${checkout}` });
  const created = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: { id: sub, customer, value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD", checkoutSession: checkout }, p_event_id: null });
  const paid = await rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: payment(`pay_LC_${label}_${stamp}_a`, sub, customer, iso(dueOffset), "CONFIRMED"), p_event_id: null, p_signal: null });
  if (created.data !== "created" || paid.data !== "activated") throw new Error(`Preparação falhou: ${created.data}/${paid.data}`);
  return { agency: org.data.id, customer, sub };
}

console.log("== A: cancelamento duplicado e confirmação repetida (conexões independentes) ==");
const c = await activeSubscription("cancel", 0);
const cancels = await Promise.all(Array.from({ length: 8 }, () => rpc("billing_request_cancel", { p_agency_id: c.agency, p_user_id: OWNER })));
check("8 pedidos simultâneos: todos aceitos", cancels.every((item) => !item.error), JSON.stringify(tally(cancels)));
check("todos devolvem o MESMO pedido (mesma assinatura e mesmo fim de período)", new Set(cancels.map((item) => `${item.data?.subscription_id}|${item.data?.effective_at}`)).size === 1);
check("assinatura continua ativa (período pago preservado)", cancels.every((item) => item.data?.status === "active" && item.data?.remote_cancel_pending === true));
const subId = cancels[0].data.subscription_id;
const confirms = await Promise.all(Array.from({ length: 8 }, () => rpc("billing_confirm_remote_cancel", { p_subscription_id: subId })));
check("8 confirmações simultâneas do Asaas: nenhuma falhou", confirms.every((item) => !item.error));
const stranger = await rpc("billing_request_cancel", { p_agency_id: c.agency, p_user_id: "22000000-0000-4000-8000-000000000003" });
check("usuário de outra organização continua recusado (42501)", stranger.error?.code === "42501", stranger.error?.code);

console.log("\n== B: renovação mensal confirmada 10 vezes ao mesmo tempo (webhook + cron) ==");
const r = await activeSubscription("renov", 0);
const renewal = payment(`pay_LC_renov_${stamp}_b`, r.sub, r.customer, iso(30), "CONFIRMED");
const renewals = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: renewal, p_event_id: null, p_signal: null })));
const tr = tally(renewals);
check("a renovação ativa UMA vez; as demais são duplicidade segura", tr.activated === 1 && (tr.noop_duplicate ?? 0) + (tr.stale_snapshot ?? 0) === 9, JSON.stringify(tr));

console.log("\n== C: atraso e regularização simultâneos ==");
const d = await activeSubscription("atraso", -31);
const overdue = payment(`pay_LC_atraso_${stamp}_b`, d.sub, d.customer, iso(-1), "OVERDUE");
const lates = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: overdue, p_event_id: null, p_signal: null })));
const tl = tally(lates);
check("atraso registrado UMA vez (past_due); repetições não reiniciam a tolerância", tl.past_due === 1 && (tl.recorded_only ?? 0) + (tl.stale_snapshot ?? 0) === 9, JSON.stringify(tl));
const paidLate = payment(`pay_LC_atraso_${stamp}_b`, d.sub, d.customer, iso(-1), "CONFIRMED", new Date(Date.now() + 60_000));
const regs = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: paidLate, p_event_id: null, p_signal: null })));
const tg = tally(regs);
check("regularização aplicada UMA vez; as demais idempotentes", tg.activated === 1 && (tg.noop_duplicate ?? 0) === 9, JSON.stringify(tg));

console.log(`\nOrganizações criadas (fictícias): cancel=${c.agency.slice(0, 8)} renov=${r.agency.slice(0, 8)} atraso=${d.agency.slice(0, 8)}`);
finish();
