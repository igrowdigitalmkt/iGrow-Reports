-- The dashboard and its report use one authorized analytical scope.
create function public.get_campaign_scoped_analytics(
  p_client_id uuid, p_date_from date, p_date_to date,
  p_ad_account_ids uuid[], p_entity_keys text[]
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_data jsonb; v_agency uuid; v_accounts uuid[]; v_primary text; v_action text; v_revenue text;
  v_previous_from date; v_previous_to date; v_result jsonb; v_keys text[]; v_levels text[];
begin
  v_data := public.get_client_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  if cardinality(p_entity_keys) is null or cardinality(p_entity_keys)=0
    or cardinality(p_entity_keys)>1000 or array_position(p_entity_keys,null) is not null
    or exists(select 1 from unnest(p_entity_keys) id where id !~ '^(campaign|adset|ad):[0-9]+$') then
    raise exception 'Seleção de campanhas inválida.' using errcode='22023';
  end if;
  select agency_id into v_agency from public.clients where id=p_client_id;
  select array_agg(id::uuid) into v_accounts from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  select primary_metric_key,primary_action_type,revenue_action_type into v_primary,v_action,v_revenue
    from public.client_metric_mappings where agency_id=v_agency and client_id=p_client_id;
  v_previous_from:=(v_data->>'previousDateFrom')::date;
  v_previous_to:=(v_data->>'previousDateTo')::date;
  if exists(select 1 from unnest(p_entity_keys) id where not exists(
    select 1 from public.meta_daily_insights i where i.agency_id=v_agency
      and i.ad_account_id=any(v_accounts) and i.level||':'||i.external_entity_id=id
      and i.insight_date between v_previous_from and p_date_to
  )) then
    raise exception 'Campanha indisponível neste escopo.' using errcode='42501';
  end if;
  if exists(select 1 from public.meta_daily_insights i where i.agency_id=v_agency
    and i.ad_account_id=any(v_accounts) and i.insight_date between v_previous_from and p_date_to
    and i.level||':'||i.external_entity_id=any(p_entity_keys)
    and ((i.level in ('adset','ad') and 'campaign:'||(i.metadata->>'campaign_id')=any(p_entity_keys))
      or (i.level='ad' and 'adset:'||i.parent_external_id=any(p_entity_keys)))) then
    raise exception 'Seleção sobreposta.' using errcode='22023';
  end if;
  select coalesce(array_agg(substr(m->>'key',8)),'{}'::text[]) into v_keys
    from jsonb_array_elements(v_data->'metrics') m where m->>'key' like 'action:%';
  select array_agg(distinct split_part(key,':',1)) into v_levels from unnest(p_entity_keys) key;
  with periods as (
    select 'current'::text label,p_date_from first_date,p_date_to last_date
    union all select 'previous',v_previous_from,v_previous_to
  ), rows as materialized (
    select p.label,i.insight_date,jsonb_build_object(
      'spend',i.spend,'impressions',i.impressions,'link_clicks',i.link_clicks,
      'actions',coalesce(a.actions,'{}'::jsonb),'revenues',coalesce(a.revenues,'{}'::jsonb),
      'clicks',i.metadata->'clicks','inline_post_engagement',i.metadata->'inline_post_engagement',
      'outbound_clicks',i.metadata->'outbound_clicks','video_plays',i.metadata->'video_play_actions',
      'video_p25',i.metadata->'video_p25_watched_actions','video_p50',i.metadata->'video_p50_watched_actions',
      'video_p75',i.metadata->'video_p75_watched_actions','video_p95',i.metadata->'video_p95_watched_actions',
      'video_p100',i.metadata->'video_p100_watched_actions'
    ) value_row from periods p join public.meta_daily_insights i on i.insight_date between p.first_date and p.last_date
    left join lateral (
      select jsonb_object_agg(a.action_type,a.action_value) actions,
        jsonb_object_agg(a.action_type,a.value_amount) filter(where a.value_amount is not null) revenues
      from public.meta_daily_actions a where a.agency_id=i.agency_id and a.ad_account_id=i.ad_account_id
        and a.insight_date=i.insight_date and a.level=i.level and a.external_entity_id=i.external_entity_id
    ) a on true where i.agency_id=v_agency and i.ad_account_id=any(v_accounts)
      and i.level||':'||i.external_entity_id=any(p_entity_keys)
  ), days as (
    select p.label,d::date as day,not exists(select 1 from unnest(v_accounts) account_id where not exists(
      select 1 from public.meta_collection_runs r where r.agency_id=v_agency and r.client_id=p_client_id
        and r.ad_account_id=account_id and r.status='complete' and r.levels@>v_levels
        and d::date between r.date_from and r.date_to
    )) covered from periods p cross join lateral generate_series(p.first_date::timestamp,p.last_date::timestamp,interval '1 day') d
  ), summaries as (
    select p.label,private.analytics_values((select jsonb_agg(r.value_row) from rows r where r.label=p.label),
      v_primary,v_action,v_revenue,v_keys,(select bool_and(d.covered) from days d where d.label=p.label),
      v_data->>'currency' is not null,null) metric_values from periods p
  ), series as (
    select d.label,d.day,private.analytics_values((select jsonb_agg(r.value_row) from rows r where r.label=d.label and r.insight_date=d.day),
      v_primary,v_action,v_revenue,v_keys,d.covered,v_data->>'currency' is not null,null) metric_values from days d
  ) select jsonb_build_object(
    'coverage',(v_data->'coverage')||jsonb_build_object(
      'status',case when (select bool_and(covered) from days where label='current') then 'complete'
        when exists(select 1 from rows where label='current') or exists(select 1 from days where label='current' and covered) then 'partial' else 'empty' end,
      'previousStatus',case when (select bool_and(covered) from days where label='previous') then 'complete'
        when exists(select 1 from rows where label='previous') or exists(select 1 from days where label='previous' and covered) then 'partial' else 'empty' end,
      'coveredDays',(select count(*) from days where label='current' and covered),
      'previousCoveredDays',(select count(*) from days where label='previous' and covered)),
    'summary',(select metric_values from summaries where label='current'),
    'previousSummary',(select metric_values from summaries where label='previous'),
    'daily',(select jsonb_agg(jsonb_build_object('date',day,'values',metric_values) order by day) from series where label='current'),
    'previousDaily',(select jsonb_agg(jsonb_build_object('date',day,'values',metric_values) order by day) from series where label='previous')
  ) into v_result;
  return v_data||v_result;
end;
$$;

-- Every insert, including audit, succeeds or rolls back together. Values are
-- calculated in the database; the caller can select keys but cannot supply totals.
create function public.create_dashboard_report(
  p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[],
  p_entity_keys text[],p_metric_keys text[],p_title text,p_header jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_agency uuid; v_data jsonb; v_report uuid; v_version uuid; v_keys text[]; v_entities jsonb;
begin
  select agency_id into v_agency from public.clients where id=p_client_id and archived_at is null;
  if v_agency is null or not private.has_agency_role(v_agency,array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão para gerar relatório.' using errcode='42501';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 2 and 200
    or cardinality(p_ad_account_ids) is null or cardinality(p_ad_account_ids) not between 1 and 100
    or cardinality(p_metric_keys)>200 then
    raise exception 'Configuração inválida.' using errcode='22023';
  end if;
  if coalesce(cardinality(p_entity_keys),0)>0 then
    v_data:=public.get_campaign_scoped_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids,p_entity_keys);
  else
    v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  end if;
  if v_data->'coverage'->>'status'<>'complete' or v_data->>'currency' is null
    or v_data->>'primaryActionType' is null or exists(
      select 1 from jsonb_array_elements(v_data->'accounts') a
      where (a->>'id')::uuid=any(p_ad_account_ids) and p_date_to >= (now() at time zone (a->>'timezoneName'))::date
    ) or exists(
      select 1 from unnest(p_ad_account_ids) account_id
      cross join generate_series(p_date_from::timestamp,p_date_to::timestamp,interval '1 day') d
      where not exists(select 1 from public.meta_collection_runs r
        where r.agency_id=v_agency and r.client_id=p_client_id and r.ad_account_id=account_id
          and r.status='complete' and r.levels@>array['account','campaign']::text[]
          and d::date between r.date_from and r.date_to)
    ) then
    raise exception 'Os dados do período não estão prontos para gerar relatório.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(e),'[]'::jsonb) into v_entities
    from jsonb_array_elements(public.get_client_analytics_hierarchy(p_client_id,p_date_from,p_date_to,p_ad_account_ids)) e
    where e->>'key'=any(p_entity_keys) or (coalesce(cardinality(p_entity_keys),0)=0 and e->>'level'='campaign');
  v_keys:=array['spend','reach','impressions','cpm','primary_results','cost_per_result']||coalesce(p_metric_keys,'{}'::text[]);
  insert into public.reports(agency_id,client_id,title,created_by)
    values(v_agency,p_client_id,trim(p_title),auth.uid()) returning id into v_report;
  insert into public.report_versions(agency_id,report_id,client_id,version_number,date_from,date_to,currency,
    timezone_name,state,configuration_snapshot,data_collected_at,created_by)
  values(v_agency,v_report,p_client_id,1,p_date_from,p_date_to,v_data->>'currency',v_data->>'timezoneName','ready',
    jsonb_build_object('source','client_dashboard','platform','meta','account_ids',v_data->'selectedAccountIds',
      'entity_keys',coalesce(to_jsonb(p_entity_keys),'[]'::jsonb),'metric_keys',to_jsonb(v_keys),
      'primary_metric_key',v_data->>'primaryMetricKey','snapshot_version',2,
      'daily',v_data->'daily','previous_daily',v_data->'previousDaily','accounts',v_data->'accounts','coverage',v_data->'coverage',
      'comparison',coalesce((p_header->>'comparison')::boolean,false),'chart_type',coalesce(p_header->>'chart_type','line'),
      'header',jsonb_build_object('name',coalesce(nullif(left(p_header->>'name',160),''),(select name from public.agencies where id=v_agency)),
        'details',left(p_header->>'details',500)),
      'scope_labels',(select coalesce(jsonb_agg(e->>'name'),'[]'::jsonb) from jsonb_array_elements(v_entities) e),
      'entity_rows',v_entities,'campaign_metric_keys',coalesce(p_header->'campaign_metric_keys','[]'::jsonb),
      'metric_catalog',v_data->'metrics'),
    (v_data->'coverage'->>'latestCollectedAt')::timestamptz,auth.uid()) returning id into v_version;
  insert into public.report_data_snapshots(agency_id,report_version_id,summary_json,quality_status,collected_at)
    values(v_agency,v_version,v_data->'summary','complete',(v_data->'coverage'->>'latestCollectedAt')::timestamptz);
  insert into public.report_metrics(agency_id,report_version_id,metric_key,label,unit,numeric_value,display_precision)
    select distinct v_agency,v_version,m->>'key',m->>'label',m->>'unit',
      (v_data->'summary'->>(m->>'key'))::numeric,(m->>'precision')::smallint
    from jsonb_array_elements(v_data->'metrics') m where m->>'key'=any(v_keys);
  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
    values(v_agency,auth.uid(),'report.dashboard_generated',v_version,
      jsonb_build_object('client_id',p_client_id,'report_id',v_report,'configuration',v_data->'selectedAccountIds'));
  return v_version;
end;
$$;

-- Removing a report hides its versions while preserving immutable evidence.
create function public.archive_dashboard_report(p_client_id uuid,p_report_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.clients where id=p_client_id;
  if v_agency is null or not private.has_agency_role(v_agency,array['owner','admin']::public.agency_role[]) then
    raise exception 'Sem permissão para excluir relatório.' using errcode='42501';
  end if;
  update public.reports set archived_at=now()
    where agency_id=v_agency and id=p_report_id and client_id=p_client_id and archived_at is null;
  if not found then raise exception 'Relatório indisponível.' using errcode='22023'; end if;
  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
    values(v_agency,auth.uid(),'report.deleted',p_report_id,jsonb_build_object('client_id',p_client_id,'retained_snapshots',true));
end;
$$;

revoke all on function public.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]),
  public.create_dashboard_report(uuid,date,date,uuid[],text[],text[],text,jsonb),
  public.archive_dashboard_report(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]),
  public.create_dashboard_report(uuid,date,date,uuid[],text[],text[],text,jsonb),
  public.archive_dashboard_report(uuid,uuid) to authenticated;
