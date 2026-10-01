-- Meta Ads and metrics foundation.
-- External IDs stay as text. Raw provider secrets do not live in public tables.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  provider text not null check (provider in ('meta','whatsapp','qstash')),
  connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected','connected','error')),
  health_status text not null default 'unknown'
    check (health_status in ('unknown','healthy','degraded','error')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, provider),
  unique (agency_id, id),
  constraint integrations_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);

create table private.integration_secrets (
  agency_id uuid not null,
  integration_id uuid not null,
  secret_kind text not null check (char_length(secret_kind) between 2 and 80),
  key_id text not null check (char_length(key_id) between 1 and 120),
  nonce_b64 text not null,
  ciphertext_b64 text not null,
  auth_tag_b64 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (integration_id, secret_kind),
  foreign key (agency_id, integration_id)
    references public.integrations(agency_id, id) on delete restrict
);
revoke all on table private.integration_secrets from public, anon, authenticated;
grant all on table private.integration_secrets to service_role;

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  integration_id uuid not null,
  external_user_id text,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_accounts_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, integration_id),
  unique (agency_id, id),
  foreign key (agency_id, integration_id)
    references public.integrations(agency_id, id) on delete restrict
);

create table public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  meta_connection_id uuid not null,
  external_id text not null check (char_length(external_id) between 2 and 80),
  name text not null check (char_length(name) between 1 and 240),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone_name text not null,
  account_status text,
  business_name text,
  archived_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, external_id),
  unique (agency_id, id),
  foreign key (agency_id, meta_connection_id)
    references public.meta_connections(agency_id, id) on delete restrict
);
create index meta_ad_accounts_agency_active_idx
  on public.meta_ad_accounts(agency_id, archived_at, name);

create table public.client_ad_accounts (
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agency_id, client_id, ad_account_id),
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id) on delete restrict,
  foreign key (agency_id, ad_account_id)
    references public.meta_ad_accounts(agency_id, id) on delete restrict,
  constraint client_ad_accounts_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index client_ad_accounts_client_active_idx
  on public.client_ad_accounts(agency_id, client_id, active);

create table public.meta_daily_insights (
  agency_id uuid not null,
  ad_account_id uuid not null,
  insight_date date not null,
  level text not null check (level in ('account','campaign','adset','ad')),
  external_entity_id text not null,
  parent_external_id text,
  entity_name text,
  objective text,
  captured_status text,
  spend numeric(24,8) not null check (spend >= 0),
  impressions bigint not null check (impressions >= 0),
  reach bigint check (reach is null or reach >= 0),
  link_clicks bigint check (link_clicks is null or link_clicks >= 0),
  api_version text not null,
  attribution_setting text,
  collected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (agency_id, ad_account_id, insight_date, level, external_entity_id),
  foreign key (agency_id, ad_account_id)
    references public.meta_ad_accounts(agency_id, id) on delete restrict
);
create index meta_daily_insights_period_idx
  on public.meta_daily_insights(agency_id, ad_account_id, insight_date, level);

create table public.meta_daily_actions (
  agency_id uuid not null,
  ad_account_id uuid not null,
  insight_date date not null,
  level text not null check (level in ('account','campaign','adset','ad')),
  external_entity_id text not null,
  action_type text not null check (char_length(action_type) between 1 and 240),
  action_value numeric(24,8) not null default 0,
  value_amount numeric(24,8),
  collected_at timestamptz not null default now(),
  primary key (
    agency_id, ad_account_id, insight_date, level, external_entity_id, action_type
  ),
  foreign key (agency_id, ad_account_id, insight_date, level, external_entity_id)
    references public.meta_daily_insights(
      agency_id, ad_account_id, insight_date, level, external_entity_id
    ) on delete restrict
);
create index meta_daily_actions_period_idx
  on public.meta_daily_actions(agency_id, ad_account_id, insight_date, action_type);

