/**
 * TESTE (não faz parte do produto): chamadas HTTP REAIS à aplicação de HOMOLOGAÇÃO com a sessão do proprietário de uma organização
 * FICTÍCIA, para provar que as operações pagas são barradas no servidor quando o acesso está restrito e que a leitura continua.
 * Nada externo acontece: as organizações não têm WhatsApp/Meta/Google conectados e o ambiente não tem credenciais de provedores; quando a
 * operação é liberada ela falha DENTRO do app (sem conexão), nunca no provedor. Não imprime segredos nem corpos de resposta.
 * Uso: node --env-file=.env.homolog --env-file=.env.homolog-vercel --env-file=.env.homolog-teste22<letra> scripts/check-billing-restrictions-http-homolog.mjs <letra> <allowed|blocked> <clientId> [<clientIdDeOutraOrganização>]
 */
import crypto from "node:crypto";

const [letter, expectation, clientId, otherClientId] = process.argv.slice(2);
if (!/^[a-z]$/.test(letter ?? "") || !["allowed", "blocked"].includes(expectation) || !/^[0-9a-f-]{36}$/.test(clientId ?? "")) throw new Error("Uso: <letra> <allowed|blocked> <clientId> [<outroClientId>]");
const K = `TESTE22${letter.toUpperCase()}`;
const e = process.env;
const base = e.HOMOLOG_APP_URL;
if (!base?.includes("i-grow-reports-homolog") || !e.HOMOLOG_SUPABASE_URL?.includes("xvjvfvinnnrgnhskglvd")) throw new Error("Somente a homologação.");
const login = await (await fetch(`${e.HOMOLOG_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: e.HOMOLOG_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: e[`${K}_OWNER_EMAIL`], password: e[`${K}_OWNER_PASSWORD`] }) })).json();
if (!login.access_token) throw new Error("Login do proprietário fictício falhou.");
const value = "base64-" + Buffer.from(JSON.stringify(login)).toString("base64url");
const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180));
const cookie = parts.length === 1 ? `igrow-auth=${value}` : parts.map((part, index) => `igrow-auth.${index}=${part}`).join("; ");
const headers = (extra = {}) => ({ cookie, "x-vercel-protection-bypass": e.HOMOLOG_BYPASS_SECRET, ...extra });
const call = async (method, path, init = {}) => {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", ...init, headers: headers(init.headers) });
  let code = null;
  if ((response.headers.get("content-type") ?? "").includes("json")) { try { code = (await response.json())?.code ?? null; } catch { /* corpo não JSON */ } } else await response.arrayBuffer().catch(() => null);
  return { status: response.status, code };
};
const pdf = () => { const form = new FormData(); form.set("clientId", clientId); form.set("reportVersionId", crypto.randomUUID()); form.append("recipientIds", crypto.randomUUID()); form.set("period", "Setembro de 2026"); form.set("filename", "relatorio.pdf"); form.set("file", new Blob(["%PDF-1.4 teste"], { type: "application/pdf" }), "relatorio.pdf"); return form; };
const results = [];
const blockedExpected = expectation === "blocked";
const paid = async (label, run) => { const r = await run(); const blocked = r.status === 403 && r.code === "billing_restricted"; results.push({ label, kind: "paga", ...r, ok: blockedExpected ? blocked : !blocked && r.code !== "billing_unverified" }); };
const read = async (label, method, path) => { const r = await call(method, path); results.push({ label, kind: "leitura", ...r, ok: r.status === 200 }); };

await paid("WhatsApp: nova conversa (envio manual)", () => call("POST", "/api/whatsapp/inbox/new", { headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "86999999999", text: "Teste de bloqueio: nenhum envio real" }) }));
await paid("WhatsApp: relatório em PDF", () => call("POST", "/api/whatsapp/send", { body: pdf() }));
await paid("Meta ao vivo: saldo das contas", () => call("GET", `/api/clientes/${clientId}/billing`));
await paid("Meta ao vivo: audiência", () => call("GET", `/api/clientes/${clientId}/audiencia?from=2026-09-01&to=2026-09-30`));
await read("Leitura: lista de conversas", "GET", "/api/whatsapp/inbox");
await read("Leitura: área de assinatura", "GET", "/dashboard/assinatura");
await read("Leitura: painel do cliente (histórico)", "GET", `/dashboard/clientes/${clientId}`);
await read("Leitura: visão geral", "GET", "/dashboard");
if (otherClientId) {
  const r = await call("GET", `/api/clientes/${otherClientId}/billing`);
  results.push({ label: "Isolamento: cliente de OUTRA organização", kind: "isolamento", ...r, ok: r.status !== 200 && r.code !== "billing_restricted" ? true : r.status !== 200 });
}
for (const r of results) console.log(`${r.ok ? "OK  " : "FALHA"} [${r.kind}] ${r.label}: HTTP ${r.status}${r.code ? ` code=${r.code}` : ""}`);
const failed = results.filter(r => !r.ok).length;
console.log(`${letter.toUpperCase()} esperado=${expectation}: ${results.length - failed}/${results.length} conforme o esperado`);
process.exitCode = failed ? 1 : 0;