create or replace function public.list_client_portal_reports(p_client_id uuid)
returns table(
  report_version_id uuid,
  report_id uuid,
  title text,
  version_number integer,
  date_from date,
  date_to date,
  currency text,
  timezone_name text,
  data_collected_at timestamptz,
  published_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
begin
  select agency_id into v_agency_id from public.clients where id = p_client_id;
  if v_agency_id is null then
    raise exception 'Cliente indisponível.' using errcode = '22023';
  end if;
  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id,p_client_id) then
    raise exception 'Sem permissão para consultar relatórios.' using errcode = '42501';
  end if;

  return query
  select rv.id,r.id,r.title,rv.version_number,rv.date_from,rv.date_to,
    rv.currency,rv.timezone_name,rv.data_collected_at,rv.published_at
  from public.report_versions rv
  join public.reports r
    on r.agency_id = rv.agency_id and r.id = rv.report_id
  where rv.agency_id = v_agency_id
    and rv.client_id = p_client_id
    and r.archived_at is null and rv.state in ('published','superseded')
  order by rv.published_at desc, rv.id desc;
end;
$$;

create or replace function public.get_client_portal_report_metrics(p_report_version_id uuid)
returns table(
  metric_key text,
  label text,
  unit text,
  numeric_value numeric,
  display_precision smallint
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency_id uuid;
  v_client_id uuid;
  v_state text;
begin
  select agency_id,client_id,state into v_agency_id,v_client_id,v_state
  from public.report_versions v where v.id = p_report_version_id
    and exists(select 1 from public.reports r where r.id=v.report_id and r.agency_id=v.agency_id and r.archived_at is null);

  if v_agency_id is null or v_state not in ('published','superseded') then
    raise exception 'Versão publicada indisponível.' using errcode = '22023';
  end if;
  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id,v_client_id) then
    raise exception 'Sem permissão para consultar relatório.' using errcode = '42501';
  end if;

  return query
  select rm.metric_key,rm.label,rm.unit,rm.numeric_value,rm.display_precision
  from public.report_metrics rm
  where rm.agency_id = v_agency_id and rm.report_version_id = p_report_version_id
  order by case rm.metric_key
    when 'spend' then 1
    when 'leads' then 2
    when 'conversations' then 2
    when 'purchases' then 2
    when 'cost_per_result' then 3
    when 'ctr_link' then 4
    when 'link_clicks' then 5
    when 'cpc_link' then 6
    when 'cpm' then 7
    when 'attributed_revenue' then 8
    when 'roas' then 9
    else 50 end, rm.metric_key;
