/**
 * TESTE (não é parte do produto): concorrência REAL da fundação financeira (etapa 2.2A), por conexões HTTP independentes,
 * contra o Supabase de HOMOLOGAÇÃO. Só dados fictícios "TESTE-2.2"; nenhuma chamada ao Asaas; não imprime segredos.
 * Cada execução cria organizações e um usuário NOVOS (registros financeiros são imutáveis por desenho, então não são apagados).
 * Uso: node --env-file=.env.homolog --env-file=.env.asaas-sandbox scripts/check-billing-homolog.mjs
 */
import { adminClient, check, finish } from "./lib-homolog.mjs";

const db = adminClient();
const stamp = Date.now().toString(36);
const OWNER = "22000000-0000-4000-8000-000000000001";
const ADMIN = "22000000-0000-4000-8000-000000000002";
const OTHER = "22000000-0000-4000-8000-000000000003";
const PLAN_VERSION = "22cccccc-0000-4000-8000-000000000001"; // 49,90/mês, 499,00/ano, à venda
const rpc = (name, args) => db.rpc(name, args);
const count = (settled, wanted) => settled.filter((item) => (wanted === "ok" ? !item.error : item.error?.code === wanted)).length;
const codes = (settled) => settled.map((item) => item.error?.code ?? "ok").join(",");

async function newOrg(label, members) {
  const { data, error } = await db.from("agencies").insert({ name: `TESTE-2.2 ${label} ${stamp}` }).select("id").single();
  if (error) throw new Error(`Não foi possível criar a organização de teste: ${error.message}`);
  const { error: memberError } = await db.from("agency_users").insert(members.map(([user_id, role]) => ({ agency_id: data.id, user_id, role })));
  if (memberError) throw new Error(`Não foi possível vincular os usuários: ${memberError.message}`);
  return data.id;
}

console.log("== Organizações e usuário de teste desta execução ==");
const r1 = await newOrg("contratação", [[OWNER, "owner"], [ADMIN, "admin"]]);
const r2 = await newOrg("mesma chave", [[OTHER, "owner"]]);
const created = await db.auth.admin.createUser({ email: `teste22-trial-${stamp}@example.test`, email_confirm: true });
if (created.error) throw new Error(`Não foi possível criar o usuário de teste: ${created.error.message}`);
const trialUser = created.data.user.id;
const r3 = await newOrg("teste gratuito A", [[trialUser, "owner"]]);
const r4 = await newOrg("teste gratuito B", [[trialUser, "owner"]]);
const intent = (agency, user, key, cycle = "monthly", environment = "sandbox") =>
  rpc("billing_create_intent", { p_agency_id: agency, p_user_id: user, p_plan_version_id: PLAN_VERSION, p_cycle: cycle, p_request_key: key, p_environment: environment });

console.log("\n== A: contratações simultâneas (conexões independentes) ==");
const manyKeys = await Promise.all(Array.from({ length: 12 }, (_, index) => intent(r1, OWNER, `conc-${stamp}-${index}`, index % 2 ? "yearly" : "monthly")));
const ids = new Set(manyKeys.filter((item) => !item.error).map((item) => item.data.intent_id));
check("12 solicitações simultâneas com chaves diferentes: nenhuma falhou", count(manyKeys, "ok") === 12, codes(manyKeys));
check("todas devolveram a MESMA intenção (só uma contratação válida)", ids.size === 1, `${ids.size} intenções`);
check("exatamente uma criou a intenção; as outras reaproveitaram", manyKeys.filter((item) => item.data?.reused === false).length === 1);
const sameKey = await Promise.all(Array.from({ length: 12 }, () => intent(r2, OTHER, `same-${stamp}`)));
check("12 reenvios simultâneos da MESMA chave: uma intenção só", new Set(sameKey.filter((item) => !item.error).map((item) => item.data.intent_id)).size === 1 && sameKey.filter((item) => item.data?.reused === false).length === 1, codes(sameKey));
const asAdmin = await intent(r1, ADMIN, `adm-${stamp}`);
const asOther = await intent(r1, OTHER, `out-${stamp}`);
const asProduction = await intent(r1, OWNER, `prod-${stamp}`, "monthly", "production");
check("administrador não contrata (42501)", asAdmin.error?.code === "42501");
check("dono de outra organização não contrata aqui (42501)", asOther.error?.code === "42501");
check("ambiente de produção do Asaas é recusado pelo banco (42501)", asProduction.error?.code === "42501");

