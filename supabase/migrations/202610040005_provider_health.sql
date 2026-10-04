create table if not exists public.integration_provider_health (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  provider text not null,
  status text not null default 'unknown' check (status in ('unknown','healthy','degraded','blocked')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  consecutive_failures integer not null default 0,
  avg_latency_ms integer,
  updated_at timestamptz not null default now(),
  unique (integration_id, provider)
);
create index if not exists integration_provider_health_status_idx
  on public.integration_provider_health(status, updated_at);
alter table public.integration_provider_health enable row level security;
revoke all on public.integration_provider_health from public, anon, authenticated;
grant all on public.integration_provider_health to service_role;