create table public.metric_definitions (
  key text primary key,
  label text not null,
  description text not null,
  unit text not null check (unit in ('currency','integer','percent','ratio')),
  source text not null,
  formula text,
  aggregation text not null,
  desirable_direction text not null check (desirable_direction in ('up','down','neutral')),
  display_precision smallint not null check (display_precision between 0 and 6),
  definition_version integer not null default 1 check (definition_version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.metric_definitions
  (key,label,description,unit,source,formula,aggregation,desirable_direction,display_precision)
values
  ('spend','Investimento','Valor gasto no escopo selecionado.','currency','meta.insights','spend','sum','neutral',2),
  ('impressions','Impressões','Impressões retornadas para o escopo.','integer','meta.insights','impressions','sum','neutral',0),
  ('link_clicks','Cliques no link','Cliques de link explicitamente capturados.','integer','meta.insights','link_clicks','sum','up',0),
  ('ctr_link','CTR de link','Cliques de link divididos por impressões.','percent','calculated','link_clicks / impressions * 100','recalculate','up',2),
  ('cpc_link','CPC de link','Investimento dividido por cliques de link.','currency','calculated','spend / link_clicks','recalculate','down',2),
  ('cpm','CPM','Investimento dividido por impressões vezes mil.','currency','calculated','spend / impressions * 1000','recalculate','down',2),
  ('leads','Leads','Ação de lead definida no mapeamento do cliente.','integer','meta.actions',null,'sum','up',0),
  ('conversations','Conversas','Ação de conversa definida no mapeamento do cliente.','integer','meta.actions',null,'sum','up',0),
  ('purchases','Compras','Ação de compra definida no mapeamento do cliente.','integer','meta.actions',null,'sum','up',0),
  ('cost_per_result','Custo por resultado','Investimento dividido pelo resultado principal.','currency','calculated','spend / primary_results','recalculate','down',2),
  ('attributed_revenue','Receita atribuída','Valor atribuído ao evento configurado na Meta.','currency','meta.action_values',null,'sum','up',2),
  ('roas','ROAS','Receita atribuída dividida pelo investimento.','ratio','calculated','attributed_revenue / spend','recalculate','up',2);

create table public.client_metric_mappings (
  agency_id uuid not null,
  client_id uuid not null,
  primary_metric_key text not null references public.metric_definitions(key) on delete restrict,
  primary_action_type text not null check (char_length(primary_action_type) between 1 and 240),
  revenue_action_type text check (revenue_action_type is null or char_length(revenue_action_type) between 1 and 240),
  mapping_version integer not null default 1 check (mapping_version > 0),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agency_id, client_id),
  foreign key (agency_id, client_id)
    references public.clients(agency_id, id) on delete restrict,
  constraint client_metric_mappings_updater_fkey foreign key (agency_id, updated_by)
    references public.agency_users(agency_id, user_id) on delete set null (updated_by)
);

create function private.touch_meta_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger integrations_touch before update on public.integrations
for each row execute function private.touch_meta_updated_at();
create trigger meta_connections_touch before update on public.meta_connections
for each row execute function private.touch_meta_updated_at();
create trigger meta_ad_accounts_touch before update on public.meta_ad_accounts
for each row execute function private.touch_meta_updated_at();
create trigger client_ad_accounts_touch before update on public.client_ad_accounts
for each row execute function private.touch_meta_updated_at();
create trigger client_metric_mappings_touch before update on public.client_metric_mappings
for each row execute function private.touch_meta_updated_at();

alter table public.integrations enable row level security;
alter table public.meta_connections enable row level security;
alter table public.meta_ad_accounts enable row level security;
alter table public.client_ad_accounts enable row level security;
alter table public.meta_daily_insights enable row level security;
alter table public.meta_daily_actions enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.client_metric_mappings enable row level security;

revoke all on table public.integrations, public.meta_connections, public.meta_ad_accounts,
  public.client_ad_accounts, public.meta_daily_insights, public.meta_daily_actions,
  public.metric_definitions, public.client_metric_mappings
  from public, anon, authenticated;

grant select on table public.integrations, public.meta_connections, public.meta_ad_accounts,
  public.client_ad_accounts, public.meta_daily_insights, public.meta_daily_actions,
  public.metric_definitions, public.client_metric_mappings
  to authenticated;
grant insert (agency_id, client_id, ad_account_id, active)
  on public.client_ad_accounts to authenticated;
grant update (active) on public.client_ad_accounts to authenticated;
grant insert (agency_id, client_id, primary_metric_key, primary_action_type, revenue_action_type)
  on public.client_metric_mappings to authenticated;
grant update (primary_metric_key, primary_action_type, revenue_action_type, mapping_version)
  on public.client_metric_mappings to authenticated;

grant all on table public.integrations, public.meta_connections, public.meta_ad_accounts,
  public.client_ad_accounts, public.meta_daily_insights, public.meta_daily_actions,
  public.metric_definitions, public.client_metric_mappings
  to service_role;

create policy integrations_read on public.integrations for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy meta_connections_read on public.meta_connections for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy meta_ad_accounts_read on public.meta_ad_accounts for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy client_ad_accounts_read on public.client_ad_accounts for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy meta_daily_insights_read on public.meta_daily_insights for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy meta_daily_actions_read on public.meta_daily_actions for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy metric_definitions_read on public.metric_definitions for select to authenticated
  using (true);
create policy client_metric_mappings_read on public.client_metric_mappings for select to authenticated
  using (private.agency_role(agency_id) is not null);

create policy client_ad_accounts_insert on public.client_ad_accounts for insert to authenticated
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create policy client_ad_accounts_update on public.client_ad_accounts for update to authenticated
  using (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  )
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create policy client_metric_mappings_insert on public.client_metric_mappings for insert to authenticated
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );
create policy client_metric_mappings_update on public.client_metric_mappings for update to authenticated
  using (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  )
  with check (
    private.has_agency_role(
      agency_id, array['owner','admin','editor']::public.agency_role[]
    )
  );