console.log("\n== B: assinatura e pagamento simultâneos (mesmos eventos repetidos) ==");
const winner = manyKeys.find((item) => item.data?.reused === false).data; // o ciclo vencedor da corrida (mensal ou anual) define o valor esperado
const intentId = winner.intent_id;
const winnerCycle = winner.cycle === "yearly" ? "YEARLY" : "MONTHLY";
const winnerValue = winner.amount_cents / 100;
const customer = `cus_c22${stamp}`;
const subscription = `sub_c22${stamp}`;
check("envio registrado antes da chamada", (await rpc("billing_mark_intent", { p_intent_id: intentId, p_status: "dispatching" })).data?.status === "dispatching");
check("checkout simulado aguardando pagamento", (await rpc("billing_mark_intent", { p_intent_id: intentId, p_status: "awaiting_payment", p_checkout_id: `chk_c22${stamp}`, p_checkout_url: "https://sandbox.example.test/c" })).data?.status === "awaiting_payment");
check("cliente financeiro registrado", (await rpc("billing_set_customer", { p_agency_id: r1, p_environment: "sandbox", p_asaas_customer_id: customer })).data === customer);
const subSnapshot = { id: subscription, customer, value: winnerValue, cycle: winnerCycle, status: "ACTIVE", billingType: "CREDIT_CARD" };
const subs = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: subSnapshot, p_event_id: null })));
check("10 aplicações simultâneas da mesma assinatura: exatamente 1 criação", subs.filter((item) => item.data === "created").length === 1 && subs.filter((item) => item.data === "noop").length === 9, codes(subs) + " " + subs.map((item) => item.data).join(","));
const duplicate = await rpc("billing_apply_subscription", { p_environment: "sandbox", p_snapshot: { ...subSnapshot, id: `sub_dup${stamp}` }, p_event_id: null });
check("segunda assinatura da mesma organização é detectada e não ativada", duplicate.data === "duplicate_subscription", String(duplicate.data));
const due = new Date().toISOString().slice(0, 10);
const paySnapshot = { id: `pay_c22${stamp}`, subscription, customer, value: winnerValue, dueDate: due, status: "CONFIRMED", billingType: "CREDIT_CARD", observedAt: new Date().toISOString() };
const pays = await Promise.all(Array.from({ length: 10 }, () => rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: paySnapshot, p_event_id: null, p_signal: null })));
check("10 confirmações simultâneas do mesmo pagamento: ativa UMA vez", pays.filter((item) => item.data === "activated").length === 1 && pays.filter((item) => item.data === "noop_duplicate").length === 9, pays.map((item) => item.data ?? item.error?.code).join(","));
const stale = await rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: { ...paySnapshot, status: "PENDING", observedAt: new Date(Date.now() - 3_600_000).toISOString() }, p_event_id: null, p_signal: null });
check("retrato antigo (evento fora de ordem) é ignorado", stale.data === "stale_snapshot", String(stale.data));
const noCard = await rpc("billing_apply_payment", { p_environment: "sandbox", p_snapshot: { ...paySnapshot, id: `pay_bol${stamp}`, billingType: "BOLETO", observedAt: new Date().toISOString() }, p_event_id: null, p_signal: null });
check("pagamento que não é de cartão não ativa nada", noCard.data === "mismatch", String(noCard.data));
check("nova contratação com assinatura viva é recusada (23505)", (await intent(r1, OWNER, `again-${stamp}`)).error?.code === "23505");
const cancels = await Promise.all(Array.from({ length: 5 }, () => rpc("billing_request_cancel", { p_agency_id: r1, p_user_id: OWNER })));
check("5 pedidos simultâneos de cancelamento: todos consistentes, assinatura segue ativa até o fim do período", count(cancels, "ok") === 5 && new Set(cancels.map((item) => item.data?.effective_at)).size === 1 && cancels.every((item) => item.data?.status === "active" && item.data?.remote_cancel_pending === true), codes(cancels));
check("administrador não cancela (42501)", (await rpc("billing_request_cancel", { p_agency_id: r1, p_user_id: ADMIN })).error?.code === "42501");
const maintenance = await Promise.all(Array.from({ length: 5 }, () => rpc("billing_run_maintenance")));
check("5 manutenções simultâneas sem erro", count(maintenance, "ok") === 5, codes(maintenance));

