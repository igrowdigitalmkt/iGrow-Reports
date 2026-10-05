// Shared PGlite bootstrap for local analytics benchmarks: same Supabase doubles
// as supabase/tests/rls-smoke.mjs, then every migration in order.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export async function createAnalyticsBenchDb(root, { exclude = [] } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage; create schema extensions;
    grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
  `);
  const dir = resolve(root, "supabase/migrations");
  for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql") && !exclude.includes(name)).sort()) await db.exec(await readFile(resolve(dir, file), "utf8"));
  return db;
}
