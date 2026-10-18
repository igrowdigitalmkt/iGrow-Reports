-- Groow Ads: motor executor Meta. Prepara persistencia e trilha de auditoria.
-- NAO ativa nenhum cron, endpoint, campanha ou escrita no provedor.
-- Escritas somente pelo servico (que checara usuario, vinculos e permissoes).
-- A leitura no cliente depende de RLS e da funcao private.agency_role.

create table public.agent_delegations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  granted_by uuid,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default false,
  allowed_actions text[] not null default '{}',
  max_account_daily_budget_minor bigint not null check (max_account_daily_budget_minor > 0 and max_account_daily_budget_minor <= 1000000000000),
  max_entity_daily_budget_minor bigint not null check (max_entity_daily_budget_minor > 0 and max_entity_daily_budget_minor <= 1000000000000),
  max_increase_minor_per_action bigint not null check (max_increase_minor_per_action > 0 and max_increase_minor_per_action <= 1000000000000),
  max_increase_percent_per_action smallint not null check (max_increase_percent_per_action between 0 and 100),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, client_id, ad_account_id),
  unique (agency_id, client_id, ad_account_id, id),
  check (cardinality(allowed_actions) between 1 and 6),
  check (allowed_actions <@ array[
    'pause_campaign','resume_campaign','pause_adset','resume_adset',
    'set_campaign_daily_budget','set_adset_daily_budget'
  ]::text[]),
  check (max_entity_daily_budget_minor <= max_account_daily_budget_minor),
  check (revoked_at is null or not enabled),
  check (not enabled or granted_by is not null),
  check (expires_at > created_at),
  foreign key (agency_id, client_id, ad_account_id)
    references public.client_ad_accounts(agency_id, client_id, ad_account_id) on delete restrict,
  constraint agent_delegations_granter_fkey foreign key (agency_id, granted_by)
    references public.agency_users(agency_id, user_id) on delete set null (granted_by)
);

create table public.agent_action_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  delegation_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  action_type text not null check (action_type in (
    'pause_campaign','resume_campaign','pause_adset','resume_adset',
    'set_campaign_daily_budget','set_adset_daily_budget'
  )),
  meta_entity_id text not null check (meta_entity_id ~ '^[1-9][0-9]*$'),
  daily_budget_minor bigint check (daily_budget_minor is null or daily_budget_minor between 1 and 1000000000000),
  facts_collected_at timestamptz not null,
  rationale text not null check (char_length(btrim(rationale)) between 10 and 2000),
  policy_version integer not null default 1 check (policy_version > 0),
  status text not null default 'proposed'
    check (status in ('proposed','authorized','queued','executing','verifying',
      'verified','rejected','expired','failed','needs_verification')),
  before_state jsonb,
  after_state jsonb,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 120),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z_]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  verified_at timestamptz,
  finished_at timestamptz,
  unique (agency_id, id),
  unique (agency_id, idempotency_key),
  check ((action_type like 'set_%_daily_budget') = (daily_budget_minor is not null)),
  foreign key (agency_id, client_id, ad_account_id, delegation_id)
    references public.agent_delegations(agency_id, client_id, ad_account_id, id)
    on delete restrict
);
create index agent_action_jobs_by_client_idx
  on public.agent_action_jobs(agency_id, client_id, created_at desc);

-- SOMENTE uma mutacao nao resolvida por conta. Isso evita duas alteracoes
-- financeiras simultaneas e o reenvio enquanto houver resultado desconhecido.
create unique index agent_action_jobs_one_unsettled_account_idx
  on public.agent_action_jobs(agency_id, ad_account_id)
  where status in ('queued','executing','verifying','needs_verification');

create table public.agent_action_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null,
  job_id uuid not null,
  previous_status text,
  next_status text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (agency_id, job_id)
    references public.agent_action_jobs(agency_id, id) on delete restrict
);
create index agent_action_events_job_idx
  on public.agent_action_events(agency_id, job_id, occurred_at, id);