console.log("\n== C: eventos (caixa de entrada durável) simultâneos ==");
const eventId = `evt_c22_${stamp}`;
const recs = await Promise.all(Array.from({ length: 12 }, () => rpc("billing_record_event", { p_environment: "sandbox", p_event_id: eventId, p_event_type: "PAYMENT_CONFIRMED", p_resource_type: "payment", p_resource_id: `pay_ev${stamp}`, p_payload: { id: eventId } })));
check("12 entregas simultâneas do mesmo evento: gravado UMA vez, as outras reconhecidas como duplicadas", recs.filter((item) => item.data?.duplicate === false).length === 1 && recs.filter((item) => item.data?.duplicate === true).length === 11, codes(recs));
const bulk = await Promise.all(Array.from({ length: 30 }, (_, index) => rpc("billing_record_event", { p_environment: "sandbox", p_event_id: `evt_c22b_${stamp}_${index}`, p_event_type: "PAYMENT_UPDATED", p_resource_type: "payment", p_resource_id: `pay_bulk${stamp}${index}`, p_payload: { n: index } })));
check("30 eventos distintos gravados em paralelo", count(bulk, "ok") === 30 && bulk.every((item) => item.data?.duplicate === false));
const claims = await Promise.all(Array.from({ length: 6 }, () => rpc("billing_claim_events", { p_limit: 10, p_lease_seconds: 60, p_event_id: null })));
const claimed = claims.flatMap((item) => item.data ?? []);
const mine = claimed.filter((event) => String(event.resource_id ?? "").includes(stamp));
check("6 processadores reservando ao mesmo tempo: nenhum evento entregue duas vezes", new Set(claimed.map((event) => event.id)).size === claimed.length, `${claimed.length} reservas`);
check("os 31 eventos desta execução foram reservados exatamente uma vez", mine.length === 31 && new Set(mine.map((event) => event.id)).size === 31, `${mine.length}`);
for (const event of claimed) await rpc("billing_finish_event", { p_id: event.id, p_outcome: "ignored", p_detail: "teste de concorrência", p_retry_seconds: 60 });

console.log("\n== D: teste gratuito (um por usuário, mesmo com corridas) ==");
const trials = await Promise.all([r3, r4, r3, r4, r3, r4].map((org) => rpc("billing_start_trial", { p_agency_id: org, p_user_id: trialUser })));
check("6 inícios simultâneos de teste (2 organizações, mesmo usuário): exatamente 1 teve sucesso", count(trials, "ok") === 1, codes(trials));
check("os demais foram recusados por regra (22023/23505), não por erro", trials.filter((item) => item.error).every((item) => ["22023", "23505"].includes(item.error.code)), codes(trials));

console.log("\n== E: servidor ==");
check("organização legada de controle segue sem restrição", (await rpc("agency_billing_restricted", { p_agency_id: r2 })).data === false);
check("organização com assinatura ativa não é restrita", (await rpc("agency_billing_restricted", { p_agency_id: r1 })).data === false);
finish();
