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
  const migrationsDir = resolve(root, "supabase/migrations");
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(resolve(migrationsDir, file), "utf8"));
    console.log(`Migration aplicada em PGlite: ${file}`);
  }
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