create function private.agent_job_guard()
returns trigger language plpgsql set search_path = '' as $$
declare allowed boolean;
begin
  if tg_op = 'INSERT' and new.status <> 'proposed' then
    raise exception 'Agente: nova acao deve comecar como proposta' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' then
    if row(old.id,old.agency_id,old.client_id,old.ad_account_id,old.delegation_id,
      old.idempotency_key,old.action_type,old.meta_entity_id,old.daily_budget_minor,
      old.facts_collected_at,old.rationale,old.policy_version)
      is distinct from
      row(new.id,new.agency_id,new.client_id,new.ad_account_id,new.delegation_id,
      new.idempotency_key,new.action_type,new.meta_entity_id,new.daily_budget_minor,
      new.facts_collected_at,new.rationale,new.policy_version) then
      raise exception 'Agente: identidade e proposta sao imutaveis' using errcode='23514';
    end if;
    if old.status = new.status then
      if old.status in ('verified','failed','rejected','expired') then
        raise exception 'Agente: resultado terminal imutavel' using errcode='23514';
      end if;
    else
      allowed := case old.status
        when 'proposed' then new.status in ('authorized','rejected','expired')
        when 'authorized' then new.status in ('queued','rejected','expired')
        when 'queued' then new.status in ('executing','expired','rejected')
        when 'executing' then new.status in ('verifying','needs_verification','failed')
        when 'verifying' then new.status in ('verified','needs_verification','failed')
        when 'needs_verification' then new.status in ('verifying','verified','failed')
        else false
      end;
      if not allowed then
        raise exception 'Agente: transicao de status invalida' using errcode='23514';
      end if;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.status = 'queued' and old.status <> 'queued' then new.queued_at := now(); end if;
    if new.status = 'executing' and old.status <> 'executing' then new.started_at := now(); end if;
    if new.status = 'verified' and old.status <> 'verified' then new.verified_at := now(); end if;
    if new.status in ('verified','rejected','expired','failed') and old.status <> new.status then new.finished_at := now(); end if;
  end if;
  return new;
end;
$$;
create trigger agent_job_guard_trg
before insert or update on public.agent_action_jobs
for each row execute function private.agent_job_guard();

create function private.agent_record_status_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.agent_action_events(agency_id, job_id, previous_status, next_status)
    values(new.agency_id, new.id, null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.agent_action_events(agency_id, job_id, previous_status, next_status)
    values(new.agency_id, new.id, old.status, new.status);
  end if;
  return null;
end;
$$;
create trigger agent_job_status_audit_trg
after insert or update on public.agent_action_jobs
for each row execute function private.agent_record_status_event();

-- Claim CAS: duas workers nao adquirem a mesma acao. Somente service_role.
create function private.agent_claim_action(p_agency_id uuid, p_job_id uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.agent_action_jobs
  set status='executing'
  where agency_id=p_agency_id and id=p_job_id and status='queued';
  return found;
end;
$$;
revoke all on function private.agent_claim_action(uuid,uuid) from public, anon, authenticated;
grant execute on function private.agent_claim_action(uuid,uuid) to service_role;

alter table public.agent_delegations enable row level security;
alter table public.agent_action_jobs enable row level security;
alter table public.agent_action_events enable row level security;

revoke all on public.agent_delegations, public.agent_action_jobs, public.agent_action_events
  from public, anon, authenticated;
grant select on public.agent_delegations, public.agent_action_jobs, public.agent_action_events
  to authenticated;
grant all on public.agent_delegations, public.agent_action_jobs, public.agent_action_events
  to service_role;
grant usage, select on sequence public.agent_action_events_id_seq to service_role;

create policy agent_delegations_staff_read
on public.agent_delegations for select to authenticated
using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy agent_jobs_staff_read
on public.agent_action_jobs for select to authenticated
using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy agent_events_staff_read
on public.agent_action_events for select to authenticated
using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));

comment on table public.agent_delegations is
 'Delegacao de autonomia Meta. Sem endpoints de escrita ate homologacao.';
comment on table public.agent_action_jobs is
 'Ledger de propostas/execucoes Meta. No maximo uma acao nao reconciliada por conta.';
