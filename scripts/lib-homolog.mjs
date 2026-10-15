/**
 * Utilidades dos testes contra o Supabase de HOMOLOGAÇÃO (nunca produção). Não imprime segredos.
 * Variáveis vêm de arquivos locais ignorados pelo Git: .env.homolog e .env.homolog-teste21.
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "qlopniyghvpbgwxuwxrl";

export function homologConfig() {
  const url = process.env.HOMOLOG_SUPABASE_URL;
  const key = process.env.HOMOLOG_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Faltam HOMOLOG_SUPABASE_URL / HOMOLOG_SUPABASE_PUBLISHABLE_KEY no .env.homolog.");
  if (url.includes(PRODUCTION_REF)) throw new Error("Este é o projeto de PRODUÇÃO. Abortado.");
  return { url, key };
}

export function newClient() {
  const { url, key } = homologConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signIn(email, password) {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Não foi possível entrar com ${email}: ${error.message}`);
  return client;
}

/** TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) para o autenticador de teste. */
export function totp(secretBase32, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

/** Sessão aal2 do operador de TESTE criado só para a homologação da etapa 2.1. */
export async function signInTestOperator() {
  const email = process.env.TESTE21_OPERATOR_EMAIL, password = process.env.TESTE21_OPERATOR_PASSWORD, secret = process.env.TESTE21_OPERATOR_TOTP;
  if (!email || !password || !secret) throw new Error("Rode antes scripts/homolog-commercial-setup.mjs (cria .env.homolog-teste21).");
  const client = await signIn(email, password);
  const { data: factors } = await client.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) throw new Error("Operador de teste sem autenticador.");
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
  if (error) throw new Error(`MFA do operador de teste falhou: ${error.message}`);
  return client;
}

export const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASSOU" : "FALHOU"} - ${name}${detail ? ` (${detail})` : ""}`);
}
export function finish() {
  const failed = results.filter((item) => !item.ok).length;
  console.log(failed ? `\n${failed} verificação(ões) FALHARAM de ${results.length}.` : `\nTodas as ${results.length} verificações passaram.`);
  process.exit(failed ? 1 : 0);
}

const HOMOLOG_REF = "xvjvfvinnnrgnhskglvd";

/** Cliente do servidor (chave secreta) SOMENTE do projeto de homologação. Recusa qualquer outro endereço. Não imprime a chave. */
export function adminClient() {
  const url = process.env.HOMOLOG_SUPABASE_URL;
  const key = process.env.HOMOLOG_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltam HOMOLOG_SUPABASE_URL e HOMOLOG_SUPABASE_SECRET_KEY (arquivo local .env.asaas-sandbox).");
  if (url.includes(PRODUCTION_REF) || !url.includes(HOMOLOG_REF)) throw new Error("O endereço não é o do projeto de HOMOLOGAÇÃO. Abortado.");
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString());
    if (payload.ref && payload.ref !== HOMOLOG_REF) throw new Error("A chave secreta é de outro projeto. Abortado.");
  } catch (error) { if (error instanceof Error && error.message.startsWith("A chave")) throw error; }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