create function public.set_client_ad_account(
  p_agency_id uuid,
  p_client_id uuid,
  p_ad_account_id uuid,
  p_active boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_client_archived_at timestamptz;
  v_account_archived_at timestamptz;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para associar contas de anúncio.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Estado da associação inválido.' using errcode = '22023';
  end if;

  select archived_at into v_client_archived_at
  from public.clients
  where agency_id = p_agency_id and id = p_client_id;
  if not found then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;

  select archived_at into v_account_archived_at
  from public.meta_ad_accounts
  where agency_id = p_agency_id and id = p_ad_account_id;
  if not found then
    raise exception 'Conta de anúncio indisponível.' using errcode = '22023';
  end if;

  if p_active and (v_client_archived_at is not null or v_account_archived_at is not null) then
    raise exception 'Cliente ou conta arquivada não pode receber nova associação.' using errcode = '22023';
  end if;

  insert into public.client_ad_accounts(
    agency_id, client_id, ad_account_id, active, created_by
  ) values (
    p_agency_id, p_client_id, p_ad_account_id, p_active, auth.uid()
  )
  on conflict (agency_id, client_id, ad_account_id)
  do update set active = excluded.active;

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,
    auth.uid(),
    case when p_active then 'client_ad_account.linked' else 'client_ad_account.unlinked' end,
    p_client_id,
    jsonb_build_object('ad_account_id', p_ad_account_id)
  );
end;
$$;

create function public.set_client_metric_mapping(
  p_agency_id uuid,
  p_client_id uuid,
  p_primary_metric_key text,
  p_primary_action_type text,
  p_revenue_action_type text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_archived_at timestamptz;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para configurar métricas.' using errcode = '42501';
  end if;

  select archived_at into v_archived_at
  from public.clients
  where agency_id = p_agency_id and id = p_client_id;
  if not found or v_archived_at is not null then
    raise exception 'Cliente indisponível para configuração.' using errcode = '22023';
  end if;

  if p_primary_metric_key not in ('leads','conversations','purchases')
    or btrim(coalesce(p_primary_action_type,'')) = '' then
    raise exception 'Mapeamento de resultado inválido.' using errcode = '22023';
  end if;

  insert into public.client_metric_mappings(
    agency_id, client_id, primary_metric_key, primary_action_type,
    revenue_action_type, updated_by
  ) values (
    p_agency_id, p_client_id, p_primary_metric_key,
    btrim(p_primary_action_type),
    nullif(btrim(coalesce(p_revenue_action_type,'')),''),
    auth.uid()
  )
  on conflict (agency_id, client_id)
  do update set
    primary_metric_key = excluded.primary_metric_key,
    primary_action_type = excluded.primary_action_type,
    revenue_action_type = excluded.revenue_action_type,
    mapping_version = public.client_metric_mappings.mapping_version + 1,
    updated_by = auth.uid();

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,auth.uid(),'client_metric_mapping.updated',p_client_id,
    jsonb_build_object(
      'primary_metric_key', p_primary_metric_key,
      'primary_action_type', btrim(p_primary_action_type)
    )
  );
