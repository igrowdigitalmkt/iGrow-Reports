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
    create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
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
