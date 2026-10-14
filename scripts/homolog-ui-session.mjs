/**
 * Abre uma sessão do OPERADOR DE TESTE (com MFA já validado) no navegador local, sem digitar senha e sem expor tokens:
 * um servidorzinho em 127.0.0.1:3011 faz o login por script e entrega o cookie de sessão em /entrar-teste.
 * Só homologação. Uso: node --env-file=.env.homolog --env-file=.env.homolog-teste21 scripts/homolog-ui-session.mjs
 */
import http from "node:http";
import { signInTestOperator } from "./lib-homolog.mjs";

const APP = process.env.APP_ORIGIN ?? "http://127.0.0.1:3010";
http.createServer(async (req, res) => {
  if (req.url !== "/entrar-teste") { res.writeHead(404); res.end(); return; }
  try {
    const client = await signInTestOperator();
    const { data } = await client.auth.getSession();
    // Mesmo formato do @supabase/ssr: base64url com prefixo, em pedaços de até 3180 caracteres (limite de cookie do navegador).
    const { id, email, aud, role, app_metadata, user_metadata } = data.session.user;
    const value = "base64-" + Buffer.from(JSON.stringify({ ...data.session, user: { id, email, aud, role, app_metadata, user_metadata } })).toString("base64url");
    const chunks = value.match(/.{1,3180}/g);
    const cookies = chunks.length === 1 ? [`igrow-auth=${value}`] : chunks.map((chunk, index) => `igrow-auth.${index}=${chunk}`);
    res.writeHead(302, { Location: `${APP}/admin`, "Set-Cookie": cookies.map((cookie) => `${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3000`) });
    res.end();
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Falha ao abrir a sessão de teste: ${error.message}`);
  }
}).listen(3011, "127.0.0.1", () => console.log("Sessão de teste disponível em http://127.0.0.1:3011/entrar-teste"));
