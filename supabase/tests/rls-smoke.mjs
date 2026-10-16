/**
 * Executes the REAL migrations and pgTAP suite in PostgreSQL WASM.
 * Only Supabase-owned auth/storage tables and auth.uid() are minimal test doubles.
 * This checks SQL/RLS but is not a replacement for Supabase HTTP and concurrency tests.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite-pgtap";
import assert from "node:assert/strict";
import { verifySnapshotRollout } from "./snapshot-rollout.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const db = new PGlite({ extensions: { pgtap } });
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create schema extensions;
    grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}', last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    -- Supabase's auth.jwt(): the claims of the verified token (tests set request.jwt.claims, e.g. aal).
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
    $$;
    -- Supabase reads the role from the JWT; in tests the session role stands in for it.
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('role',true),'none'), current_user::text);
    $$;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    -- Supabase Vault (extensão da Supabase): dublê mínimo com a mesma interface. A criptografia em repouso NÃO é exercitada aqui (validada no Postgres real da homologação).
    -- Como no Supabase, nenhum papel da API tem acesso ao schema vault; só as funções SECURITY DEFINER do projeto o consultam.
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
      insert into vault.secrets(secret, name, description) values (new_secret, new_name, coalesce(new_description, '')) returning id;
    $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$
      update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id;
    $$;
    create extension pgtap with schema extensions;
  `);
  const preflight = await readFile(resolve(root,"supabase/diagnostics/snapshot-readiness.sql"),"utf8");
  const uninstalled = await db.query(preflight);
  assert.ok(uninstalled.rows.length>0 && uninstalled.rows.every(row => !row.ready && !row.schema_ready),"Diagnóstico deve funcionar antes da instalação da estrutura.");
  const migrationsDir = resolve(root, "supabase/migrations");
  const rolloutMode = process.argv.includes("--snapshot-rollout");
  let rolledOut = false;
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    if (rolloutMode && file.startsWith("2026100400")) {
      if (!rolledOut) { await verifySnapshotRollout(db,root); rolledOut = true; }
      continue;
    }
    await db.exec(await readFile(resolve(migrationsDir, file), "utf8"));
    console.log(`Migration aplicada em PGlite: ${file}`);
  }
  const ready = await db.query(preflight);
  assert.ok(ready.rows.length>0,"Diagnóstico deve conferir requisitos reais.");
  assert.deepEqual(ready.rows.filter(row => !row.ready),[],"Schema atualizado deve satisfazer o diagnóstico.");
  await db.exec("begin; drop function public.list_client_snapshot_accounts(uuid);");
  const missingCatalog = await db.query(preflight);
  assert.ok(missingCatalog.rows.some(row => row.kind==="function" && row.object_name==="public.list_client_snapshot_accounts(uuid)" && !row.ready));
  assert.ok(missingCatalog.rows.every(row => !row.schema_ready));
  await db.exec("rollback; begin; grant execute on function public.request_meta_collection_refresh(uuid,uuid,date,date,text,integer,jsonb) to authenticated;");
  const unsafeGrant = await db.query(preflight);
  assert.ok(unsafeGrant.rows.some(row => row.kind==="access" && row.object_name.startsWith("public.request_meta_collection_refresh") && !row.ready));
  await db.exec("rollback; begin; alter table public.integration_snapshots disable row level security;");
  const unsafeTable = await db.query(preflight);
  assert.ok(unsafeTable.rows.some(row => row.kind==="rls" && row.object_name==="public.integration_snapshots" && !row.ready));
  await db.exec("rollback;");
  console.log("Diagnóstico de snapshots aprovado: schema completo, função ausente, grant indevido e RLS desabilitado.");
  const results = [];
  for (const file of (await readdir(resolve(root, "supabase/tests"))).filter(name => name.endsWith(".test.sql")).sort()) {
    try {
      results.push(...await db.exec(await readFile(resolve(root, "supabase/tests", file), "utf8")));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : error}`, { cause: error });
    }
  }
  const lines = results.flatMap(({ rows }) => rows.flatMap((row) => Object.values(row)))
    .filter((value) => typeof value === "string" && /^(ok |not ok |1\.\.|#)/m.test(value));
  for (const line of lines) console.log(line);
  const failed = lines.some((line) => /^(not ok |# Looks like)/m.test(line));
  if (failed || !lines.some((line) => /^1\.\./m.test(line))) process.exitCode = 1;
  else console.log("SQL/RLS/pgTAP passaram em PGlite; Supabase real e concorrência ainda exigem homologação.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
}
