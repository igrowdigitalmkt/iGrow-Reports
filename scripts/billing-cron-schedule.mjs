import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Agendamento do cron financeiro (/api/cron/billing) no QStash. PREPARADO, NUNCA EXECUTADO por padrão:
//  - sem argumentos: só mostra o plano (nenhuma rede, nenhum segredo);
//  - `--apply --confirm=<scheduleId>`: cria UM agendamento, depois das verificações de segurança abaixo.
// Um agendamento por ambiente (homologação/produção), com identificador, destino e CRON_SECRET próprios.
// Segredos só vão em CABEÇALHOS do agendamento (encaminhados pelo QStash e redigidos nos registros dele), nunca na URL.

const ENVIRONMENTS = ["homolog", "production"];

export function prepareBillingCronSchedule(env) {
  let origin;
  try {
    const url = new URL(env.BILLING_CRON_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.includes(".") || /^(localhost|127\.|0\.|\[)/.test(url.hostname)) throw Error();
    origin = url.origin;
  } catch { throw Error("BILLING_CRON_ORIGIN: informe a origem HTTPS pública do ambiente (sem caminho, parâmetros ou credenciais)."); }
  const environment = env.BILLING_CRON_ENVIRONMENT;
  if (!ENVIRONMENTS.includes(environment)) throw Error("BILLING_CRON_ENVIRONMENT: use homolog ou production.");
  let qstash;
  try {
    const url = new URL(env.QSTASH_URL || "https://qstash.upstash.io");
    if (url.protocol !== "https:" || !/^qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error();
    qstash = url.origin;
  } catch { throw Error("QSTASH_URL: use a origem HTTPS oficial do QStash."); }
  let failureCallback = null;
  if (env.BILLING_ALERT_CALLBACK_URL) {
    try {
      const url = new URL(env.BILLING_ALERT_CALLBACK_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error();
      failureCallback = url.origin + url.pathname;
    } catch { throw Error("BILLING_ALERT_CALLBACK_URL: use um endereço HTTPS sem credenciais, parâmetros ou fragmento."); }
  }
  return {
    environment, destination: `${origin}/api/cron/billing`, health: `${origin}/api/cron/billing/health`, qstash,
    scheduleId: `igrow-billing-${environment}-${createHash("sha256").update(origin).digest("hex").slice(0, 12)}`,
    cron: "*/5 * * * *", method: "GET", retries: 2, timeout: "110s", failureCallback,
    cronSecretConfigured: /^[A-Za-z0-9_-]{32,256}$/.test(env.CRON_SECRET || ""),
    qstashConfigured: Boolean(env.QSTASH_TOKEN && /^[\x21-\x7e]+$/.test(env.QSTASH_TOKEN)),
    // Ambientes protegidos pela Vercel precisam do bypass de automação (enviado em cabeçalho, nunca na URL).
    bypassConfigured: Boolean(env.VERCEL_BYPASS_SECRET && /^[A-Za-z0-9_-]{16,128}$/.test(env.VERCEL_BYPASS_SECRET)),
    messagesPerDay: Math.round((24 * 60) / 5),
  };
}

// Aplicação explícita. Ordem: credenciais → rota de saúde alcançável e autenticada → limites da conta → inexistência do agendamento → criação.
export async function applyBillingCronSchedule(env, confirmation, fetcher = fetch) {
  const plan = prepareBillingCronSchedule(env);
  if (confirmation !== plan.scheduleId) throw Error("Confirmação ausente ou diferente do identificador do agendamento.");
  if (!plan.cronSecretConfigured || !plan.qstashConfigured) throw Error("Configure CRON_SECRET e QSTASH_TOKEN antes de ativar.");
  if (plan.environment === "homolog" && !plan.bypassConfigured) throw Error("Homologação protegida pela Vercel: configure VERCEL_BYPASS_SECRET (enviado só em cabeçalho).");
  const call = async (url, options) => {
    try { return await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw Error("Falha de conexão; confira o destino e consulte o agendamento antes de tentar novamente."); }
  };
  const forwardHeaders = { Authorization: `Bearer ${env.CRON_SECRET}`, ...(plan.bypassConfigured ? { "x-vercel-protection-bypass": env.VERCEL_BYPASS_SECRET } : {}) };
  // A rota de saúde precisa responder autenticada (200 saudável ou 503 com marcas: "nunca executou" é esperado antes da primeira rodada).
  const health = await call(plan.health, { headers: forwardHeaders });
  let body;
  try { body = await health.json(); } catch { throw Error("A rota de saúde não respondeu JSON; confira o deploy e a proteção da Vercel."); }
  if (![200, 503].includes(health.status) || !(body && typeof body === "object" && ("ok" in body || "flags" in body))) throw Error(`Rota de saúde indisponível (HTTP ${health.status}); o cron não será agendado.`);
  const authorization = { Authorization: `Bearer ${env.QSTASH_TOKEN}` };
  const listed = await call(`${plan.qstash}/v2/schedules`, { headers: authorization });
  if (!listed.ok) throw Error(`Não foi possível conferir os agendamentos existentes (HTTP ${listed.status}).`);
  const existingSchedules = await listed.json().catch(() => null);
  if (!Array.isArray(existingSchedules)) throw Error("Lista de agendamentos inválida; nada foi criado.");
  if (existingSchedules.length >= 9) throw Error("A conta está no limite de agendamentos do plano (10); nada foi criado.");
  if (existingSchedules.some(item => item?.scheduleId === plan.scheduleId)) throw Error("O agendamento já existe. Confira-o no QStash; este comando não sobrescreve configurações existentes.");
  const headers = {
    ...authorization, "Content-Type": "application/json", "Upstash-Cron": plan.cron, "Upstash-Schedule-Id": plan.scheduleId, "Upstash-Method": plan.method,
    "Upstash-Retries": String(plan.retries), "Upstash-Timeout": plan.timeout, "Upstash-Forward-Authorization": forwardHeaders.Authorization,
    "Upstash-Redact-Fields": "header[Authorization],header[x-vercel-protection-bypass]",
  };
  if (plan.bypassConfigured) headers["Upstash-Forward-x-vercel-protection-bypass"] = env.VERCEL_BYPASS_SECRET;
  if (plan.failureCallback) headers["Upstash-Failure-Callback"] = plan.failureCallback;
  // O QStash exige o destino SEM codificação no caminho (codificado, recusa com "invalid scheme").
  const response = await call(`${plan.qstash}/v2/schedules/${plan.destination}`, { method: "POST", headers });
  if (!response.ok) throw Error(`QStash não confirmou a criação (HTTP ${response.status}).`);
  let result;
  try { result = await response.json(); } catch { throw Error("Resposta de criação inválida; confira o agendamento no QStash antes de repetir."); }
  if (result?.scheduleId !== plan.scheduleId) throw Error("Identidade do agendamento inesperada; confira o QStash antes de repetir.");
  return { scheduleId: plan.scheduleId, destination: plan.destination, cron: plan.cron, created: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const confirm = args.find(arg => arg.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";
    if (args.some(arg => arg !== "--apply" && !arg.startsWith("--confirm="))) throw Error("Use sem argumentos para revisar, ou --apply --confirm=<scheduleId> para ativar.");
    const result = apply ? await applyBillingCronSchedule(process.env, confirm) : prepareBillingCronSchedule(process.env);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Só mensagens controladas saem daqui; corpos de resposta nunca são impressos.
    console.error(error.message);
    process.exitCode = 1;
  }
}
