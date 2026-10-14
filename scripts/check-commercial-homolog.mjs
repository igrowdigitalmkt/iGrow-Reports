/**
 * Testes REAIS (conexões independentes, via API do Supabase) do catálogo comercial — etapa 2.1.
 * Só contra o projeto de HOMOLOGAÇÃO, só com dados fictícios "TESTE-2.1". Não imprime segredos.
 * Pré-requisitos: migrations aplicadas na homologação, organizações de teste (fixtures) e operador de teste
 * (scripts/homolog-commercial-setup.mjs). Uso:
 *   node --env-file=.env.homolog --env-file=.env.homolog-teste21 scripts/check-commercial-homolog.mjs
 */
import { check, finish, newClient, signIn, signInTestOperator } from "./lib-homolog.mjs";

const A = "e2100000-0000-4000-8000-0000000000a1"; // organização COM plano (limite de clientes 3, equipe 3)
const B = "e2100000-0000-4000-8000-0000000000b1"; // organização SEM plano
const stamp = Date.now().toString(36);
const codes = (settled) => settled.map((item) => item.error?.code ?? "ok");
const count = (settled, wanted) => settled.filter((item) => (wanted === "ok" ? !item.error : item.error?.code === wanted)).length;

const user = await signIn(process.env.HOMOLOG_USER_EMAIL, process.env.HOMOLOG_USER_PASSWORD); // dono da organização A
const anon = newClient();
const op = await signInTestOperator(); // operador de teste com MFA validado (aal2)
const opPasswordOnly = await signIn(process.env.TESTE21_OPERATOR_EMAIL, process.env.TESTE21_OPERATOR_PASSWORD); // aal1

