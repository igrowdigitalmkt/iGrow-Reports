-- Camada de IA: configuração por organização e por cliente e registro de uso (custo e cota).
-- Só o servidor grava o uso (service_role). Ausência de configuração significa os padrões
-- (IA ligada, orçamento mensal de US$ 5,00). O registro não guarda texto de prompt nem de resposta.

create table public.ai_settings (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  enabled boolean not null default true,
  monthly_budget_usd numeric(10,2) not null default 5.00
    check (monthly_budget_usd >= 0 and monthly_budget_usd <= 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.ai_client_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index ai_client_settings_agency_idx on public.ai_client_settings(agency_id);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  feature text not null check (feature in ('report_comment')),
  model text not null check (char_length(model) between 1 and 80),
  status text not null check (status in ('ok','blocked_disabled','blocked_budget','rejected_numbers','error')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  verifier_passed boolean,
  facts_hash text check (char_length(facts_hash) <= 80),
  source_ref text check (char_length(source_ref) <= 120),
  request_id text check (char_length(request_id) <= 120),
  created_at timestamptz not null default now()
);
create index ai_usage_agency_created_idx on public.ai_usage(agency_id, created_at desc);
create index ai_usage_client_created_idx on public.ai_usage(client_id, created_at desc) where client_id is not null;

alter table public.ai_settings enable row level security;
alter table public.ai_client_settings enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_settings, public.ai_client_settings, public.ai_usage from public, anon, authenticated;
grant select, insert, update on public.ai_settings, public.ai_client_settings to authenticated;
grant select on public.ai_usage to authenticated;
grant all on public.ai_settings, public.ai_client_settings, public.ai_usage to service_role;

create policy ai_settings_read on public.ai_settings for select to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));

create policy ai_client_settings_read on public.ai_client_settings for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy ai_client_settings_insert on public.ai_client_settings for insert to authenticated
  with check (
    private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[])
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = ai_client_settings.agency_id)
  );
create policy ai_client_settings_update on public.ai_client_settings for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (
    private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[])
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = ai_client_settings.agency_id)
  );

create policy ai_usage_read on public.ai_usage for select to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));

-- Gasto do mês corrente (UTC) em dólares, para a cota. Administradores da organização e o servidor.
create function public.ai_month_cost(p_agency_id uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not private.has_agency_role(p_agency_id, array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((
    select sum(u.cost_usd) from public.ai_usage u
    where u.agency_id = p_agency_id and u.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  ), 0);
end;
$$;
revoke all on function public.ai_month_cost(uuid) from public, anon;
grant execute on function public.ai_month_cost(uuid) to authenticated, service_role;