end;
$$;

create or replace function public.publish_report_version(
  p_agency_id uuid,
  p_report_version_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_report_id uuid;
  v_client_id uuid;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para publicar relatório.' using errcode = '42501';
  end if;

  select report_id,client_id into v_report_id,v_client_id
  from public.report_versions
  where agency_id = p_agency_id and id = p_report_version_id and state = 'ready'
    and exists(select 1 from public.reports r where r.id=report_id and r.agency_id=p_agency_id and r.archived_at is null);

  if v_report_id is null then
    raise exception 'Versão pronta indisponível.' using errcode = '22023';
  end if;

  update public.report_versions
  set state = 'superseded'
  where agency_id = p_agency_id
    and report_id = v_report_id
    and state = 'published'
    and id <> p_report_version_id;

  update public.report_versions
  set state = 'published', published_at = now()
  where agency_id = p_agency_id and id = p_report_version_id and state = 'ready';

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,auth.uid(),'report.version_published',p_report_version_id,
    jsonb_build_object('client_id',v_client_id,'report_id',v_report_id)
  );
end;
$$;

DO $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.meta_collection_runs'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%<@%' loop
    execute format('alter table public.meta_collection_runs drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.meta_collection_runs add constraint meta_collection_runs_allowed_levels
  check(levels <@ array['account','campaign','adset','ad']::text[]);
create function public.persist_meta_detailed_slice(
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
      or i.level is null or i.level not in ('account','campaign','adset','ad')
      or i.external_entity_id is null
      or (i.level='account' and i.external_entity_id<>v_external_id)
      or (i.level<>'account' and i.external_entity_id !~ '^[0-9]+$')
  ) or exists (
    select 1 from jsonb_to_recordset(p_actions) as a(
      agency_id uuid, ad_account_id uuid, insight_date date, level text
    ) where a.agency_id is distinct from p_agency_id or a.ad_account_id is distinct from p_ad_account_id
      or a.insight_date is null or a.insight_date not between p_date_from and p_date_to
      or a.level is null or a.level not in ('account','campaign','adset','ad')
  ) then
    raise exception 'Dados fora do escopo da coleta.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_agency_id::text || ':' || p_ad_account_id::text,0));
  delete from public.meta_daily_actions a where a.agency_id=p_agency_id
    and a.ad_account_id=p_ad_account_id and a.insight_date between p_date_from and p_date_to
    and a.level in ('account','campaign','adset','ad');
  delete from public.meta_daily_insights i where i.agency_id=p_agency_id
    and i.ad_account_id=p_ad_account_id and i.insight_date between p_date_from and p_date_to
    and i.level in ('account','campaign','adset','ad');

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
  ) values(p_agency_id,p_client_id,p_ad_account_id,p_date_from,p_date_to,'complete',v_insight_count,v_action_count,now(),array['account','campaign','adset','ad'],null)
  on conflict (agency_id,ad_account_id,date_from,date_to) do update set
    client_id=excluded.client_id,status=excluded.status,insight_count=excluded.insight_count,
    action_count=excluded.action_count,collected_at=excluded.collected_at,levels=excluded.levels,error_code=null;

  return query select v_insight_count,v_action_count;
