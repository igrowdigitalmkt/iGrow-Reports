-- Automatic outcomes replace the client-level primary result setting.
create function private.result_values(p_values jsonb,p_complete boolean) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_values jsonb:=coalesce(p_values,'{}'); v_amount numeric; v_total numeric:=0; v_available boolean:=false;
begin
  v_amount:=coalesce((p_values->>'result:messages')::numeric, (p_values->>'action:onsite_conversion.messaging_conversation_started_7d')::numeric);
  v_values:=v_values||jsonb_build_object('result:messages',v_amount);
  if v_amount is not null then v_total:=v_total+v_amount; v_available:=true; end if;
  v_amount:=coalesce((p_values->>'result:profile_visits')::numeric, (p_values->>'instagram_profile_visits')::numeric, (p_values->>'action:instagram_profile_visit')::numeric, (p_values->>'action:onsite_conversion.instagram_profile_visit')::numeric);
  v_values:=v_values||jsonb_build_object('result:profile_visits',v_amount);
  if v_amount is not null then v_total:=v_total+v_amount; v_available:=true; end if;
  v_amount:=coalesce((p_values->>'result:leads')::numeric, (p_values->>'action:lead')::numeric, (p_values->>'action:omni_lead')::numeric, (p_values->>'action:onsite_conversion.lead_grouped')::numeric, (p_values->>'action:offsite_conversion.fb_pixel_lead')::numeric);
  v_values:=v_values||jsonb_build_object('result:leads',v_amount);
  if v_amount is not null then v_total:=v_total+v_amount; v_available:=true; end if;
  v_amount:=coalesce((p_values->>'result:registrations')::numeric, (p_values->>'action:omni_complete_registration')::numeric, (p_values->>'action:complete_registration')::numeric, (p_values->>'action:offsite_conversion.fb_pixel_complete_registration')::numeric);
  v_values:=v_values||jsonb_build_object('result:registrations',v_amount);
  if v_amount is not null then v_total:=v_total+v_amount; v_available:=true; end if;
  v_amount:=coalesce((p_values->>'result:purchases')::numeric, (p_values->>'action:omni_purchase')::numeric, (p_values->>'action:purchase')::numeric, (p_values->>'action:offsite_conversion.fb_pixel_purchase')::numeric);
  v_values:=v_values||jsonb_build_object('result:purchases',v_amount);
  if v_amount is not null then v_total:=v_total+v_amount; v_available:=true; end if;
  if not v_available and not p_complete then v_total:=null; end if;
  return v_values||jsonb_build_object('primary_results',v_total,'cost_per_result',(p_values->>'spend')::numeric/nullif(v_total,0));
end;
$$;
revoke all on function private.result_values(jsonb,boolean) from public,anon,authenticated,service_role;
create or replace function private.analytics_values(
  p_rows jsonb, p_primary_key text, p_primary_action text, p_revenue_action text,
  p_actions text[], p_complete boolean, p_money_compatible boolean,
  p_unique jsonb default null
)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_count integer;
  v_spend numeric; v_impressions numeric; v_links numeric; v_results numeric; v_revenue numeric;
  v_values jsonb; v_key text; v_amount numeric;
begin
  select count(*)::integer, sum((r->>'spend')::numeric), sum((r->>'impressions')::numeric),
    case when count(r->>'link_clicks') = count(*) then sum((r->>'link_clicks')::numeric) end,
    sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),true)->>'primary_results')::numeric),
    case when p_revenue_action is not null then sum((r->'revenues'->>p_revenue_action)::numeric) end
  into v_count,v_spend,v_impressions,v_links,v_results,v_revenue
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
  if v_count=0 and p_complete then
    v_spend:=0; v_impressions:=0; v_links:=0;
    v_results:=0;
  end if;
  if not p_money_compatible then v_spend:=null; v_revenue:=null; end if;
  v_values:=jsonb_build_object(
    'spend',v_spend,'impressions',v_impressions,'link_clicks',v_links,
    'primary_results',v_results,'attributed_revenue',v_revenue,
    'ctr_link',v_links/nullif(v_impressions,0)*100,
    'cpc_link',v_spend/nullif(v_links,0),'cpm',v_spend/nullif(v_impressions,0)*1000,
    'cost_per_result',v_spend/nullif(v_results,0),'roas',v_revenue/nullif(v_spend,0),
    'reach',p_unique->'reach','frequency',p_unique->'frequency','unique_clicks',p_unique->'unique_clicks'
  );
  foreach v_key in array array['instagram_profile_visits','clicks','inline_post_engagement','outbound_clicks',
    'video_plays','video_p25','video_p50','video_p75','video_p95','video_p100'] loop
    select case when count(r->>v_key)=count(*) then sum((r->>v_key)::numeric) end
    into v_amount from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
    -- A completed empty provider response proves zero activity, while a missing
    -- optional field on a nonempty response remains unavailable.
    if v_count=0 and p_complete then v_amount:=0; end if;
    v_values:=v_values||jsonb_build_object(v_key,v_amount);
  end loop;
  foreach v_key in array coalesce(p_actions,'{}'::text[]) loop
    select sum(coalesce((r->'actions'->>v_key)::numeric,0)) into v_amount
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
    if v_count=0 and p_complete then v_amount:=0; end if;
    v_values:=v_values||jsonb_build_object('action:'||v_key,v_amount);
  end loop;
  select sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),p_complete)->>'result:messages')::numeric) into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_values:=v_values||jsonb_build_object('result:messages',v_amount);
  select sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),p_complete)->>'result:profile_visits')::numeric) into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_values:=v_values||jsonb_build_object('result:profile_visits',v_amount);
  select sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),p_complete)->>'result:leads')::numeric) into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_values:=v_values||jsonb_build_object('result:leads',v_amount);
  select sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),p_complete)->>'result:registrations')::numeric) into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_values:=v_values||jsonb_build_object('result:registrations',v_amount);
  select sum((private.result_values((select coalesce(jsonb_object_agg('action:'||key,value),'{}') from jsonb_each(coalesce(r->'actions','{}'))) || jsonb_build_object('instagram_profile_visits',r->'instagram_profile_visits'),p_complete)->>'result:purchases')::numeric) into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_values:=v_values||jsonb_build_object('result:purchases',v_amount);
  return private.result_values(v_values,p_complete);
