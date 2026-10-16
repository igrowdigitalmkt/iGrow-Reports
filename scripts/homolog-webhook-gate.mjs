/**
 * TESTE (não faz parte do produto): interruptor REVERSÍVEL da entrega de webhooks do Asaas SANDBOX para o teste de recuperação sem webhook.
 * Estratégia: troca SÓ o token de autenticação do webhook por um valor descartável. O iGrow recusa as entregas (401, antes de gravar qualquer
 * coisa), o Asaas as retém e reenvia depois que o token original é restaurado (a fila só é interrompida após 15 falhas seguidas e retém os
 * eventos por até 14 dias). Nada é apagado, o webhook continua habilitado e a URL não muda.
 *
 * SEGURANÇA DA RESTAURAÇÃO (independente da sessão do Claude): `block` inicia um VIGIA destacado (processo separado) que restaura o token
 * original quando (a) o prazo (padrão 40 min) vence, (b) a fila do Asaas aparece como interrompida ou o webhook desabilitado, ou (c) alguém pede
 * `restore`. O vigia grava o que faz em %TEMP%/igrow-webhook-watchdog.log (sem segredos).
 *
 * Comandos (nenhum imprime o token):
 *   status     lê o estado atual (somente leitura)
 *   snapshot   grava o estado atual em .env.homolog-webhook-state (somente leitura no Asaas)
 *   block      [--minutes=40] exige snapshot recente; troca o token por um valor descartável e inicia o vigia
 *   restore    restaura o token original (de ASAAS_WEBHOOK_TOKEN em .env.asaas-sandbox), reativa a fila e encerra o vigia
 *   selftest   [--seconds=40] valida o vigia SEM bloquear nada: inicia um vigia curto sobre o estado atual (restauração idempotente)
 * Uso: node --env-file=.env.asaas-sandbox scripts/homolog-webhook-gate.mjs <comando>
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api-sandbox.asaas.com/v3";
const NAME = "iGrow Reports — Homologação";
const STATE = ".env.homolog-webhook-state";
const LOG = path.join(os.tmpdir(), "igrow-webhook-watchdog.log");
const CANCEL = path.join(os.tmpdir(), "igrow-webhook-watchdog.cancel");
const key = process.env.ASAAS_API_KEY;
const original = process.env.ASAAS_WEBHOOK_TOKEN;
if (process.env.ASAAS_ENVIRONMENT !== "sandbox" || !key || key.startsWith("$aact_prod_")) throw new Error("Somente Asaas Sandbox. Abortado.");
const headers = { access_token: key, "content-type": "application/json", "user-agent": "igrow-reports-homolog" };
const call = async (method, path_, body) => {
  const response = await fetch(`${API}${path_}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Asaas ${method} ${path_}: HTTP ${response.status}`);
  return json;
};
async function current() {
  const list = await call("GET", "/webhooks");
  const matches = (list.data ?? []).filter((item) => item.name === NAME);
  if (matches.length !== 1) throw new Error(`Esperava exatamente 1 webhook "${NAME}" e encontrei ${matches.length}. Abortado.`);
  return matches[0];
}
const view = (w) => ({ id: w.id, enabled: w.enabled, interrupted: w.interrupted, sendType: w.sendType, apiVersion: w.apiVersion, eventos: w.events?.length, url: String(w.url).replace(/\?.*/, "?<oculto>"), temToken: Boolean(w.hasAuthToken) });
const log = (message) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`);
const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? Number(hit.split("=")[1]) : fallback; };
const requireOriginal = () => { if (!original || original.length < 32) throw new Error("ASAAS_WEBHOOK_TOKEN ausente em .env.asaas-sandbox: sem ele não há como restaurar. Abortado."); };
const readState = () => (fs.existsSync(STATE) ? Object.fromEntries(fs.readFileSync(STATE, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)])) : null);
const writeState = (patch) => { const s = { ...(readState() ?? {}), ...patch }; fs.writeFileSync(STATE, `# Estado do webhook (local, ignorado pelo Git)\n${Object.entries(s).map(([k, v]) => `${k}=${v}`).join("\n")}\n`); };

