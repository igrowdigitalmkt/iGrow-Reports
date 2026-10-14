/**
 * Verificação de segurança do Super Admin contra um projeto Supabase de HOMOLOGAÇÃO (nunca produção).
 * Uso: node --env-file=.env.homolog scripts/check-admin-homolog.mjs
 * Variáveis (arquivo .env.homolog, fora do Git): HOMOLOG_SUPABASE_URL, HOMOLOG_SUPABASE_PUBLISHABLE_KEY,
 * HOMOLOG_OPERATOR_EMAIL/PASSWORD (operador que JÁ concluiu o MFA pelo painel) e
 * HOMOLOG_USER_EMAIL/PASSWORD (usuário comum). Só imprime PASSOU/FALHOU; nunca valores secretos.
 */
import { createClient } from "@supabase/supabase-js";

const need = ["HOMOLOG_SUPABASE_URL", "HOMOLOG_SUPABASE_PUBLISHABLE_KEY", "HOMOLOG_OPERATOR_EMAIL", "HOMOLOG_OPERATOR_PASSWORD", "HOMOLOG_USER_EMAIL", "HOMOLOG_USER_PASSWORD"];
const missing = need.filter((key) => !process.env[key]);
if (missing.length) { console.error(`Faltam variáveis no .env.homolog: ${missing.join(", ")}`); process.exit(2); }
if (/qlopniyghvpbgwxuwxrl/.test(process.env.HOMOLOG_SUPABASE_URL)) { console.error("Este é o projeto de PRODUÇÃO. Abortado."); process.exit(2); }

let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "PASSOU" : "FALHOU"} - ${name}`); if (!ok) failures += 1; };
const open = async (email, password) => {
  const client = createClient(process.env.HOMOLOG_SUPABASE_URL, process.env.HOMOLOG_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Não foi possível entrar com ${email}.`);
  return client;
};

const user = await open(process.env.HOMOLOG_USER_EMAIL, process.env.HOMOLOG_USER_PASSWORD);
check("usuário comum: não é operador", (await user.rpc("platform_operator_status")).data === null);
check("usuário comum: não lê a auditoria", Boolean((await user.rpc("platform_recent_audit", { p_limit: 5 })).error));
check("usuário comum: não grava auditoria", Boolean((await user.rpc("platform_record_audit", { p_action: "admin.mfa_verified" })).error));
check("usuário comum: sem acesso direto às tabelas", Boolean((await user.schema("private").from("platform_operators").select("*")).error));

const operator = await open(process.env.HOMOLOG_OPERATOR_EMAIL, process.env.HOMOLOG_OPERATOR_PASSWORD);
const status = (await operator.rpc("platform_operator_status")).data;
check("operador só com senha: reconhecido com aal1", status?.role === "owner" && status?.aal === "aal1");
check("operador só com senha: não lê a auditoria", Boolean((await operator.rpc("platform_recent_audit", { p_limit: 5 })).error));
check("operador só com senha: não grava evento administrativo", Boolean((await operator.rpc("platform_record_audit", { p_action: "admin.alterou_plano" })).error));
const factors = await operator.auth.mfa.listFactors();
check("operador já tem autenticador validado (pré-requisito)", (factors.data?.totp.length ?? 0) > 0);
const enroll = await operator.auth.mfa.enroll({ factorType: "totp", friendlyName: "teste-bypass" });
check("operador só com senha: NÃO consegue cadastrar outro autenticador direto na API do Auth", Boolean(enroll.error));
if (enroll.data?.id) await operator.auth.mfa.unenroll({ factorId: enroll.data.id }); // limpeza, caso o Auth tenha permitido

console.log(failures ? `\n${failures} verificação(ões) FALHARAM.` : "\nTodas as verificações passaram.");
process.exit(failures ? 1 : 0);