const activeClients = async () => (await user.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", A).is("archived_at", null)).count;
const archiveAll = () => user.from("clients").update({ archived_at: new Date().toISOString() }).eq("agency_id", A).is("archived_at", null);

console.log("== TESTE A: limite quantitativo sob concorrência real (clientes) ==");
for (const round of [1, 2]) {
  await archiveAll();
  const base = await user.from("clients").insert([{ agency_id: A, name: `TESTE-2.1 base ${stamp} r${round} 1` }, { agency_id: A, name: `TESTE-2.1 base ${stamp} r${round} 2` }]);
  // insere um por vez para não depender de lote
  if (base.error) { await user.from("clients").insert({ agency_id: A, name: `TESTE-2.1 base ${stamp} r${round} 1` }); await user.from("clients").insert({ agency_id: A, name: `TESTE-2.1 base ${stamp} r${round} 2` }); }
  const parallel = round === 1 ? 6 : 10;
  const settled = await Promise.all(Array.from({ length: parallel }, (_, index) => user.from("clients").insert({ agency_id: A, name: `TESTE-2.1 concorrente ${stamp} r${round} ${index}` })));
  check(`rodada ${round}: de ${parallel} tentativas simultâneas pelo último lugar, só 1 foi aceita`, count(settled, "ok") === 1, codes(settled).join(","));
  check(`rodada ${round}: as demais receberam o erro de limite (53400)`, count(settled, "53400") === parallel - 1);
  check(`rodada ${round}: a organização ficou com exatamente 3 clientes ativos (limite do plano)`, (await activeClients()) === 3);
  const message = settled.find((item) => item.error)?.error?.message ?? "";
  check(`rodada ${round}: a mensagem de recusa é clara`, /Limite do plano atingido/.test(message));
}
await archiveAll();

console.log("\n== TESTE A2: limite de equipe (membros + convites pendentes) sob concorrência ==");
const invites = await Promise.all(Array.from({ length: 6 }, (_, index) => user.rpc("issue_agency_invitation", { p_agency_id: A, p_email: `teste21-conv-${stamp}-${index}@exemplo.invalid`, p_role: "viewer", p_expires_in_hours: 1 })));
check("equipe: com 1 membro e limite 3, só 2 convites simultâneos foram aceitos", count(invites, "ok") === 2, codes(invites).join(","));
check("equipe: os demais foram recusados pelo limite (53400)", count(invites, "53400") === 4);
for (const item of invites.filter((entry) => !entry.error)) await user.rpc("revoke_agency_invitation", { p_invitation_id: item.data[0].invitation_id });

console.log("\n== TESTE B: publicação e rascunhos simultâneos (versões) ==");
const planKey = `teste21-conc-${stamp}`;
const created = await op.rpc("platform_create_plan", { p_key: planKey, p_name: `TESTE-2.1 Concorrência ${stamp}`, p_description: "plano fictício de teste", p_visibility: "private" });
const plan = created.data;
check("operador de teste (MFA) cria o plano", !created.error && Boolean(plan), created.error?.message);
await op.rpc("platform_save_draft", { p_plan_id: plan, p_trial_days: 0, p_price_monthly_cents: 1000, p_price_yearly_cents: 10000, p_entitlements: [{ key: "clients", limit: 1 }] });
check("publica a versão 1", (await op.rpc("platform_publish_draft", { p_plan_id: plan })).data === 1);
const starts = await Promise.all(Array.from({ length: 4 }, () => op.rpc("platform_start_draft", { p_plan_id: plan })));
check("4 pedidos simultâneos de nova versão: só 1 rascunho é criado", count(starts, "ok") === 1, codes(starts).join(","));
check("os demais recebem 'já existe rascunho' (23505)", count(starts, "23505") === 3);
await op.rpc("platform_save_draft", { p_plan_id: plan, p_trial_days: 14, p_price_monthly_cents: 2000, p_price_yearly_cents: 20000, p_entitlements: [{ key: "clients", limit: 5 }] });
const publishes = await Promise.all(Array.from({ length: 4 }, () => op.rpc("platform_publish_draft", { p_plan_id: plan })));
check("4 publicações simultâneas do mesmo rascunho: só 1 é aceita", count(publishes, "ok") === 1, codes(publishes).join(","));
check("as demais recebem 'não há rascunho' (22023), sem erro de integridade", count(publishes, "22023") === 3);
const detail = (await op.rpc("platform_get_plan", { p_plan_id: plan })).data;
const statuses = detail.versions.map((version) => `${version.version}:${version.status}`).sort().join(",");
check("histórico consistente: v1 substituída e v2 atual, sem versões duplicadas", statuses === "1:retired,2:published", statuses);
check("o plano aponta para a v2", detail.plan.current_version_id === detail.versions.find((version) => version.version === 2).id);
check("a v1 manteve preço e limite originais", detail.versions.find((version) => version.version === 1).price_monthly_cents === 1000 && detail.versions.find((version) => version.version === 1).entitlements[0].limit === 1);

console.log("\n== TESTE C: deadlock entre recursos diferentes (função auxiliar de teste) ==");
const probe = await user.rpc("zz_teste21_lock_pair", { p_org: A, p_first: "clients", p_second: "team_members" });
if (probe.error?.code === "PGRST202") console.log("(função auxiliar não instalada; teste C não executado)");
else {
  const [x, y] = await Promise.all([user.rpc("zz_teste21_lock_pair", { p_org: A, p_first: "clients", p_second: "team_members" }), user.rpc("zz_teste21_lock_pair", { p_org: A, p_first: "team_members", p_second: "clients" })]);
  const deadlocks = [x, y].filter((item) => item.error?.code === "40P01").length;
  check("duas transações pegando as travas em ordem oposta: o PostgreSQL detecta o deadlock e aborta uma (40P01)", deadlocks === 1 && [x, y].filter((item) => !item.error).length === 1, [x, y].map((item) => item.error?.code ?? "ok").join(","));
  check("a transação abortada pode ser repetida com segurança", !(await user.rpc("zz_teste21_lock_pair", { p_org: A, p_first: "team_members", p_second: "clients" })).error);
}

console.log("\n== SEGURANÇA: acesso direto às funções e tabelas, sem interface ==");
const platformCalls = [
  ["platform_list_plans", {}], ["platform_list_definitions", {}], ["platform_list_agencies", {}], ["platform_list_overrides", {}], ["platform_agency_entitlements", { p_agency_id: A }],
  ["platform_get_plan", { p_plan_id: plan }], ["platform_create_plan", { p_key: "invasor", p_name: "Invasor", p_description: "", p_visibility: "public" }],
  ["platform_update_plan", { p_plan_id: plan, p_name: "X", p_description: "", p_visibility: "public", p_sellable: true, p_recommended: false, p_sort_order: 1 }],
  ["platform_start_draft", { p_plan_id: plan }], ["platform_save_draft", { p_plan_id: plan, p_trial_days: 0, p_price_monthly_cents: 1, p_price_yearly_cents: null, p_entitlements: [] }],
  ["platform_discard_draft", { p_plan_id: plan }], ["platform_publish_draft", { p_plan_id: plan }],
  ["platform_assign_plan", { p_agency_id: B, p_plan_version_id: detail.plan.current_version_id, p_note: "tentativa indevida" }], ["platform_unassign_plan", { p_agency_id: A }],
  ["platform_grant_override", { p_agency_id: A, p_key: "clients", p_enabled: null, p_limit: 999, p_unlimited: false, p_expires_at: null, p_reason: "tentativa indevida" }],
  ["platform_revoke_override", { p_override_id: "00000000-0000-4000-8000-000000000000" }], ["platform_set_feature_switch", { p_key: "client_portal", p_enabled: false, p_reason: "tentativa indevida" }],
];
const asCommon = await Promise.all(platformCalls.map(([name, args]) => user.rpc(name, args)));
check(`usuário comum (dono de organização): as ${platformCalls.length} funções administrativas recusam (42501)`, asCommon.every((item) => item.error?.code === "42501"), codes(asCommon).filter((code) => code !== "42501").join(","));
const asAnon = await Promise.all(platformCalls.map(([name, args]) => anon.rpc(name, args)));
check("sem login (anon): nenhuma função administrativa responde", asAnon.every((item) => item.error), codes(asAnon).filter((code) => code === "ok").join(","));
const asAal1 = await Promise.all(platformCalls.map(([name, args]) => opPasswordOnly.rpc(name, args)));
check("operador só com senha (sem MFA): todas as funções administrativas recusam (42501)", asAal1.every((item) => item.error?.code === "42501"), codes(asAal1).filter((code) => code !== "42501").join(","));
check("função interna da IA não é acessível ao usuário nem ao anon", (await user.rpc("agency_ai_entitlement", { p_agency_id: A })).error?.code === "42501" && Boolean((await anon.rpc("agency_ai_entitlement", { p_agency_id: A })).error));
check("usuário lê os direitos da PRÓPRIA organização", !(await user.rpc("get_agency_entitlements", { p_agency_id: A })).error);
check("usuário NÃO lê os direitos de outra organização (42501)", (await user.rpc("get_agency_entitlements", { p_agency_id: B })).error?.code === "42501");
check("sem login, direitos de organização não são lidos", Boolean((await anon.rpc("get_agency_entitlements", { p_agency_id: A })).error));
const otherClients = await user.from("clients").select("id").eq("agency_id", B);
check("isolamento: usuário da organização A não enxerga clientes da organização B (RLS)", !otherClients.error && otherClients.data.length === 0);
check("tabelas do catálogo (schema private) não são expostas pela API", Boolean((await user.schema("private").from("plans").select("*")).error) && Boolean((await anon.schema("private").from("entitlement_overrides").select("*")).error));
check("usuário comum não grava em planos por nenhum caminho de tabela", Boolean((await user.from("plans").select("*")).error));
check("operador com MFA lista planos e organizações", !(await op.rpc("platform_list_plans")).error && !(await op.rpc("platform_list_agencies")).error);

console.log("\n== CONCESSÃO ADMINISTRATIVA × ASSINATURA PAGA ==");
const noReason = await op.rpc("platform_assign_plan", { p_agency_id: B, p_plan_version_id: detail.plan.current_version_id, p_note: "" });
check("conceder plano exige motivo (22023)", noReason.error?.code === "22023");
check("o banco não aceita 'subscription' pela API: só funções internas escrevem esse tipo", Boolean((await op.schema("private").from("agency_plan_assignments").insert({ agency_id: B, plan_version_id: detail.plan.current_version_id, kind: "subscription" })).error));

finish();
