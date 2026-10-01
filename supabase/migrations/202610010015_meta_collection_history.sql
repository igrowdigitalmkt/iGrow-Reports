-- A complete run confirms all pages for daily account AND campaign insights,
-- including periods where the provider returned no delivery. Never infer coverage
-- from the first/last row, and never sum daily reach as period unique reach.
create table public.meta_collection_runs (
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  date_from date not null,
  date_to date not null,
  status text not null check (status in ('complete','failed')),
  insight_count integer not null default 0 check (insight_count >= 0),
  action_count integer not null default 0 check (action_count >= 0),
  collected_at timestamptz not null default now(),
  levels text[] not null default array['account','campaign']::text[],
  error_code text,
  primary key (agency_id, ad_account_id, date_from, date_to),
  foreign key (agency_id, client_id) references public.clients(agency_id,id) on delete restrict,
  foreign key (agency_id, ad_account_id) references public.meta_ad_accounts(agency_id,id) on delete restrict,
  check (date_to >= date_from and date_to - date_from < 30),
  check (levels <@ array['account','campaign']::text[]),
  check (status <> 'complete' or levels @> array['account','campaign']::text[])
);
create index meta_collection_runs_client_period_idx
  on public.meta_collection_runs(agency_id,client_id,date_from,date_to,status);

create table public.meta_period_insights (
  agency_id uuid not null,
  client_id uuid not null,
  ad_account_id uuid not null,
  date_from date not null,
  date_to date not null,
  reach bigint check (reach is null or reach >= 0),
  frequency numeric(24,8) check (frequency is null or frequency >= 0),
  unique_clicks bigint check (unique_clicks is null or unique_clicks >= 0),
  metadata jsonb not null default '{}'::jsonb,
  api_version text not null,
  collected_at timestamptz not null default now(),
  primary key (agency_id, ad_account_id, date_from, date_to),
  foreign key (agency_id, client_id) references public.clients(agency_id,id) on delete restrict,
  foreign key (agency_id, ad_account_id) references public.meta_ad_accounts(agency_id,id) on delete restrict,
  check (date_to >= date_from and date_to - date_from < 370)
);

alter table public.meta_collection_runs enable row level security;
alter table public.meta_period_insights enable row level security;
revoke all on public.meta_collection_runs, public.meta_period_insights from public,anon,authenticated;
grant select on public.meta_collection_runs, public.meta_period_insights to authenticated;
grant all on public.meta_collection_runs, public.meta_period_insights to service_role;
create policy meta_collection_runs_agency_read on public.meta_collection_runs
  for select to authenticated using (private.agency_role(agency_id) is not null);
create policy meta_period_insights_agency_read on public.meta_period_insights
  for select to authenticated using (private.agency_role(agency_id) is not null);

