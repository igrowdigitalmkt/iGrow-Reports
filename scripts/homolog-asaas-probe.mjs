/**
 * TESTE (não faz parte do produto): LEITURA (somente GET) do Asaas SANDBOX para uma organização fictícia de teste: cliente, checkouts não
 * listáveis (o Asaas não permite), assinaturas (inclusive removidas) e cobranças (assinatura e avulsas do cliente). Não altera nada.
 * Não imprime chave nem dados pessoais.
 * Uso: node --env-file=.env.asaas-sandbox scripts/homolog-asaas-probe.mjs <letra da organização: b, d, e, f, g...>
 */
import fs from "node:fs";

const key = process.env.ASAAS_API_KEY;
if (process.env.ASAAS_ENVIRONMENT !== "sandbox" || !key || key.startsWith("$aact_prod_")) throw new Error("Somente Asaas Sandbox. Abortado.");
const letter = (process.argv[2] ?? "").toLowerCase();
const file = `.env.homolog-teste22${letter}`;
if (!/^[a-z]$/.test(letter) || !fs.existsSync(file)) throw new Error(`Arquivo ${file} não encontrado.`);
const orgId = fs.readFileSync(file, "utf8").match(/^TESTE22[A-Z]_ORG_ID=(.+)$/m)?.[1]?.trim();
const headers = { access_token: key, "user-agent": "igrow-reports-homolog" };
const get = async (path) => {
  const response = await fetch(`https://api-sandbox.asaas.com/v3${path}`, { headers });
  if (!response.ok) throw new Error(`Asaas GET ${path.split("?")[0]}: HTTP ${response.status}`);
  return response.json();
};
const customers = [];
for (let offset = 0; offset < 300; offset += 100) {
  const page = await get(`/customers?limit=100&offset=${offset}`);
  customers.push(...(page.data ?? []).filter((c) => c.externalReference === orgId));
  if (!page.hasMore) break;
}
console.log(`Organização ${letter.toUpperCase()}: ${customers.length} cliente(s) no Asaas: ${customers.map((c) => c.id).join(", ") || "nenhum"}`);
for (const customer of customers) {
  const subs = await get(`/subscriptions?customer=${customer.id}&includeDeleted=true&limit=100`);
  console.log("assinaturas:", JSON.stringify((subs.data ?? []).map((s) => ({ id: s.id, status: s.status, value: s.value, cycle: s.cycle, billingType: s.billingType, nextDueDate: s.nextDueDate, deleted: s.deleted, checkoutSession: s.checkoutSession?.slice(0, 8) }))));
  const pays = await get(`/payments?customer=${customer.id}&limit=100`);
  console.log("cobranças:", JSON.stringify((pays.data ?? []).map((p) => ({ id: p.id, status: p.status, value: p.value, billingType: p.billingType, dueDate: p.dueDate, confirmedDate: p.confirmedDate, subscription: p.subscription, checkoutSession: p.checkoutSession?.slice(0, 8) }))));
}
