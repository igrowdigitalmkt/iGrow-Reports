/**
 * TESTE (não faz parte do produto): agendador TEMPORÁRIO e LOCAL que chama o cron financeiro da HOMOLOGAÇÃO a cada ~5 minutos, para provar a
 * recuperação AUTOMÁTICA por agendamento. Não é o agendamento permanente (esse fica na VPS, em outra etapa). Não toca em produção, na VPS, na
 * Evolution API nem em agendamentos existentes.
 * - Só chama https://i-grow-reports-homolog.vercel.app (recusa qualquer outro endereço).
 * - Identifica-se com User-Agent "igrow-homolog-scheduler/1" (uma chamada manual usa "igrow-homolog-manual/1"): os registros de requisição da
 *   Vercel diferenciam as duas origens.
 * - Trava contra execuções sobrepostas, tempo máximo por chamada e duração total limitada. O segredo nunca é impresso nem gravado no log.
 * - Log local (JSON por linha) em %TEMP%/igrow-homolog-cron.log: horário, HTTP e contadores, sem dados pessoais.
 * Uso: node scripts/homolog-cron-loop.mjs [--every=300] [--max-minutes=45] [--once] [--manual] [--dry]  (--dry só valida a configuração, sem chamar nada)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const env = Object.fromEntries(fs.readFileSync(".env.homolog-vercel", "utf8").split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim()]));
const base = env.HOMOLOG_APP_URL;
if (base !== "https://i-grow-reports-homolog.vercel.app") throw new Error("Endereço diferente do de homologação. Abortado.");
if (!env.CRON_SECRET || !env.HOMOLOG_BYPASS_SECRET) throw new Error("Faltam CRON_SECRET/HOMOLOG_BYPASS_SECRET em .env.homolog-vercel.");
const every = Math.max(60, Number(args.every ?? 300)) * 1000;
const deadline = Date.now() + Math.min(Number(args["max-minutes"] ?? 45), 120) * 60_000;
const agent = args.manual ? "igrow-homolog-manual/1" : "igrow-homolog-scheduler/1";
const logFile = path.join(os.tmpdir(), "igrow-homolog-cron.log");
const lockFile = path.join(os.tmpdir(), "igrow-homolog-cron.lock");

async function tick() {
  try { fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" }); }
  catch { fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), skipped: "execução anterior ainda em andamento" }) + "\n"); return; }
  const started = Date.now();
  let line;
  try {
    const response = await fetch(`${base}/api/cron/billing?x-vercel-protection-bypass=${env.HOMOLOG_BYPASS_SECRET}`, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, "user-agent": agent }, signal: AbortSignal.timeout(110_000),
    });
    const body = await response.json().catch(() => null);
    line = { at: new Date().toISOString(), origin: agent, http: response.status, ms: Date.now() - started, events: body?.events ?? null, reconciliation: body?.reconciliation ?? null, maintenance: body?.maintenance ?? null };
  } catch (error) {
    line = { at: new Date().toISOString(), origin: agent, http: 0, erro: error instanceof Error ? error.name : "falha", ms: Date.now() - started };
  } finally { fs.rmSync(lockFile, { force: true }); }
  fs.appendFileSync(logFile, JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line));
}

if (args.dry) { console.log(JSON.stringify({ dry: true, url: `${base}/api/cron/billing`, userAgent: agent, everySeconds: every / 1000, maxMinutes: Math.round((deadline - Date.now()) / 60000), logFile, lockFile, cronSecret: "presente (não impresso)", bypass: "presente (não impresso)" })); process.exit(0); }
fs.rmSync(lockFile, { force: true });
console.log(`Agendador temporário de HOMOLOGAÇÃO (${agent}); a cada ${every / 1000}s por até ${Math.round((deadline - Date.now()) / 60000)} min; log: ${logFile}`);
await tick();
while (!args.once && Date.now() + every < deadline) { await new Promise((resolve) => setTimeout(resolve, every)); await tick(); }
console.log("Agendador temporário encerrado.");