-- Invoker rights deliberately require the service role's table privileges.
-- Reconciliation, action replacement and coverage update are one transaction.
create function public.persist_meta_insight_slice(
  p_agency_id uuid,
  p_client_id uuid,
  p_ad_account_id uuid,
  p_date_from date,
  p_date_to date,
  p_insights jsonb,
  p_actions jsonb
)
returns table(insight_count integer, action_count integer)
language plpgsql security invoker set search_path = '' as $$
declare
  v_external_id text;
  v_insight_count integer;
  v_action_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from
    or p_date_to - p_date_from >= 30
    or jsonb_typeof(p_insights) is distinct from 'array'
    or jsonb_typeof(p_actions) is distinct from 'array' then
    raise exception 'Lote de coleta invalido.' using errcode = '22023';
  end if;

  select a.external_id into v_external_id
  from public.meta_ad_accounts a
  join public.meta_connections c on c.agency_id=a.agency_id and c.id=a.meta_connection_id
  join public.client_ad_accounts ca on ca.agency_id=a.agency_id and ca.ad_account_id=a.id
  join public.clients cl on cl.agency_id=ca.agency_id and cl.id=ca.client_id
  where a.agency_id=p_agency_id and a.id=p_ad_account_id and a.archived_at is null
    and a.business_id is not null and a.business_id ~ '^[0-9]+$'
    and c.client_id=p_client_id and ca.client_id=p_client_id and ca.active
    and cl.archived_at is null;
  if not found then
    raise exception 'Conta indisponivel para coleta do cliente.' using errcode='22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_insights) as i(
      agency_id uuid, ad_account_id uuid, insight_date date, level text, external_entity_id text
    ) where i.agency_id is distinct from p_agency_id or i.ad_account_id is distinct from p_ad_account_id
      or i.insight_date is null or i.insight_date not between p_date_from and p_date_to
      or i.level is null or i.level not in ('account','campaign')
      or i.external_entity_id is null
      or (i.level='account' and i.external_entity_id<>v_external_id)
      or (i.level='campaign' and i.external_entity_id !~ '^[0-9]+$')
  ) or exists (
    select 1 from jsonb_to_recordset(p_actions) as a(
      agency_id uuid, ad_account_id uuid, insight_date date, level text
    ) where a.agency_id is distinct from p_agency_id or a.ad_account_id is distinct from p_ad_account_id
      or a.insight_date is null or a.insight_date not between p_date_from and p_date_to
      or a.level is null or a.level not in ('account','campaign')
  ) then
    raise exception 'Dados fora do escopo da coleta.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_agency_id::text || ':' || p_ad_account_id::text,0));
  delete from public.meta_daily_actions a where a.agency_id=p_agency_id
    and a.ad_account_id=p_ad_account_id and a.insight_date between p_date_from and p_date_to
    and a.level in ('account','campaign');
  delete from public.meta_daily_insights i where i.agency_id=p_agency_id
    and i.ad_account_id=p_ad_account_id and i.insight_date between p_date_from and p_date_to
    and i.level in ('account','campaign');

  insert into public.meta_daily_insights(
    agency_id,ad_account_id,insight_date,level,external_entity_id,parent_external_id,
    entity_name,objective,spend,impressions,reach,link_clicks,api_version,collected_at,metadata
  ) select p_agency_id,p_ad_account_id,i.insight_date,i.level,i.external_entity_id,i.parent_external_id,
    i.entity_name,i.objective,i.spend,i.impressions,i.reach,i.link_clicks,i.api_version,now(),coalesce(i.metadata,'{}'::jsonb)
  from jsonb_to_recordset(p_insights) as i(
    insight_date date, level text, external_entity_id text, parent_external_id text,
    entity_name text, objective text, spend numeric, impressions bigint, reach bigint,
    link_clicks bigint, api_version text, metadata jsonb
  );
  get diagnostics v_insight_count = row_count;

  insert into public.meta_daily_actions(
    agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount,collected_at
  ) select p_agency_id,p_ad_account_id,a.insight_date,a.level,a.external_entity_id,
    a.action_type,a.action_value,a.value_amount,now()
  from jsonb_to_recordset(p_actions) as a(
    insight_date date,level text,external_entity_id text,action_type text,action_value numeric,value_amount numeric
  );
  get diagnostics v_action_count = row_count;

  insert into public.meta_collection_runs(
    agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,action_count,collected_at,levels,error_code
  ) values(p_agency_id,p_client_id,p_ad_account_id,p_date_from,p_date_to,'complete',v_insight_count,v_action_count,now(),array['account','campaign'],null)
  on conflict (agency_id,ad_account_id,date_from,date_to) do update set
    client_id=excluded.client_id,status=excluded.status,insight_count=excluded.insight_count,
    action_count=excluded.action_count,collected_at=excluded.collected_at,levels=excluded.levels,error_code=null;

  return query select v_insight_count,v_action_count;
end;
$$;

revoke all on function public.persist_meta_insight_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.persist_meta_insight_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)
  to service_role;
