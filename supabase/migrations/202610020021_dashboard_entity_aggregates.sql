-- Exact period aggregates for the campaign tree, plus explicitly marked
-- estimates when people cannot be deduplicated across advertising accounts.
create or replace function private.enrich_dashboard_scope(p_data jsonb,p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb; v_key text; v_agency uuid;
begin
  select agency_id into v_agency from public.clients where id=p_client;
  select md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(p_accounts) a),'')||'|'||
    coalesce((select string_agg(e,',' order by e) from unnest(p_entities) e),'')) into v_key;
  select payload into v_payload from public.meta_dashboard_scopes
    where agency_id=v_agency and client_id=p_client and scope_key=v_key and date_from=p_from and date_to=p_to;
  if v_payload is null then return p_data; end if;
  return p_data||jsonb_build_object('summary',coalesce(p_data->'summary','{}')||coalesce(v_payload->'summary','{}'),
    'previousSummary',coalesce(p_data->'previousSummary','{}')||coalesce(v_payload->'previousSummary','{}'),
    'estimatedMetricKeys',coalesce(v_payload->'estimatedMetricKeys','[]'),
    'warnings',(select coalesce(jsonb_agg(w),'[]') from jsonb_array_elements_text(coalesce(p_data->'warnings','[]')) w
      where w not like 'Alcance, frequência e cliques únicos ficam disponíveis ao selecionar uma conta%'
        and not (v_payload->'summary'->>'reach' is not null and w like 'Alcance e frequência do período dependem%')),
    'metrics',(select coalesce(jsonb_agg(m order by m->>'key'),'[]') from (
      select distinct on(m->>'key') m from jsonb_array_elements(coalesce(p_data->'metrics','[]')||coalesce(v_payload->'metrics','[]')) m
      order by m->>'key',m->>'label'
    ) q));
end;
$$;

alter function public.get_client_analytics_hierarchy(uuid,date,date,uuid[]) set schema private;
alter function private.get_client_analytics_hierarchy(uuid,date,date,uuid[]) rename to analytics_hierarchy_base;
revoke all on function private.analytics_hierarchy_base(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
create function public.get_client_analytics_hierarchy(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb; v_rows jsonb; v_payload jsonb; v_accounts uuid[]; v_agency uuid; v_key text;
begin
  -- The base function authorizes the client and all requested accounts first.
  v_rows:=private.analytics_hierarchy_base(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  select agency_id into v_agency from public.clients where id=p_client_id;
  select array_agg(id::uuid) into v_accounts from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  select md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(v_accounts) a),'')||'|') into v_key;
  select payload into v_payload from public.meta_dashboard_scopes where agency_id=v_agency and client_id=p_client_id
    and scope_key=v_key and date_from=p_date_from and date_to=p_date_to;
  return (select coalesce(jsonb_agg(r||jsonb_build_object('values',coalesce(r->'values','{}')||
    coalesce(v_payload->'entityValues'->((r->>'accountId')||':'||(r->>'key')),'{}')) order by ord),'[]')
    from jsonb_array_elements(v_rows) with ordinality as entries(r,ord));
end;
$$;
revoke all on function public.get_client_analytics_hierarchy(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_client_analytics_hierarchy(uuid,date,date,uuid[]) to authenticated;

create or replace function public.create_dashboard_report(
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
      'primary_metric_key',v_data->>'primaryMetricKey','primary_action_type',v_data->>'primaryActionType','estimated_metric_keys',v_data->'estimatedMetricKeys','snapshot_version',2,
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