async function restore(reason) {
  requireOriginal();
  const w = await current();
  await call("PUT", `/webhooks/${w.id}`, { authToken: original, enabled: true, interrupted: false });
  const after = await current();
  writeState({ RESTORED_AT: new Date().toISOString(), RESTORE_REASON: reason });
  log(`restaurado (${reason}): enabled=${after.enabled} interrupted=${after.interrupted}`);
  return after;
}

async function watchdog(deadlineMs, label) {
  log(`vigia (${label}) iniciado; prazo ${new Date(deadlineMs).toISOString()}`);
  while (true) {
    if (fs.existsSync(CANCEL)) { log("vigia: cancelado por restore manual"); fs.rmSync(CANCEL, { force: true }); return; }
    try {
      const w = await current();
      if (w.interrupted || !w.enabled) { await restore("fila interrompida ou webhook desabilitado"); return; }
      if (Date.now() >= deadlineMs) { await restore("prazo do bloqueio vencido"); return; }
    } catch (error) {
      log(`vigia: erro ${error instanceof Error ? error.message : "desconhecido"}`);
      if (Date.now() >= deadlineMs) { try { await restore("prazo vencido (após erro)"); return; } catch { /* tenta de novo no próximo ciclo */ } }
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}
function startWatchdog(mode, value) {
  fs.rmSync(CANCEL, { force: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "watchdog-run", mode, String(value)], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
  child.unref();
  return child.pid;
}

const command = process.argv[2];
if (command === "status") { console.log(JSON.stringify(view(await current()), null, 1)); process.exit(0); }
if (command === "snapshot") {
  const w = await current();
  writeState({ SNAPSHOT_AT: new Date().toISOString(), WEBHOOK_ID: w.id, ENABLED: w.enabled, INTERRUPTED: w.interrupted, SEND_TYPE: w.sendType, EVENTS: w.events.length });
  console.log("Estado gravado:", JSON.stringify(view(w)));
  process.exit(0);
}
if (command === "watchdog-run") { await watchdog(process.argv[3] === "until" ? Number(process.argv[4]) : Date.now() + Number(process.argv[4]) * 1000, process.argv[3]); process.exit(0); }
requireOriginal();
if (command === "block") {
  const saved = readState();
  const w = await current();
  if (!saved || saved.WEBHOOK_ID !== w.id || Date.now() - Date.parse(saved.SNAPSHOT_AT) > 60 * 60 * 1000) throw new Error("Rode `snapshot` antes (válido por 1 hora). Abortado.");
  if (!w.enabled || w.interrupted) throw new Error("O webhook não está saudável (desabilitado ou interrompido). Abortado.");
  const minutes = Math.min(arg("minutes", 40), 60);
  const until = Date.now() + minutes * 60_000;
  // O vigia é iniciado ANTES de trocar o token: se o processo morrer logo depois, a restauração já está garantida.
  const pid = startWatchdog("until", until);
  await call("PUT", `/webhooks/${w.id}`, { authToken: crypto.randomBytes(30).toString("base64url") });
  writeState({ BLOCKED_AT: new Date().toISOString(), BLOCK_DEADLINE: new Date(until).toISOString(), WATCHDOG_PID: pid, RESTORED_AT: "" });
  console.log(`BLOQUEADO às ${new Date().toISOString()}. Vigia (pid ${pid}) restaura sozinho até ${new Date(until).toISOString()}. Estado:`, JSON.stringify(view(await current())));
  process.exit(0);
}
if (command === "restore") {
  fs.writeFileSync(CANCEL, "cancel");
  const after = await restore("restore manual");
  console.log("RESTAURADO: token original e fila ativa. Estado:", JSON.stringify(view(after)));
  process.exit(0);
}
if (command === "selftest") {
  const seconds = arg("seconds", 40);
  const pid = startWatchdog("for", seconds);
  console.log(`Vigia de teste (pid ${pid}) iniciado por ${seconds}s sobre o estado atual; ao vencer fará uma restauração IDEMPOTENTE (mesmos valores). Log: ${LOG}`);
  process.exit(0);
}
throw new Error("Comando inválido. Use: status | snapshot | block | restore | selftest");
