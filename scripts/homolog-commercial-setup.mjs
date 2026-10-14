/**
 * Prepara o operador de TESTE da etapa 2.1 no Supabase de homologação (conta, senha e autenticador próprios).
 * Segredos ficam só em .env.homolog-teste21 (ignorado pelo Git) e nunca são impressos.
 *  parte1: gera a senha e imprime apenas o HASH bcrypt (calculado localmente com pgcrypto/PGlite). Com o hash,
 *          cria-se a conta e o operador por SQL em homologação (docs/COMERCIAL_CATALOGO.md).
 *  parte2: entra com a conta, cadastra e valida o autenticador TOTP de teste.
 * Uso: node --env-file=.env.homolog scripts/homolog-commercial-setup.mjs parte1|parte2
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signIn, totp } from "./lib-homolog.mjs";

const file = new URL("../.env.homolog-teste21", import.meta.url);
const email = "teste21-operador@exemplo.com";
const readEnv = () => Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));

if (process.argv[2] === "parte1") {
  if (fs.existsSync(file)) { console.error("Já existe .env.homolog-teste21; apague-o antes de repetir a parte 1."); process.exit(1); }
  const password = crypto.randomBytes(18).toString("base64url") + "aA1!";
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create extension pgcrypto");
  const { rows } = await db.query("select crypt($1, gen_salt('bf', 10)) as hash", [password]);
  fs.writeFileSync(file, `TESTE21_OPERATOR_EMAIL=${email}\nTESTE21_OPERATOR_PASSWORD=${password}\n`, { mode: 0o600 });
  console.log(`E-mail de teste: ${email}`);
  console.log(`HASH: ${rows[0].hash}`);
} else if (process.argv[2] === "parte2") {
  const env = readEnv();
  const client = await signIn(env.TESTE21_OPERATOR_EMAIL, env.TESTE21_OPERATOR_PASSWORD);
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "teste21-homologacao" });
  if (error || !data) { console.error(`Falha ao cadastrar o autenticador: ${error?.message}`); process.exit(1); }
  const verify = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verify.error) { console.error(`Falha ao validar o autenticador: ${verify.error.message}`); process.exit(1); }
  fs.appendFileSync(file, `TESTE21_OPERATOR_TOTP=${data.totp.secret}\n`);
  console.log("Autenticador de teste cadastrado e validado (aal2 disponível).");
} else console.error("Use: parte1 ou parte2");