end;
$$;

create function public.get_client_portal_metric_summary(
  p_client_id uuid,
  p_date_from date,
  p_date_to date
)
returns table(
  client_id uuid,
  date_from date,
  date_to date,
  data_status text,
  compatibility_issue text,
  currency text,
  timezone_name text,
  ad_account_count integer,
  spend numeric,
  impressions bigint,
  link_clicks bigint,
  primary_metric_key text,
  primary_results numeric,
  attributed_revenue numeric,
  ctr_link numeric,
  cpc_link numeric,
  cpm numeric,
  cost_per_result numeric,
  roas numeric,
  latest_data_date date
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
  v_account_count integer;
  v_currency_count integer;
  v_timezone_count integer;
  v_currency text;
  v_timezone text;
  v_primary_metric_key text;
  v_primary_action_type text;
  v_revenue_action_type text;
  v_insight_rows bigint;
  v_spend numeric;
  v_impressions bigint;
  v_link_clicks bigint;
  v_results numeric;
  v_revenue numeric;
  v_latest date;
  v_issue text;
  v_status text;
begin
  if p_client_id is null or p_date_from is null or p_date_to is null
    or p_date_to < p_date_from or (p_date_to - p_date_from) > 370 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;

  select c.agency_id into v_agency_id
  from public.clients c where c.id = p_client_id;
  if v_agency_id is null then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;

  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id, p_client_id) then
    raise exception 'Sem permissão para consultar métricas do cliente.' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(distinct a.currency)::integer,
    count(distinct a.timezone_name)::integer,
    min(a.currency),
    min(a.timezone_name)
  into
    v_account_count, v_currency_count, v_timezone_count, v_currency, v_timezone
  from public.client_ad_accounts ca
  join public.meta_ad_accounts a
    on a.agency_id = ca.agency_id and a.id = ca.ad_account_id
  where ca.agency_id = v_agency_id
    and ca.client_id = p_client_id
    and ca.active
    and a.archived_at is null;

  if v_account_count = 0 then
    v_status := 'no_accounts';
    v_issue := 'no_ad_accounts';
  elsif v_currency_count <> 1 then
    v_status := 'incompatible';
    v_issue := 'multiple_currencies';
    v_currency := null;
  elsif v_timezone_count <> 1 then
    v_status := 'incompatible';
    v_issue := 'multiple_timezones';
    v_timezone := null;
  else
    select m.primary_metric_key, m.primary_action_type, m.revenue_action_type
    into v_primary_metric_key, v_primary_action_type, v_revenue_action_type
    from public.client_metric_mappings m
    where m.agency_id = v_agency_id and m.client_id = p_client_id;

    select
      count(*)::bigint,
      sum(i.spend),
      sum(i.impressions)::bigint,
      sum(coalesce(i.link_clicks,0))::bigint,
      max(i.insight_date)
    into v_insight_rows, v_spend, v_impressions, v_link_clicks, v_latest
    from public.meta_daily_insights i
    join public.client_ad_accounts ca
      on ca.agency_id = i.agency_id and ca.ad_account_id = i.ad_account_id
    where i.agency_id = v_agency_id
      and ca.client_id = p_client_id
      and ca.active
      and i.level = 'account'
      and i.insight_date between p_date_from and p_date_to;

    if v_insight_rows = 0 then
      v_status := 'no_data';
      v_issue := 'no_insights';
      v_spend := null;
      v_impressions := null;
      v_link_clicks := null;
    else
      v_status := 'ok';
      if v_primary_action_type is not null then
        select coalesce(sum(a.action_value),0)
        into v_results
        from public.meta_daily_actions a
        join public.client_ad_accounts ca
          on ca.agency_id = a.agency_id and ca.ad_account_id = a.ad_account_id
        where a.agency_id = v_agency_id
          and ca.client_id = p_client_id
          and ca.active
          and a.level = 'account'
          and a.insight_date between p_date_from and p_date_to
          and a.action_type = v_primary_action_type;
      end if;

      if v_revenue_action_type is not null then
        select coalesce(sum(a.value_amount),0)
        into v_revenue
        from public.meta_daily_actions a
        join public.client_ad_accounts ca
          on ca.agency_id = a.agency_id and ca.ad_account_id = a.ad_account_id
        where a.agency_id = v_agency_id
          and ca.client_id = p_client_id
          and ca.active
          and a.level = 'account'
          and a.insight_date between p_date_from and p_date_to
          and a.action_type = v_revenue_action_type;
      end if;
    end if;
  end if;

  return query select
    p_client_id,
    p_date_from,
    p_date_to,
    v_status,
    v_issue,
    v_currency,
    v_timezone,
    coalesce(v_account_count,0),
    v_spend,
    v_impressions,
    v_link_clicks,
    v_primary_metric_key,
    v_results,
    v_revenue,
    case when coalesce(v_impressions,0) > 0 and v_link_clicks is not null
      then v_link_clicks::numeric / v_impressions::numeric * 100 else null end,
    case when coalesce(v_link_clicks,0) > 0 and v_spend is not null
      then v_spend / v_link_clicks::numeric else null end,
    case when coalesce(v_impressions,0) > 0 and v_spend is not null
      then v_spend / v_impressions::numeric * 1000 else null end,
    case when coalesce(v_results,0) > 0 and v_spend is not null
      then v_spend / v_results else null end,
    case when coalesce(v_spend,0) > 0 and v_revenue is not null
      then v_revenue / v_spend else null end,
    v_latest;
