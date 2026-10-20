// VERIFICAÇÃO DE CONCORRÊNCIA da reserva atômica de IA em um PostgreSQL REAL. NÃO FOI EXECUTADA (preparada para a homologação).
// Nunca execute em produção. Usa só dados sintéticos: reservas de teste são liberadas (custo 0) ao final e ficam como linhas de auditoria.
//
// Proteções contra execução acidental (todas obrigatórias):
//   1. HOMOLOG_CONFIRM=1 e ALLOWED_PROJECT_REF (referência do projeto de HOMOLOGAÇÃO) informados explicitamente: a URL precisa conter essa
//      referência (lista de permissão positiva) e NÃO pode conter a referência de produção fixada abaixo (lista de negação).
//   2. A organização de teste (TEST_AGENCY_ID) precisa ter o nome que começa com "TESTE-HOMOLOG" (confirmado no banco antes de qualquer reserva).
//   3. A chave de serviço é lida do ambiente e nunca é impressa; nenhuma credencial é gravada em arquivo.
//
// Uso (PowerShell), com o banco de HOMOLOGAÇÃO e duas organizações sintéticas autorizadas por você (A = alvo, B = isolamento):
//   $env:HOMOLOG_CONFIRM="1"; $env:ALLOWED_PROJECT_REF="<referência do projeto de homologação>"
//   $env:SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
//   $env:TEST_AGENCY_ID="..."; $env:TEST_CLIENT_ID="..."; $env:TEST_USER_ID="..."; $env:OTHER_AGENCY_ID="..."; $env:OTHER_CLIENT_ID="..."
//   node scripts/ai-reservation-concurrency-check.mjs
// Antes: configure para a organização A um orçamento mensal pequeno (por exemplo, US$ 0,50) em IA e Configurações e garanta que o
// plano dela permita IA (o teto efetivo é o menor entre a configuração e o plano; o script lê o teto efetivo devolvido pelo banco).
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "qlopniyghvpbgwxuwxrl";
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_AGENCY_ID, TEST_CLIENT_ID, TEST_USER_ID, OTHER_AGENCY_ID, OTHER_CLIENT_ID, HOMOLOG_CONFIRM, ALLOWED_PROJECT_REF } = process.env;
const refuse = text => { console.error(`Recusado: ${text}`); process.exit(1); };
if (HOMOLOG_CONFIRM !== "1" || !ALLOWED_PROJECT_REF || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TEST_AGENCY_ID || !TEST_CLIENT_ID || !TEST_USER_ID || !OTHER_AGENCY_ID || !OTHER_CLIENT_ID)
  refuse("defina HOMOLOG_CONFIRM=1, ALLOWED_PROJECT_REF e as variáveis do banco de homologação e das duas organizações de teste.");
