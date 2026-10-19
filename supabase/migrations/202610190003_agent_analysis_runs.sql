-- Historico das analises do motor de decisao da IA (resumo e observacoes ja validados no servidor).
-- Somente leitura para a equipe da organizacao; escrita exclusiva do servico. Aditiva: nao altera tabelas existentes.
create table public.agent_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  origin text not null check (origin in ('manual', 'scheduled')),
  requested_by uuid,
  summary text not null check (char_length(summary) between 1 and 2000),
  -- [{ "name": text, "level": "campaign"|"adset", "rationale": text }], texto ja conferido pelo validador.
  observations jsonb not null default '[]'::jsonb check (jsonb_typeof(observations) = 'array'),
  proposals integer not null default 0 check (proposals >= 0),
  blocked integer not null default 0 check (blocked >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  rejected_reasons text[] not null default '{}',
  facts_hash text check (facts_hash is null or char_length(facts_hash) <= 64),
  created_at timestamptz not null default now(),
  foreign key (agency_id, client_id, ad_account_id)
    references public.client_ad_accounts(agency_id, client_id, ad_account_id) on delete cascade
);
create index agent_analysis_runs_recent_idx on public.agent_analysis_runs(agency_id, client_id, created_at desc);

alter table public.agent_analysis_runs enable row level security;
revoke all on public.agent_analysis_runs from public, anon, authenticated;
grant select on public.agent_analysis_runs to authenticated;
grant all on public.agent_analysis_runs to service_role;

create policy agent_analysis_runs_staff_read
on public.agent_analysis_runs for select to authenticated
using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));

comment on table public.agent_analysis_runs is
 'Analises da IA (motor de decisao). Texto validado no servidor; escrita somente por service_role.';
