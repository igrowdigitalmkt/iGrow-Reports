-- Multi-platform ingestion foundation.
-- Workers are the only writers; authenticated users read confirmed snapshots through RLS.
create table if not exists public.integration_collection_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid not null,
  provider text not null,
  external_account_id text not null,
  date_from date not null,
  date_to date not null,
  entity_level text not null check (entity_level in ('account','campaign','adset','ad')),
  api_version text not null,
  contract_version integer not null default 1,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued','collecting','partial','confirmed','failed','superseded')),
  priority integer not null default 100,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from)
);

create index if not exists integration_collection_jobs_queue_idx
  on public.integration_collection_jobs(status, priority, next_attempt_at);
create index if not exists integration_collection_jobs_scope_idx
  on public.integration_collection_jobs(client_id, provider, external_account_id, date_from, date_to);

create table if not exists public.integration_raw_payloads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.integration_collection_jobs(id) on delete cascade,
  provider text not null,
  endpoint text not null,
  request_fingerprint text,
  response_payload jsonb not null,
  http_status integer,
  provider_updated_at timestamptz,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists integration_raw_payloads_job_idx
  on public.integration_raw_payloads(job_id, created_at);

create table if not exists public.integration_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.integration_collection_jobs(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  external_account_id text not null,
  date_from date not null,
  date_to date not null,
  entity_level text not null check (entity_level in ('account','campaign','adset','ad')),
  status text not null check (status in ('partial','confirmed','failed','superseded')),
  currency text,
  timezone_name text,
  attribution_window text,
  payload jsonb not null default '{}'::jsonb,
  reconciliation jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists integration_snapshots_read_idx
  on public.integration_snapshots(client_id, provider, external_account_id, date_from, date_to, entity_level, status, collected_at desc);

alter table public.integration_collection_jobs enable row level security;
alter table public.integration_raw_payloads enable row level security;
alter table public.integration_snapshots enable row level security;

revoke all on public.integration_collection_jobs, public.integration_raw_payloads from public, anon, authenticated;
revoke all on public.integration_snapshots from public, anon;
grant select on public.integration_snapshots to authenticated;
grant all on public.integration_collection_jobs, public.integration_raw_payloads, public.integration_snapshots to service_role;

create policy integration_snapshots_client_read on public.integration_snapshots
for select to authenticated
using (exists (
  select 1 from public.client_users cu
  where cu.client_id = integration_snapshots.client_id
    and cu.user_id = auth.uid()
    and cu.status = 'active'
));