end;
$$;
revoke all on function private.analytics_values(jsonb,text,text,text,text[],boolean,boolean,jsonb)
  from public,anon,authenticated,service_role;

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
  return p_data||jsonb_build_object('summary',private.result_values(coalesce(p_data->'summary','{}')||coalesce(v_payload->'summary','{}'),p_data->'coverage'->>'status'='complete'),
    'previousSummary',private.result_values(coalesce(p_data->'previousSummary','{}')||coalesce(v_payload->'previousSummary','{}'),p_data->'coverage'->>'previousStatus'='complete'),
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


do $$
declare v_name text; v_definition text;
begin
  foreach v_name in array array['private.client_analytics_base(uuid,date,date,uuid[])','private.campaign_analytics_base(uuid,date,date,uuid[],text[])','private.analytics_hierarchy_base(uuid,date,date,uuid[])'] loop
    v_definition:=pg_get_functiondef(v_name::regprocedure);
    v_definition:=replace(v_definition,'''clicks'',i.metadata->''clicks''','''instagram_profile_visits'',i.metadata->''instagram_profile_visits'',''clicks'',i.metadata->''clicks''');
    execute v_definition;
  end loop;
end;
$$;
-- Preserve the complete dashboard and the chosen PDF format in each report.
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
    or exists(
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
    where coalesce(cardinality(p_entity_keys),0)=0 or e->>'key'=any(p_entity_keys)
      or ('campaign:'||(e->>'campaignId'))=any(p_entity_keys)
      or (e->>'level'='ad' and ('adset:'||(e->>'parentId'))=any(p_entity_keys));
  v_keys:=array['spend','reach','impressions','cpm','primary_results','cost_per_result']||coalesce(p_metric_keys,'{}'::text[]);
  insert into public.reports(agency_id,client_id,title,created_by)
    values(v_agency,p_client_id,trim(p_title),auth.uid()) returning id into v_report;
  insert into public.report_versions(agency_id,report_id,client_id,version_number,date_from,date_to,currency,
    timezone_name,state,configuration_snapshot,data_collected_at,created_by)
  values(v_agency,v_report,p_client_id,1,p_date_from,p_date_to,v_data->>'currency',v_data->>'timezoneName','ready',
    jsonb_build_object('source','client_dashboard','platform','meta','account_ids',v_data->'selectedAccountIds',
      'entity_keys',coalesce(to_jsonb(p_entity_keys),'[]'::jsonb),'metric_keys',to_jsonb(v_keys),
      'primary_metric_key',v_data->>'primaryMetricKey','primary_action_type',v_data->>'primaryActionType','estimated_metric_keys',v_data->'estimatedMetricKeys','snapshot_version',4,'analytics',v_data,'orientation',coalesce(p_header->>'orientation','vertical'),
      'daily',v_data->'daily','previous_daily',v_data->'previousDaily','accounts',v_data->'accounts','coverage',v_data->'coverage',
      'comparison',coalesce((p_header->>'comparison')::boolean,false),'chart_type',coalesce(p_header->>'chart_type','line'),
      'header',jsonb_build_object('name',coalesce(nullif(left(p_header->>'name',160),''),(select name from public.agencies where id=v_agency)),
        'details',left(p_header->>'details',500),'analysisNote',left(coalesce(p_header->>'analysisNote',''),5000)),
      'scope_labels',case when coalesce(cardinality(p_entity_keys),0)=0 then '["Todas as campanhas"]'::jsonb else (select coalesce(jsonb_agg(e->>'name'),'[]'::jsonb) from jsonb_array_elements(v_entities) e) end,
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
