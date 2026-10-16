/**
 * TESTE (não faz parte do produto): homologação REAL da integração com o Asaas gerenciada pelo Super Admin. Somente HOMOLOGAÇÃO + Asaas SANDBOX.
 * Usa o operador de teste (com MFA), o proprietário de uma organização fictícia e chamadas HTTP reais à aplicação de homologação (webhook, cron, página).
 * Prova: Vault real, bloqueio de usuário comum / sem MFA, troca de conta bloqueada, rotação de token com transição, rejeição de token inválido,
 * a camada financeira usando a chave do PAINEL (chave inválida no painel derruba o processamento mesmo com a variável de ambiente válida; ao restaurar,
 * o evento é recuperado), página sem segredos. Não imprime chave nem token. Termina deixando a homologação com a chave real e o token ORIGINAL no painel.
 * Uso: node --env-file=.env.homolog --env-file=.env.homolog-vercel --env-file=.env.homolog-teste21 --env-file=.env.homolog-teste22b --env-file=.env.asaas-sandbox scripts/check-asaas-integration-homolog.mjs <payment_id_real_sandbox>
 */
import crypto from "node:crypto";
import { check, finish, newClient, signIn, signInTestOperator } from "./lib-homolog.mjs";

const e = process.env;
const base = e.HOMOLOG_APP_URL;
if (!base?.includes("i-grow-reports-homolog") || !e.HOMOLOG_SUPABASE_URL?.includes("xvjvfvinnnrgnhskglvd")) throw new Error("Somente a homologação.");
const key = e.ASAAS_API_KEY, original = e.ASAAS_WEBHOOK_TOKEN;
if (e.ASAAS_ENVIRONMENT !== "sandbox" || !key || key.startsWith("$aact_prod_") || !original) throw new Error("Somente Asaas Sandbox.");
const paymentId = process.argv[2];
if (!/^pay_[0-9a-z]{16}$/.test(paymentId ?? "")) throw new Error("Informe o id de um pagamento real do Sandbox.");
const BYPASS = { "x-vercel-protection-bypass": e.HOMOLOG_BYPASS_SECRET };
const token = () => crypto.randomBytes(36).toString("base64url");
const fingerprint = (id) => crypto.createHash("sha256").update(`igrow:asaas:sandbox:${id}`).digest("hex");
const evtId = () => `evt_${crypto.randomBytes(8).toString("hex")}&1`;

const operator = await signInTestOperator();
const aal1 = await signIn(e.TESTE21_OPERATOR_EMAIL, e.TESTE21_OPERATOR_PASSWORD);
const owner = await signIn(e.TESTE22B_OWNER_EMAIL, e.TESTE22B_OWNER_PASSWORD);
const anon = newClient();
const rpc = async (client, name, args) => { const { data, error } = await client.rpc(name, args); return { data, code: error?.code ?? null, message: error?.message ?? "" }; };
const sessionCookie = async (client) => {
  const { data } = await client.auth.getSession();
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180));
  return parts.length === 1 ? `igrow-auth=${value}` : parts.map((part, index) => `igrow-auth.${index}=${part}`).join("; ");
};
const webhook = async (tokenValue, eventType = "ACCOUNT_STATUS_UPDATED", payment = null) => {
  const body = payment ? { id: evtId(), event: eventType, payment: { id: payment } } : { id: evtId(), event: eventType };
  const response = await fetch(`${base}/api/webhooks/asaas`, { method: "POST", headers: { "content-type": "application/json", ...BYPASS, ...(tokenValue ? { "asaas-access-token": tokenValue } : {}) }, body: JSON.stringify(body) });
  await response.arrayBuffer().catch(() => null);
  return { status: response.status, eventId: body.id };
};

