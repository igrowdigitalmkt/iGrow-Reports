/** Run after `pnpm build`. Checks the production boundary without any real credentials. */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:3101";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3101"], {
  cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ENABLE_DEMO: "false", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", INTEGRATION_WORKER_SECRET: "", NEXT_TELEMETRY_DISABLED: "1" },
});
let output = "";
server.stdout.on("data", data => { output += data; });
server.stderr.on("data", data => { output += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try { ready = [200, 503].includes((await fetch(`${origin}/api/health`)).status); } catch { /* Server is starting. */ }
    if (ready) break;
    await delay(300);
  }
  assert.ok(ready, "Servidor de produção precisa responder.");
  assert.equal((await fetch(`${origin}/api/health`)).status, 503, "Sem credenciais, health deve informar configuração incompleta.");
  assert.equal((await fetch(`${origin}/demo`)).status, 404, "Demonstração desabilitada precisa retornar 404.");
  const protectedPage = await fetch(`${origin}/dashboard`, { redirect: "manual" });
  assert.equal(protectedPage.status, 307, "Dashboard exige contexto autenticado.");
  assert.equal(new URL(protectedPage.headers.get("location"), origin).pathname, "/entrar");
  assert.match(protectedPage.headers.get("cache-control"), /no-store/);
  for (const [path, method] of [["/api/workers/meta", "POST"], ["/api/workers/meta/health", "GET"]]) {
    const response = await fetch(`${origin}${path}`, { method });
    assert.equal(response.status, 503, "Executor sem configuração deve ficar indisponível.");
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await response.json(), { error: "Executor indisponível." });
  }
  for (const weight of ["Regular", "Bold"]) {
    const response = await fetch(`${origin}/fonts/NotoSans-${weight}.ttf`);
    assert.equal(response.status, 200, "Fontes locais do PDF precisam estar disponíveis.");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)], [0, 1, 0, 0], "Fonte deve conter um arquivo TrueType.");
  }
  console.log("Produção: demo bloqueada (404), painel protegido (307), resposta sem cache. Verificações aprovadas.");
} finally {
  server.kill();
}
