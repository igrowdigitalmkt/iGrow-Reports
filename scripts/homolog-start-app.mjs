/**
 * Sobe o app local (build de produção, porta 3010) apontando SOMENTE para a homologação.
 * Motivo: `next build/start` lê .env.production.local, que no projeto aponta para a PRODUÇÃO (e tem chave privilegiada).
 * Este script lê a URL e a chave pública do .env.local, recusa qualquer projeto que não seja a homologação e
 * força variáveis vazias para as chaves privilegiadas, para que o arquivo de produção não seja usado.
 * Uso: node scripts/homolog-start-app.mjs [--sem-build]
 */
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const HOMOLOG_REF = "xvjvfvinnnrgnhskglvd";
const text = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (name) => (text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const url = read("NEXT_PUBLIC_SUPABASE_URL");
const key = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
if (new URL(url).host !== `${HOMOLOG_REF}.supabase.co`) { console.error("O .env.local não aponta para a homologação. Abortado."); process.exit(1); }
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEY: "" };
const run = (args) => spawnSync("pnpm", ["exec", "next", ...args], { stdio: "inherit", env, shell: true });
if (!process.argv.includes("--sem-build") && run(["build"]).status !== 0) process.exit(1);
console.log(`App de teste em http://127.0.0.1:3010 usando ${new URL(url).host}`);
spawn("pnpm", ["exec", "next", "start", "--hostname", "127.0.0.1", "-p", "3010"], { stdio: "inherit", env, shell: true });