if (ALLOWED_PROJECT_REF === PRODUCTION_PROJECT_REF || SUPABASE_URL.includes(PRODUCTION_PROJECT_REF)) refuse("a URL ou a referência permitida aponta para a PRODUÇÃO.");
let host;
try { host = new URL(SUPABASE_URL).hostname; } catch { refuse("SUPABASE_URL inválida."); }
if (!host.startsWith(`${ALLOWED_PROJECT_REF}.`)) refuse("a URL não pertence ao projeto de homologação informado em ALLOWED_PROJECT_REF.");
if (TEST_AGENCY_ID === OTHER_AGENCY_ID) refuse("as duas organizações de teste precisam ser diferentes.");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = Date.now();
const ESTIMATE = 0.1;
const PARALLEL = 12;
const reserve = (key, { agency = TEST_AGENCY_ID, client = TEST_CLIENT_ID, scope = "concurrency-scope" } = {}) => sb.rpc("reserve_ai_usage", {
  p_agency_id: agency, p_client_id: client, p_user_id: TEST_USER_ID, p_feature: "campaign_chat", p_model: "claude-sonnet-5-5",
  p_request_key: key, p_scope_hash: scope, p_estimated_usd: ESTIMATE,
});
const first = ({ data }) => data?.[0];
const tally = results => results.reduce((acc, r) => { const k = r.error ? `erro:${r.error.code ?? "?"}` : first(r)?.outcome ?? "vazio"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const ids = new Map(); // usage_id -> agency
let failed = false;
const check = (ok, text) => { console.log(`${ok ? "OK   " : "FALHA"} ${text}`); if (!ok) failed = true; };
const remember = (results, agency) => { for (const r of results) { const row = first(r); if (row?.outcome === "reserved") ids.set(row.usage_id, agency); } };
const monthCost = async agency => Number((await sb.rpc("ai_month_cost", { p_agency_id: agency })).data ?? 0);
// Mede a sobreposição real: cada chamada registra início e fim; a verificação só vale se houve chamadas em andamento ao mesmo tempo.
const timed = async fn => { const start = performance.now(); const result = await fn(); return { result, start, end: performance.now() }; };
const overlapping = spans => spans.some((a, i) => spans.some((b, j) => i !== j && a.start < b.end && b.start < a.end));

// 0) Pré-condições: estrutura, organização de teste identificada pelo nome, isolamento entre organizações.
check((await sb.rpc("ai_reservations_ready")).data === true, "estrutura de reservas presente e funcional neste banco (sonda estrutural e funcional)");
check((await sb.rpc("ai_usage_supports_feature", { p_feature: "campaign_chat" })).data === true, "categoria campaign_chat aceita neste banco");
const { data: agencies } = await sb.from("agencies").select("id,name").in("id", [TEST_AGENCY_ID, OTHER_AGENCY_ID]);
const nameOf = id => agencies?.find(a => a.id === id)?.name ?? "";
if (!nameOf(TEST_AGENCY_ID).startsWith("TESTE-HOMOLOG") || !nameOf(OTHER_AGENCY_ID).startsWith("TESTE-HOMOLOG")) refuse('as organizações de teste precisam ter nome iniciado por "TESTE-HOMOLOG".');
if (failed) { console.log("RESULTADO: FALHOU (pré-condições)"); process.exit(1); }

// 1) Orçamento: a primeira reserva revela o teto EFETIVO calculado pelo banco (menor entre configuração e plano, nunca vindo do script).
const probe = await reserve(`conc-probe-${run}`);
remember([probe], TEST_AGENCY_ID);
const probeRow = first(probe);
check(probeRow?.outcome === "reserved", `reserva de sondagem autorizada (resultado: ${probeRow?.outcome ?? probe.error?.code ?? "vazio"}); a organização de teste precisa ter plano com IA e orçamento livre`);
if (probeRow?.outcome !== "reserved") { console.log("RESULTADO: FALHOU (sem reserva de sondagem)"); process.exit(1); }
const budget = Number(probeRow.budget_usd);
const afterProbe = Number(probeRow.month_cost_usd);
const expected = Math.max(0, Math.floor((budget - afterProbe + 1e-9) / ESTIMATE));
console.log(`teto efetivo (banco): ${budget}; gasto do mês após a sondagem: ${afterProbe}; reservas ainda cabíveis: ${expected}`);
check(expected >= 1 && expected < PARALLEL, `o orçamento de teste é pequeno o bastante para a disputa (cabem ${expected} de ${PARALLEL}); ajuste o orçamento mensal se isto falhar`);

const spans = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => timed(() => reserve(`conc-${run}-${i}`))));
const parallel = spans.map(s => s.result);
remember(parallel, TEST_AGENCY_ID);
const counts = tally(parallel);
console.log("resultados:", JSON.stringify(counts));
check(overlapping(spans), "as chamadas realmente se sobrepuseram no tempo (a disputa é real, não sequencial)");
check((counts.reserved ?? 0) === Math.min(PARALLEL, expected), "reservou exatamente o que o orçamento comporta (nem mais, nem menos)");
check((counts.reserved ?? 0) + (counts.budget ?? 0) === PARALLEL, "toda chamada excedente foi recusada por orçamento (nenhum erro ou resultado inesperado)");
const spentNow = await monthCost(TEST_AGENCY_ID);
check(spentNow <= budget + 1e-9, `o gasto do mês no banco (${spentNow}) não ultrapassa o teto efetivo (${budget})`);