end;
$$;

revoke all on function public.persist_meta_detailed_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.persist_meta_detailed_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)
  to service_role;

create function public.get_client_analytics_hierarchy(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb; v_agency uuid; v_accounts uuid[]; v_action text; v_primary text; v_revenue text; v_keys text[]; v_rows jsonb;
begin
  v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  select agency_id into v_agency from public.clients where id=p_client_id;
  select array_agg(id::uuid) into v_accounts from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  select primary_metric_key,primary_action_type,revenue_action_type into v_primary,v_action,v_revenue
    from public.client_metric_mappings where agency_id=v_agency and client_id=p_client_id;
  select coalesce(array_agg(substr(m->>'key',8)),'{}'::text[]) into v_keys
    from jsonb_array_elements(v_data->'metrics') m where m->>'key' like 'action:%';
  with rows as (
    select i.*,jsonb_build_object('spend',i.spend,'impressions',i.impressions,'link_clicks',i.link_clicks,
      'actions',coalesce(ac.actions,'{}'::jsonb),'revenues',coalesce(ac.revenues,'{}'::jsonb),
      'clicks',i.metadata->'clicks','inline_post_engagement',i.metadata->'inline_post_engagement',
      'outbound_clicks',i.metadata->'outbound_clicks','video_plays',i.metadata->'video_play_actions',
      'video_p25',i.metadata->'video_p25_watched_actions','video_p50',i.metadata->'video_p50_watched_actions',
      'video_p75',i.metadata->'video_p75_watched_actions','video_p95',i.metadata->'video_p95_watched_actions',
      'video_p100',i.metadata->'video_p100_watched_actions') value_row
    from public.meta_daily_insights i left join lateral (
      select jsonb_object_agg(a.action_type,a.action_value) actions,
        jsonb_object_agg(a.action_type,a.value_amount) filter(where a.value_amount is not null) revenues
      from public.meta_daily_actions a where a.agency_id=i.agency_id and a.ad_account_id=i.ad_account_id
        and a.insight_date=i.insight_date and a.level=i.level and a.external_entity_id=i.external_entity_id
    ) ac on true where i.agency_id=v_agency and i.ad_account_id=any(v_accounts)
      and i.level in ('campaign','adset','ad') and i.insight_date between p_date_from and p_date_to
  ), entities as (
    select r.level,r.external_entity_id id,max(r.entity_name) name,max(r.parent_external_id) parent_id,
      max(r.metadata->>'campaign_id') campaign_id,r.ad_account_id account_id,
      a.name account_name,a.currency,private.analytics_values(jsonb_agg(r.value_row),v_primary,v_action,v_revenue,v_keys,
        v_data->'coverage'->>'status'='complete',true,null) metric_values
    from rows r join public.meta_ad_accounts a on a.id=r.ad_account_id and a.agency_id=r.agency_id
    group by r.level,r.external_entity_id,r.ad_account_id,a.name,a.currency
    having sum(r.spend)>0 or sum(r.impressions)>0 or sum(r.link_clicks)>0
      or exists(select 1 from public.meta_daily_actions x where x.agency_id=v_agency and x.ad_account_id=r.ad_account_id
        and x.level=r.level and x.external_entity_id=r.external_entity_id and x.insight_date between p_date_from and p_date_to
        and (x.action_value>0 or x.value_amount>0))
  ) select coalesce(jsonb_agg(jsonb_build_object('key',level||':'||id,'id',id,'level',level,'name',coalesce(name,id),
      'parentId',parent_id,'campaignId',campaign_id,'accountId',account_id,'accountName',account_name,'currency',currency,'values',metric_values)
      order by level,name,id),'[]'::jsonb) into v_rows from entities;
  return v_rows;
end;
$$;
revoke all on function public.get_client_analytics_hierarchy(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_client_analytics_hierarchy(uuid,date,date,uuid[]) to authenticated;

create function public.get_client_report_header(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_agency uuid; v_name text;
begin
  select c.agency_id,a.name into v_agency,v_name from public.clients c join public.agencies a on a.id=c.agency_id where c.id=p_client_id;
  if v_agency is null or (private.agency_role(v_agency) is null and not private.has_client_access(v_agency,p_client_id)) then
    raise exception 'Sem permissão para consultar este cliente.' using errcode='42501';
  end if;
  return jsonb_build_object('name',v_name);
end;
$$;
revoke all on function public.get_client_report_header(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_client_report_header(uuid) to authenticated;


-- Includes drafts for the workspace team and published versions for clients.
create function public.get_dashboard_report_document(p_report_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_version public.report_versions; v_report public.reports; v_role public.agency_role; v_metrics jsonb;
begin
  select * into v_version from public.report_versions where id=p_report_version_id;
  select * into v_report from public.reports where id=v_version.report_id and archived_at is null;
  v_role:=private.agency_role(v_version.agency_id);
  if v_report.id is null or (v_role is null and
    (v_version.state not in ('published','superseded') or not private.has_client_access(v_version.agency_id,v_version.client_id))) then
    raise exception 'Relatório indisponível.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',m.metric_key,'label',m.label,'unit',m.unit,'precision',m.display_precision,
    'value',m.numeric_value) order by array_position(array['spend','reach','impressions','cpm','primary_results','cost_per_result'],m.metric_key) nulls last,m.metric_key),'[]'::jsonb)
    into v_metrics from public.report_metrics m where m.agency_id=v_version.agency_id and m.report_version_id=v_version.id;
  return jsonb_build_object('clientId',v_version.client_id,'title',v_report.title,'clientName',(select name from public.clients where id=v_version.client_id),
    'workspaceName',(select name from public.agencies where id=v_version.agency_id),
    'dateFrom',v_version.date_from,'dateTo',v_version.date_to,'currency',v_version.currency,
    'state',v_version.state,'generatedAt',v_version.generated_at,'configuration',v_version.configuration_snapshot,'metrics',v_metrics,
    'summary',(select summary_json from public.report_data_snapshots where report_version_id=v_version.id));
end;
$$;
revoke all on function public.get_dashboard_report_document(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_dashboard_report_document(uuid) to authenticated;

create or replace function public.create_manual_report_version(
  p_agency_id uuid,
  p_client_id uuid,
  p_date_from date,
  p_date_to date,
  p_report_id uuid default null,
  p_title text default 'Relatório de performance'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_report_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_summary record;
  v_api_version text;
  v_collected_at timestamptz;
  v_title text;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para gerar relatório.' using errcode = '42501';
  end if;

  if not exists(
    select 1 from public.clients
    where agency_id = p_agency_id and id = p_client_id and archived_at is null
  ) then
    raise exception 'Cliente ativo indisponível.' using errcode = '22023';
  end if;

  select * into v_summary
  from public.get_client_portal_metric_summary(p_client_id,p_date_from,p_date_to);

  if v_summary.data_status <> 'ok' then
    raise exception 'Os dados do período não estão prontos para gerar relatório.'
      using errcode = '22023';
  end if;
  if v_summary.primary_metric_key is null then
    raise exception 'Configure o resultado principal antes de gerar relatório.'
      using errcode = '22023';
  end if;

  v_title := btrim(coalesce(p_title,''));
  if char_length(v_title) not between 2 and 200 then
    raise exception 'Título de relatório inválido.' using errcode = '22023';
  end if;

  if p_report_id is null then
    insert into public.reports(agency_id,client_id,title,created_by)
    values(p_agency_id,p_client_id,v_title,auth.uid())
    returning id into v_report_id;
    v_version_number := 1;
  else
    select id into v_report_id
    from public.reports
    where agency_id = p_agency_id and id = p_report_id and client_id = p_client_id;
    if v_report_id is null then
      raise exception 'Relatório indisponível.' using errcode = '22023';
    end if;
    select coalesce(max(version_number),0)+1 into v_version_number
    from public.report_versions
    where agency_id = p_agency_id and report_id = v_report_id;
  end if;

  select max(i.api_version), max(i.collected_at)
  into v_api_version, v_collected_at
  from public.meta_daily_insights i
  join public.client_ad_accounts ca
    on ca.agency_id = i.agency_id and ca.ad_account_id = i.ad_account_id
  join public.meta_ad_accounts a on a.agency_id=i.agency_id and a.id=i.ad_account_id
  join public.meta_connections mc on mc.agency_id=a.agency_id and mc.id=a.meta_connection_id
  where i.agency_id = p_agency_id
    and ca.client_id = p_client_id
    and ca.active
    and a.archived_at is null and a.business_id~'^[0-9]+$' and mc.client_id=p_client_id
    and i.level = 'account'
    and i.insight_date between p_date_from and p_date_to;

  insert into public.report_versions(
    agency_id,report_id,client_id,version_number,date_from,date_to,
    currency,timezone_name,state,configuration_snapshot,data_collected_at,created_by
  ) values(
    p_agency_id,v_report_id,p_client_id,v_version_number,p_date_from,p_date_to,
    v_summary.currency,v_summary.timezone_name,'ready',
    jsonb_build_object(
      'primary_metric_key',v_summary.primary_metric_key,
      'ad_account_count',v_summary.ad_account_count,
      'source','meta_aggregated',
      'snapshot_version',1
    ),
    v_collected_at,auth.uid()
  ) returning id into v_version_id;

  insert into public.report_data_snapshots(
    agency_id,report_version_id,summary_json,quality_status,source_api_version,collected_at
  ) values(
    p_agency_id,v_version_id,
    jsonb_build_object(
      'spend',v_summary.spend,
      'impressions',v_summary.impressions,
      'link_clicks',v_summary.link_clicks,
      'primary_metric_key',v_summary.primary_metric_key,
      'primary_results',v_summary.primary_results,
      'attributed_revenue',v_summary.attributed_revenue,
      'ctr_link',v_summary.ctr_link,
      'cpc_link',v_summary.cpc_link,
      'cpm',v_summary.cpm,
      'cost_per_result',v_summary.cost_per_result,
      'roas',v_summary.roas,
      'latest_data_date',v_summary.latest_data_date
    ),
    'complete',v_api_version,v_collected_at
  );

  insert into public.report_metrics(
    agency_id,report_version_id,metric_key,label,unit,numeric_value,
    display_precision,definition_version
  )
  select
    p_agency_id,v_version_id,d.key,d.label,d.unit,
    case d.key
      when 'spend' then v_summary.spend
      when 'impressions' then v_summary.impressions::numeric
      when 'link_clicks' then v_summary.link_clicks::numeric
      when 'ctr_link' then v_summary.ctr_link
      when 'cpc_link' then v_summary.cpc_link
      when 'cpm' then v_summary.cpm
      when 'cost_per_result' then v_summary.cost_per_result
      when 'attributed_revenue' then v_summary.attributed_revenue
      when 'roas' then v_summary.roas
      when v_summary.primary_metric_key then v_summary.primary_results
      else null
    end,
    d.display_precision,d.definition_version
  from public.metric_definitions d
  where d.key in (
    'spend','impressions','link_clicks','ctr_link','cpc_link','cpm',
    'cost_per_result','attributed_revenue','roas',v_summary.primary_metric_key
  )
  and case d.key
      when 'spend' then v_summary.spend
      when 'impressions' then v_summary.impressions::numeric
      when 'link_clicks' then v_summary.link_clicks::numeric
      when 'ctr_link' then v_summary.ctr_link
      when 'cpc_link' then v_summary.cpc_link
      when 'cpm' then v_summary.cpm
      when 'cost_per_result' then v_summary.cost_per_result
      when 'attributed_revenue' then v_summary.attributed_revenue
      when 'roas' then v_summary.roas
      when v_summary.primary_metric_key then v_summary.primary_results
      else null
    end is not null;

  insert into public.audit_logs(agency_id,actor_id,action,entity_id,metadata)
  values(
    p_agency_id,auth.uid(),'report.version_created',v_version_id,
    jsonb_build_object(
      'client_id',p_client_id,
      'report_id',v_report_id,
      'version_number',v_version_number,
      'date_from',p_date_from,
      'date_to',p_date_to
    )
  );

  return v_version_id;
end;
$$;