// 1) Permissões (Postgres real)
for (const [who, client] of [["proprietário de organização", owner], ["operador sem MFA (aal1)", aal1]]) {
  check(`${who}: não lê o estado da integração`, (await rpc(client, "platform_asaas_get_state", { p_environment: "sandbox" })).code === "42501");
  check(`${who}: não registra chave`, (await rpc(client, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: "$aact_hmlg_" + "q".repeat(40), p_account_fingerprint: "a".repeat(64), p_confirm_same_account: true })).code === "42501");
  check(`${who}: não gira o token`, (await rpc(client, "platform_asaas_rotate_webhook_token", { p_token: token(), p_grace_minutes: 0 })).code === "42501");
}
for (const [who, client] of [["usuário comum", owner], ["anônimo", anon], ["operador com MFA", operator]]) {
  const r = await rpc(client, "asaas_read_credentials");
  check(`${who}: NÃO consegue ler os segredos (função só do servidor)`, Boolean(r.code) && !r.data, `código ${r.code}`);
}

// 2) Chave: validar no Asaas, registrar, trocar de conta
const account = await (await fetch("https://api-sandbox.asaas.com/v3/myAccount/status", { headers: { access_token: key } })).json();
check("Asaas Sandbox aceita a chave (consulta somente de leitura)", Boolean(account.id));
const fp = fingerprint(account.id);
const state0 = (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data;
check("estado inicial lido pelo operador com MFA", state0 && typeof state0.key_configured === "boolean");
const noConfirm = state0.account_registered ? { code: "22023" } : await rpc(operator, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: key, p_account_fingerprint: fp, p_confirm_same_account: false });
check("conta ainda não registrada + registros existentes: exige confirmação", noConfirm.code === "22023", state0.account_registered ? "já registrada" : "sem confirmação recusado");
check("operador com MFA registra a chave real do Sandbox", (await rpc(operator, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: key, p_account_fingerprint: fp, p_confirm_same_account: true })).code === null);
const state1 = (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data;
check("estado: chave configurada, conectada e conta registrada", state1.key_configured && state1.key_status === "connected" && state1.account_registered && state1.environment === "sandbox");
check("estado NÃO contém a chave nem o token", !JSON.stringify(state1).includes(key) && !JSON.stringify(state1).includes(original) && !/aact_/.test(JSON.stringify(state1)));
check("registros financeiros existentes foram contados", state1.links.payments > 0 && state1.links.subscriptions > 0, `${state1.links.subscriptions} assinaturas / ${state1.links.payments} pagamentos`);
const swap = await rpc(operator, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: "$aact_hmlg_" + "z".repeat(40), p_account_fingerprint: fingerprint("outra_conta"), p_confirm_same_account: true });
check("troca para OUTRA conta Asaas com registros existentes: BLOQUEADA", swap.code === "22023" && /OUTRA conta/.test(swap.message));
check("... e a chave real continua sendo a ativa", (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data.key_status === "connected");
check("produção: chave de Sandbox é recusada", (await rpc(operator, "platform_asaas_save_key", { p_environment: "production", p_api_key: key, p_account_fingerprint: fp, p_confirm_same_account: true })).code === "22023");

// 3) Webhook: token do painel, rejeição, rotação com transição
check("painel: token do webhook = o já cadastrado no Asaas (sem transição)", (await rpc(operator, "platform_asaas_rotate_webhook_token", { p_token: original, p_grace_minutes: 0 })).code === null);
check("webhook: token do painel é aceito (200)", (await webhook(original)).status === 200);
check("webhook: token inválido é recusado (401)", (await webhook(token())).status === 401);
check("webhook: sem token é recusado (401)", (await webhook(null)).status === 401);
const n1 = token();
check("rotação com transição de 60 min", (await rpc(operator, "platform_asaas_rotate_webhook_token", { p_token: n1, p_grace_minutes: 60 })).code === null);
check("transição: token NOVO vale", (await webhook(n1)).status === 200);
check("transição: token ANTERIOR ainda vale (sem interromper eventos)", (await webhook(original)).status === 200);
check("transição: token desconhecido segue recusado", (await webhook(token())).status === 401);
check("estado mostra o token anterior em transição", (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data.previous_token_active === true);
check("operador encerra a transição", (await rpc(operator, "platform_asaas_revoke_previous_token")).code === null);
check("anterior revogado: 401", (await webhook(original)).status === 401);
check("atual segue valendo: 200", (await webhook(n1)).status === 200);
const n2 = token();
await rpc(operator, "platform_asaas_rotate_webhook_token", { p_token: n2, p_grace_minutes: 0 });
check("rotação sem transição: o token antigo cai na hora", (await webhook(n1)).status === 401 && (await webhook(n2)).status === 200);

// 4) A camada financeira usa a chave DO PAINEL (sem novo deploy)
const bad = "$aact_hmlg_" + crypto.randomBytes(20).toString("hex");
check("painel recebe uma chave inválida (mesma conta, só para a prova)", (await rpc(operator, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: bad, p_account_fingerprint: fp, p_confirm_same_account: false })).code === null);
const probe = await webhook(n2, "PAYMENT_UPDATED", paymentId);
check("evento aceito e gravado (200) mesmo com a chave do painel inválida", probe.status === 200);
await new Promise(resolve => setTimeout(resolve, 6000));
const adminState = (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data;
check("com a chave inválida do painel o processamento NÃO usa a variável de ambiente válida (evento fica pendente/falho)", adminState.events.failed + adminState.events.pending + adminState.events.needs_review >= 1, `falhas/pendentes: ${adminState.events.failed}/${adminState.events.pending}/${adminState.events.needs_review}`);
check("painel volta a receber a chave real (troca de chave vale sem deploy)", (await rpc(operator, "platform_asaas_save_key", { p_environment: "sandbox", p_api_key: key, p_account_fingerprint: fp, p_confirm_same_account: false })).code === null);
const cron = await fetch(`${base}/api/cron/billing`, { headers: { ...BYPASS, authorization: `Bearer ${e.CRON_SECRET}` } });
const cronBody = await cron.json().catch(() => ({}));
check("rotina financeira roda com as credenciais do painel (200)", cron.status === 200 && !cronBody.gateway, `eventos ${JSON.stringify(cronBody.events ?? {})}`);
console.log("eventos após o cron:", JSON.stringify((await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data.events));

// 5) Página do Super Admin
const page = async (client) => { const response = await fetch(`${base}/admin/integracoes/pagamentos`, { redirect: "manual", headers: { ...BYPASS, ...(client ? { cookie: await sessionCookie(client) } : {}) } }); return { status: response.status, text: await response.text() }; };
const adminPage = await page(operator);
check("página: operador com MFA vê a área (200)", adminPage.status === 200 && adminPage.text.includes("Integrações"));
check("página: mostra o endereço do webhook", adminPage.text.includes("/api/webhooks/asaas"));
check("página: nenhuma chave nem token no HTML", !adminPage.text.includes(key) && !adminPage.text.includes(original) && !adminPage.text.includes(n1) && !adminPage.text.includes(n2) && !/aact_hmlg_/.test(adminPage.text));
check("página: usuário comum não acessa (404)", (await page(owner)).status === 404);
check("página: sem sessão é redirecionado", [302, 303, 307, 308].includes((await page(null)).status));

// 6) Restauração: token ORIGINAL no painel (o webhook real do Asaas continua autenticando) e chave real ativa
check("restaura o token original no painel", (await rpc(operator, "platform_asaas_rotate_webhook_token", { p_token: original, p_grace_minutes: 0 })).code === null);
check("... o webhook real do Asaas volta a ser autenticado", (await webhook(original)).status === 200);
const final = (await rpc(operator, "platform_asaas_get_state", { p_environment: "sandbox" })).data;
check("estado final: Sandbox, chave real conectada, cobrança real desligada", final.environment === "sandbox" && final.key_status === "connected" && final.live_enabled === false);
finish();