// 2) Idempotência: o MESMO identificador em paralelo cria exatamente uma reserva (ou nenhuma, se o orçamento acabou).
const sameKey = `conc-same-${run}`;
const dup = await Promise.all(Array.from({ length: 6 }, () => reserve(sameKey)));
remember(dup, TEST_AGENCY_ID);
const dupCounts = tally(dup);
console.log("mesmo identificador:", JSON.stringify(dupCounts));
check((dupCounts.reserved ?? 0) <= 1 && (dupCounts.reserved ?? 0) + (dupCounts.duplicate_in_flight ?? 0) + (dupCounts.budget ?? 0) === 6, "mesmo identificador nunca cria duas reservas");
const { count: rowsForKey } = await sb.from("ai_usage").select("id", { count: "exact", head: true }).eq("agency_id", TEST_AGENCY_ID).eq("request_key", sameKey);
check((rowsForKey ?? 0) <= 1, "no banco existe no máximo uma linha para o identificador repetido");
// Mesmo identificador com outro contexto autorizado (scope_hash diferente): conflito, nunca uma segunda chamada paga.
if ((rowsForKey ?? 0) === 1) {
  const conflict = await reserve(sameKey, { scope: "concurrency-scope-other" });
  check(first(conflict)?.outcome === "conflict", "mesmo identificador com outro contexto é recusado (conflict)");
}

// 3) Liquidação repetida em paralelo: um único efeito e valores corretos.
const target = [...ids.keys()][0];
if (target) {
  const settle = () => sb.rpc("settle_ai_usage", { p_usage_id: target, p_agency_id: TEST_AGENCY_ID, p_outcome: "completed", p_status: "ok", p_cost_usd: 0.01 });
  const settled = await Promise.all(Array.from({ length: 6 }, settle));
  const settledCounts = tally(settled);
  console.log("liquidação repetida:", JSON.stringify(settledCounts));
  check((settledCounts.settled ?? 0) === 1 && (settledCounts.already_settled ?? 0) === 5, "liquidação repetida tem um único efeito");
  const { data: row } = await sb.from("ai_usage").select("status,cost_usd,needs_reconciliation").eq("id", target).single();
  check(row?.status === "ok" && Number(row?.cost_usd) === 0.01 && row?.needs_reconciliation === false, "a linha liquidada tem o custo real e nenhuma pendência de conciliação");
}

// 4) Isolamento entre organizações: reservas de B não consomem o orçamento de A, e liquidar com a organização errada falha.
const beforeA = await monthCost(TEST_AGENCY_ID);
const other = await reserve(`conc-other-${run}`, { agency: OTHER_AGENCY_ID, client: OTHER_CLIENT_ID, scope: "concurrency-scope-b" });
remember([other], OTHER_AGENCY_ID);
check(await monthCost(TEST_AGENCY_ID) === beforeA, "reserva da outra organização não altera o gasto da organização A");
const wrongOrg = await sb.rpc("settle_ai_usage", { p_usage_id: target ?? "00000000-0000-4000-8000-000000000000", p_agency_id: OTHER_AGENCY_ID, p_outcome: "released" });
check(first(wrongOrg)?.outcome === "not_found", "liquidar uma reserva com a organização errada é recusado (not_found)");
const crossClient = await reserve(`conc-cross-${run}`, { agency: TEST_AGENCY_ID, client: OTHER_CLIENT_ID });
check(first(crossClient)?.outcome === "invalid", "cliente de outra organização é recusado na reserva (invalid)");

// 5) Limpeza: libera todas as reservas de teste ainda abertas (custo 0), em paralelo, e confere que nada ficou aberto.
await Promise.all([...ids].filter(([id]) => id !== target).map(([id, agency]) => sb.rpc("settle_ai_usage", { p_usage_id: id, p_agency_id: agency, p_outcome: "released" })));
const { count: open } = await sb.from("ai_usage").select("id", { count: "exact", head: true }).in("agency_id", [TEST_AGENCY_ID, OTHER_AGENCY_ID]).eq("status", "reserved").like("request_key", `conc-%${run}%`);
check((open ?? 0) === 0, "nenhuma reserva de teste ficou aberta");
console.log(failed ? "RESULTADO: FALHOU" : "RESULTADO: concorrência, idempotência e isolamento conferidos neste banco");
process.exit(failed ? 1 : 0);