end;
$$;

revoke all on function private.touch_meta_updated_at()
  from public, anon, authenticated, service_role;

revoke all on function public.set_client_ad_account(uuid,uuid,uuid,boolean),
  public.set_client_metric_mapping(uuid,uuid,text,text,text),
  public.get_client_portal_metric_summary(uuid,date,date)
  from public, anon, authenticated, service_role;

grant execute on function public.set_client_ad_account(uuid,uuid,uuid,boolean),
  public.set_client_metric_mapping(uuid,uuid,text,text,text),
  public.get_client_portal_metric_summary(uuid,date,date)
  to authenticated;

create function public.get_client_portal_data_context(p_client_id uuid)
returns table(
  client_id uuid,
  data_status text,
  compatibility_issue text,
  currency text,
  timezone_name text,
  ad_account_count integer,
  latest_data_date date
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
  v_account_count integer;
  v_currency_count integer;
  v_timezone_count integer;
  v_currency text;
  v_timezone text;
  v_latest date;
  v_issue text;
  v_status text;
begin
  select c.agency_id into v_agency_id
  from public.clients c where c.id = p_client_id;
  if v_agency_id is null then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;

  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id, p_client_id) then
    raise exception 'Sem permissão para consultar o contexto de dados.' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(distinct a.currency)::integer,
    count(distinct a.timezone_name)::integer,
    min(a.currency),
    min(a.timezone_name)
  into
    v_account_count, v_currency_count, v_timezone_count, v_currency, v_timezone
  from public.client_ad_accounts ca
  join public.meta_ad_accounts a
    on a.agency_id = ca.agency_id and a.id = ca.ad_account_id
  where ca.agency_id = v_agency_id
    and ca.client_id = p_client_id
    and ca.active
    and a.archived_at is null;

  if v_account_count = 0 then
    v_status := 'no_accounts';
    v_issue := 'no_ad_accounts';
    v_currency := null;
    v_timezone := null;
  elsif v_currency_count <> 1 then
    v_status := 'incompatible';
    v_issue := 'multiple_currencies';
    v_currency := null;
  elsif v_timezone_count <> 1 then
    v_status := 'incompatible';
    v_issue := 'multiple_timezones';
    v_timezone := null;
  else
    v_status := 'ok';
    select max(i.insight_date) into v_latest
    from public.meta_daily_insights i
    join public.client_ad_accounts ca
      on ca.agency_id = i.agency_id and ca.ad_account_id = i.ad_account_id
    where i.agency_id = v_agency_id
      and ca.client_id = p_client_id
      and ca.active
      and i.level = 'account';
  end if;

  return query select
    p_client_id,
    v_status,
    v_issue,
    v_currency,
    v_timezone,
    coalesce(v_account_count,0),
    v_latest;
end;
$$;

revoke all on function public.get_client_portal_data_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_client_portal_data_context(uuid)
  to authenticated;
