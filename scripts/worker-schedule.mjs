import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function prepareWorkerSchedule(env) {
  let origin;
  try {
    const url = new URL(env.NEXT_PUBLIC_APP_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.includes(".") || /^(localhost|127\.|0\.|\[)/.test(url.hostname)) throw Error();
    origin = url.origin;
  } catch { throw Error("NEXT_PUBLIC_APP_URL: informe a origem HTTPS pública da aplicação."); }
  let qstash;
  try {
    const url = new URL(env.QSTASH_URL || "https://qstash.upstash.io");
    if (url.protocol !== "https:" || !/^qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error();
    qstash = url.origin;
  } catch { throw Error("QSTASH_URL: use a origem HTTPS oficial do QStash."); }
  const workerConfigured = /^[A-Za-z0-9_-]{32,256}$/.test(env.INTEGRATION_WORKER_SECRET || "");
  const qstashConfigured = Boolean(env.QSTASH_TOKEN && /^[\x21-\x7e]+$/.test(env.QSTASH_TOKEN));
  return {
    destination: `${origin}/api/workers/meta`, health: `${origin}/api/workers/meta/health`,
    qstash, scheduleId: `igrow-meta-${createHash("sha256").update(origin).digest("hex").slice(0, 16)}`,
    cron: "*/15 * * * *", method: "POST", retries: 0,
    workerConfigured, qstashConfigured,
  };
}

// Explicit application only. A preview never reads the network or returns tokens.
export async function applyWorkerSchedule(env, fetcher = fetch) {
  const plan = prepareWorkerSchedule(env);
  if (!plan.workerConfigured || !plan.qstashConfigured) throw Error("Configure INTEGRATION_WORKER_SECRET e QSTASH_TOKEN antes de ativar.");
  const call = async (url, options) => {
    try { return await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw Error("Falha de conexão na ativação; confira o destino e consulte o agendamento antes de tentar novamente."); }
  };
  const health = await call(plan.health, { headers: { Authorization: `Bearer ${env.INTEGRATION_WORKER_SECRET}` } });
  if (!health.ok) throw Error(`Executor ainda não está disponível (HTTP ${health.status}).`);
  let readiness;
  try { readiness = await health.json(); } catch { throw Error("Resposta de verificação do executor inválida."); }
  if (readiness?.ready !== true || !["meta", "encryption", "database"].every(key => readiness.checks?.[key] === true)) throw Error("Dependências do executor ainda não foram confirmadas.");
  const authorization = { Authorization: `Bearer ${env.QSTASH_TOKEN}` };
  const existing = await call(`${plan.qstash}/v2/schedules/${plan.scheduleId}`, { headers: authorization });
  if (existing.ok) throw Error("O agendamento já existe. Confira-o no QStash; este comando não sobrescreve configurações existentes.");
  if (existing.status !== 404) throw Error(`Não foi possível conferir agendamento existente (HTTP ${existing.status}).`);
  const response = await call(`${plan.qstash}/v2/schedules/${encodeURIComponent(plan.destination)}`, {
    method: "POST", headers: {
      ...authorization, "Content-Type": "application/json", "Upstash-Cron": plan.cron,
      "Upstash-Schedule-Id": plan.scheduleId, "Upstash-Method": plan.method,
      "Upstash-Retries": "0", "Upstash-Forward-Authorization": `Bearer ${env.INTEGRATION_WORKER_SECRET}`,
      "Upstash-Redact-Fields": "header[Authorization]",
    }, body: "{}",
  });
  if (!response.ok) throw Error(`QStash não confirmou a criação (HTTP ${response.status}).`);
  let result;
  try { result = await response.json(); } catch { throw Error("Resposta de criação inválida; confira o agendamento no QStash antes de repetir."); }
  if (result?.scheduleId !== plan.scheduleId) throw Error("Identidade do agendamento inesperada; confira o QStash antes de repetir.");
  return { scheduleId: plan.scheduleId, destination: plan.destination, cron: plan.cron, created: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--apply") || args.length > 1) throw Error("Use sem argumentos para revisar, ou --apply para ativar.");
    const result = args.includes("--apply") ? await applyWorkerSchedule(process.env) : prepareWorkerSchedule(process.env);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Only controlled messages escape this module; response bodies are never printed.
    console.error(error.message);
    process.exitCode = 1;
  }
}
