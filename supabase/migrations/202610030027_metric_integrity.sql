-- An exact provider response belongs to one client/account/entity/date scope.
-- Old contracts, expired aggregates and aggregates older than refreshed daily
-- data cannot be combined with current metrics.
create function private.valid_dashboard_scope(p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language sql stable security definer set search_path='' as $$
  select s.payload||jsonb_build_object('_collectedAt',s.collected_at)
  from public.meta_dashboard_scopes s
  join public.clients c on c.agency_id=s.agency_id and c.id=s.client_id
  where s.client_id=p_client and s.date_from=p_from and s.date_to=p_to
    and s.scope_key=md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(p_accounts) a),'')||'|'||
      coalesce((select string_agg(e,',' order by e) from unnest(p_entities) e),''))
    and s.payload->>'version'='7' and s.collected_at>=now()-interval '1 hour'
    and s.collected_at>=coalesce((select max(t.collected_at) from (
      select i.collected_at from public.meta_daily_insights i
        where i.agency_id=s.agency_id and i.ad_account_id=any(p_accounts)
          and i.insight_date between p_from-(p_to-p_from+1) and p_to
      union all select r.collected_at from public.meta_collection_runs r
        where r.agency_id=s.agency_id and r.client_id=p_client and r.ad_account_id=any(p_accounts)
          and r.status='complete' and r.date_from<=p_to and r.date_to>=p_from-(p_to-p_from+1)
    ) t),'-infinity'::timestamptz);
$$;
revoke all on function private.valid_dashboard_scope(uuid,date,date,uuid[],text[]) from public,anon,authenticated,service_role;

-- Named conversion families are secondary metrics. They cannot establish the
-- provider-selected Results indicator or its cost when Results was omitted.
create function private.provider_result_family(p_key text) returns text
language sql immutable set search_path='' as $$
  select case regexp_replace(p_key,'^result:provider:','')
    when 'action:onsite_conversion.messaging_conversation_started_7d' then 'messages'
    when 'profile_visit_view' then 'profile_visits' when 'instagram_profile_visits' then 'profile_visits'
    when 'action:instagram_profile_visit' then 'profile_visits' when 'action:onsite_conversion.instagram_profile_visit' then 'profile_visits'
    when 'action:lead' then 'leads' when 'action:omni_lead' then 'leads'
    when 'action:onsite_conversion.lead_grouped' then 'leads' when 'action:offsite_conversion.fb_pixel_lead' then 'leads'
    when 'action:omni_complete_registration' then 'registrations' when 'action:complete_registration' then 'registrations'
    when 'action:offsite_conversion.fb_pixel_complete_registration' then 'registrations'
    when 'action:omni_purchase' then 'purchases' when 'action:purchase' then 'purchases'
    when 'action:offsite_conversion.fb_pixel_purchase' then 'purchases'
    else p_key end;
$$;
revoke all on function private.provider_result_family(text) from public,anon,authenticated,service_role;

create or replace function private.result_values(p_values jsonb,p_complete boolean) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_values jsonb:=coalesce(p_values,'{}');v_total numeric;v_families integer;
begin
  v_values:=v_values||jsonb_build_object(
    'result:messages',coalesce((p_values->>'result:messages')::numeric,(p_values->>'action:onsite_conversion.messaging_conversation_started_7d')::numeric),
    'result:profile_visits',coalesce((p_values->>'result:profile_visits')::numeric,(p_values->>'instagram_profile_visits')::numeric,(p_values->>'action:instagram_profile_visit')::numeric,(p_values->>'action:onsite_conversion.instagram_profile_visit')::numeric),
    'result:leads',coalesce((p_values->>'result:leads')::numeric,(p_values->>'action:lead')::numeric,(p_values->>'action:omni_lead')::numeric,(p_values->>'action:onsite_conversion.lead_grouped')::numeric,(p_values->>'action:offsite_conversion.fb_pixel_lead')::numeric),
    'result:registrations',coalesce((p_values->>'result:registrations')::numeric,(p_values->>'action:omni_complete_registration')::numeric,(p_values->>'action:complete_registration')::numeric,(p_values->>'action:offsite_conversion.fb_pixel_complete_registration')::numeric),
    'result:purchases',coalesce((p_values->>'result:purchases')::numeric,(p_values->>'action:omni_purchase')::numeric,(p_values->>'action:purchase')::numeric,(p_values->>'action:offsite_conversion.fb_pixel_purchase')::numeric));
  if p_complete and p_values->>'result:provider_known'='1' and not exists(
    select 1 from jsonb_each(v_values) where key like 'result:provider:%' and (value='null'::jsonb or value::text::numeric<0)) then
    select coalesce(sum(value::text::numeric),0),count(distinct private.provider_result_family(key))
      into v_total,v_families from jsonb_each(v_values) where key like 'result:provider:%';
    if v_families>1 then v_total:=null;end if;
  end if;
  return v_values||jsonb_build_object('primary_results',v_total,
    'cost_per_result',(p_values->>'spend')::numeric/nullif(v_total,0));
end;
$$;

create function private.canonical_daily_row(p_row jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_values jsonb:=p_row->'canonical_values';v_actions jsonb;v_revenues jsonb;v_results jsonb;
begin
  if p_row->>'analytics_version' is distinct from '7' or jsonb_typeof(v_values) is distinct from 'object' then return p_row;end if;
  select coalesce(jsonb_object_agg(substr(key,8),value),'{}') into v_actions from jsonb_each(v_values) where key like 'action:%';
  select coalesce(jsonb_object_agg(substr(key,14),value),'{}') into v_revenues from jsonb_each(v_values) where key like 'value:action:%';
  select coalesce(jsonb_object_agg(key,value),'{}') into v_results from jsonb_each(v_values)
    where key='result:provider_known' or key like 'result:provider:%';
  return p_row||v_values||jsonb_build_object('actions',v_actions,'revenues',v_revenues,'provider_results',v_results);
end;
$$;
revoke all on function private.canonical_daily_row(jsonb) from public,anon,authenticated,service_role;

create or replace function private.analytics_values(
  p_rows jsonb,p_primary_key text,p_primary_action text,p_revenue_action text,
  p_actions text[],p_complete boolean,p_money_compatible boolean,p_unique jsonb default null
) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_count integer; v_native boolean; v_spend numeric; v_impressions numeric; v_links numeric; v_revenue numeric;
  v_values jsonb; v_key text; v_amount numeric; v_provider jsonb;
begin
  select coalesce(jsonb_agg(private.canonical_daily_row(r)),'[]') into p_rows from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  select count(*)::integer,
    case when count(r->>'spend')=count(*) then sum((r->>'spend')::numeric) end,
    case when count(r->>'impressions')=count(*) then sum((r->>'impressions')::numeric) end,
    case when count(r->>'link_clicks')=count(*) then sum((r->>'link_clicks')::numeric) end,
    case when p_revenue_action is not null then sum((r->'revenues'->>p_revenue_action)::numeric) end,
    bool_and(r->'provider_results'->>'result:provider_known'='1')
    into v_count,v_spend,v_impressions,v_links,v_revenue,v_native
  from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  -- bool_and ignores NULL, so every source must explicitly confirm Results.
  v_native:=v_count>0 and not exists(select 1 from jsonb_array_elements(coalesce(p_rows,'[]')) r
    where r->'provider_results'->>'result:provider_known' is distinct from '1');
  if v_count=0 and p_complete then v_spend:=0;v_impressions:=0;v_links:=0;v_native:=true;end if;
  if not p_money_compatible then v_spend:=null;v_revenue:=null;end if;
  v_values:=jsonb_build_object('spend',v_spend,'impressions',v_impressions,'link_clicks',v_links,
    'attributed_revenue',v_revenue,'ctr_link',v_links/nullif(v_impressions,0)*100,
    'cpc_link',v_spend/nullif(v_links,0),'cpm',v_spend/nullif(v_impressions,0)*1000,
    'roas',v_revenue/nullif(v_spend,0),'reach',p_unique->'reach','frequency',p_unique->'frequency','unique_clicks',p_unique->'unique_clicks');
  foreach v_key in array array['instagram_profile_visits','clicks','inline_post_engagement','outbound_clicks',
    'video_plays','video_p25','video_p50','video_p75','video_p95','video_p100'] loop
    select case when count(r->>v_key)=count(*) then sum((r->>v_key)::numeric) end into v_amount
      from jsonb_array_elements(coalesce(p_rows,'[]')) r;
    if v_count=0 and p_complete then v_amount:=0;end if;
    v_values:=v_values||jsonb_build_object(v_key,v_amount);
  end loop;
  foreach v_key in array coalesce(p_actions,'{}'::text[]) loop
    select case when bool_and(r->'actions'->>v_key is not null or coalesce(r->>'actions_confirmed'='true',false))
      then sum(coalesce((r->'actions'->>v_key)::numeric,0)) end into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
    if v_count=0 and p_complete then v_amount:=0;end if;
    v_values:=v_values||jsonb_build_object('action:'||v_key,v_amount,'cost:action:'||v_key,v_spend/nullif(v_amount,0));
  end loop;
  foreach v_key in array array['result:messages','result:profile_visits','result:leads','result:registrations','result:purchases'] loop
    select case when count(r->>v_key)=count(*) then sum((r->>v_key)::numeric) end into v_amount from jsonb_array_elements(coalesce(p_rows,'[]')) r;
    v_values:=v_values||jsonb_build_object(v_key,v_amount);
  end loop;
  if v_native then
    select coalesce(jsonb_object_agg(key,amount),'{}') into v_provider from (
      select e.key,sum(e.value::text::numeric) amount
      from jsonb_array_elements(coalesce(p_rows,'[]')) r
      cross join lateral jsonb_each(case when jsonb_typeof(r->'provider_results')='object' then r->'provider_results' else '{}' end) e
      where e.key like 'result:provider:%' and e.value<>'null'::jsonb group by e.key
    ) q;
    v_values:=v_values||v_provider||jsonb_build_object('result:provider_known',1);
  end if;
  return private.result_values(v_values,p_complete);
end;
$$;

-- Feed the native Results metadata through all daily grains, rather than
-- discarding the provider's optimization-specific indicator after collection.
do $$
declare v_name text;v_definition text;
begin
  foreach v_name in array array['private.client_analytics_base(uuid,date,date,uuid[])',
    'private.campaign_analytics_base(uuid,date,date,uuid[],text[])','private.analytics_hierarchy_base(uuid,date,date,uuid[])'] loop
    v_definition:=pg_get_functiondef(v_name::regprocedure);
    v_definition:=replace(v_definition,'''spend'',i.spend','''analytics_version'',i.metadata->''analytics_version'',''canonical_values'',i.metadata->''canonical_values'',''actions_confirmed'',i.metadata->''actions_confirmed'',''provider_results'',i.metadata->''provider_results'',''spend'',i.spend');
    execute v_definition;
  end loop;
end;
$$;

create or replace function private.enrich_dashboard_scope(p_data jsonb,p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb;v_data jsonb:=p_data;
begin
  v_payload:=private.valid_dashboard_scope(p_client,p_from,p_to,p_accounts,p_entities);
  if v_payload is null then return v_data||jsonb_build_object('metaAggregate',jsonb_build_object('confirmed',false,'collectedAt',null,'version',null));end if;
  v_data:=v_data||jsonb_build_object(
    'metaAggregate',jsonb_build_object('confirmed',true,'collectedAt',v_payload->'_collectedAt','version',7),
    'summary',private.result_values(coalesce(v_payload->'summary','{}'),true),
    'previousSummary',private.result_values(coalesce(v_payload->'previousSummary','{}'),true),
    'estimatedMetricKeys',coalesce(v_payload->'estimatedMetricKeys','[]'),
    'warnings',(select coalesce(jsonb_agg(w),'[]') from jsonb_array_elements_text(coalesce(v_data->'warnings','[]')) w
      where w not like 'Alcance, frequência e cliques únicos ficam disponíveis ao selecionar uma conta%'
        and not(v_payload->'summary'->>'reach' is not null and w like 'Alcance e frequência do período dependem%')),
    'metrics',(select coalesce(jsonb_agg(m order by m->>'key'),'[]') from (
      select distinct on(m->>'key') m from jsonb_array_elements(coalesce(v_data->'metrics','[]')||coalesce(v_payload->'metrics','[]')) m
      order by m->>'key',m->>'label'
    ) q));
  if coalesce(cardinality(p_entities),0)=0 then
    v_data:=v_data||jsonb_build_object('accountTotals',(select coalesce(jsonb_agg(a||jsonb_build_object('values',
      coalesce(v_payload->'accountValues'->(a->>'id'),'{}')) order by a->>'name'),'[]') from jsonb_array_elements(v_data->'accountTotals') a),
      'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('id',e->'id','name',e->'name','accountId',e->'accountId',
        'accountName',e->'accountName','currency',e->'currency','status',null,'values',coalesce(v_payload->'entityValues'->((e->>'accountId')||':'||(e->>'key')),'{}'))
        order by e->>'name'),'[]') from jsonb_array_elements(coalesce(v_payload->'entityCatalog','[]')) e where e->>'level'='campaign'));
  end if;
  return v_data;
end;
$$;

create or replace function public.get_client_analytics_hierarchy(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb;v_rows jsonb;v_payload jsonb;v_accounts uuid[];v_agency uuid;
begin
  -- The authorized read model validates the client and every requested account.
  v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  select agency_id into v_agency from public.clients where id=p_client_id;
  select array_agg(id::uuid) into v_accounts from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  v_payload:=private.valid_dashboard_scope(p_client_id,p_date_from,p_date_to,v_accounts,'{}');
  if v_payload is not null then
    return (select coalesce(jsonb_agg(e||jsonb_build_object('values',coalesce(v_payload->'entityValues'->((e->>'accountId')||':'||(e->>'key')),'{}'))
      order by e->>'level',e->>'name',e->>'id'),'[]')
      from jsonb_array_elements(coalesce(v_payload->'entityCatalog','[]')) e
      where (e->>'accountId')::uuid=any(v_accounts) and e->>'level' in('campaign','adset','ad')
        and e->>'key'=(e->>'level')||':'||(e->>'id'));
  end if;
  v_rows:=private.analytics_hierarchy_base(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  return (select coalesce(jsonb_agg(r||jsonb_build_object('values',case when not exists(
    select 1 from generate_series(p_date_from::timestamp,p_date_to::timestamp,interval '1 day') d where not exists(
      select 1 from public.meta_collection_runs cr where cr.agency_id=v_agency and cr.client_id=p_client_id
        and cr.ad_account_id=(r->>'accountId')::uuid and cr.status='complete' and cr.levels@>array[r->>'level']
        and d::date between cr.date_from and cr.date_to)) then r->'values' else '{}'::jsonb end) order by ord),'[]')
    from jsonb_array_elements(v_rows) with ordinality entries(r,ord));
end;
$$;

-- New saved reports must contain the same validated exact aggregate used by
-- the dashboard; existing immutable report versions are preserved.
do $$
declare v_definition text;
begin
  v_definition:=replace(pg_get_functiondef('public.create_dashboard_report(uuid,date,date,uuid[],text[],text[],text,jsonb)'::regprocedure),E'\r','');
  v_definition:=replace(v_definition,'if v_data->''coverage''->>''status''<>''complete'' or v_data->>''currency'' is null',
    'if v_data->''coverage''->>''status''<>''complete'' or v_data->>''currency'' is null or v_data->''metaAggregate''->>''confirmed'' is distinct from ''true''');
  v_definition:=replace(v_definition,'''snapshot_version'',4','''snapshot_version'',5');
  execute v_definition;
end;
$$;

-- Manual versions use the same validated account scope, complete analytical
-- snapshot and native result semantics as a dashboard-generated version.
do $$
declare v_definition text;
begin
  v_definition:=replace(pg_get_functiondef('public.create_dashboard_report(uuid,date,date,uuid[],text[],text[],text,jsonb)'::regprocedure),E'\r','');
  v_definition:=regexp_replace(v_definition,'CREATE OR REPLACE FUNCTION public.create_dashboard_report\([^\n]+\)',
    'CREATE OR REPLACE FUNCTION public.create_manual_report_version(p_agency_id uuid,p_client_id uuid,p_date_from date,p_date_to date,p_report_id uuid DEFAULT NULL,p_title text DEFAULT ''Relatório de performance'')');
  v_definition:=replace(v_definition,'declare', $declarations$declare
  p_ad_account_ids uuid[];p_entity_keys text[]:='{}';p_metric_keys text[]:=array['link_clicks','ctr_link','cpc_link','attributed_revenue','roas'];
  p_header jsonb:='{}';v_version_number integer;
$declarations$);
  v_definition:=replace(v_definition,'if p_title is null', $checks$if v_agency is distinct from p_agency_id then
    raise exception 'Cliente ativo indisponível.' using errcode='22023';
  end if;
  v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,null);
  select array_agg(id::uuid) into p_ad_account_ids from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  if p_title is null$checks$);
  v_definition:=replace(v_definition,$original$insert into public.reports(agency_id,client_id,title,created_by)
    values(v_agency,p_client_id,trim(p_title),auth.uid()) returning id into v_report;$original$,
    $replacement$if p_report_id is null then
    insert into public.reports(agency_id,client_id,title,created_by)
      values(v_agency,p_client_id,trim(p_title),auth.uid()) returning id into v_report;
    v_version_number:=1;
  else
    select id into v_report from public.reports where id=p_report_id and agency_id=v_agency and client_id=p_client_id and archived_at is null;
    if v_report is null then raise exception 'Relatório indisponível.' using errcode='22023';end if;
    perform pg_advisory_xact_lock(hashtextextended(v_agency::text||':'||v_report::text,0));
    select coalesce(max(version_number),0)+1 into v_version_number from public.report_versions where agency_id=v_agency and report_id=v_report;
  end if;$replacement$);
  v_definition:=replace(v_definition,'values(v_agency,v_report,p_client_id,1,','values(v_agency,v_report,p_client_id,v_version_number,');
  v_definition:=replace(v_definition,'''report.dashboard_generated''','''report.version_created''');
  execute v_definition;
end;
$$;

create function private.report_contract_confirmed(p_configuration jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_configuration->>'snapshot_version'~'^[0-9]+$'
    and (p_configuration->>'snapshot_version')::integer>=5
    and p_configuration->'analytics'->'metaAggregate'->>'confirmed'='true'
    and p_configuration->'analytics'->'metaAggregate'->>'version'='7',false);
$$;
revoke all on function private.report_contract_confirmed(jsonb) from public,anon,authenticated,service_role;

-- Keep historical snapshots immutable, but do not republish or present an
-- unaudited result calculation as a verified report.
do $$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('public.publish_report_version(uuid,uuid)'::regprocedure);
  v_definition:=replace(v_definition,'update public.report_versions', $guard$if not exists(select 1 from public.report_versions
    where agency_id=p_agency_id and id=p_report_version_id and private.report_contract_confirmed(configuration_snapshot)) then
    raise exception 'Relatório anterior à auditoria. Gere uma nova versão com dados verificados.' using errcode='22023';
  end if;
  update public.report_versions$guard$);
  execute v_definition;
  v_definition:=pg_get_functiondef('public.get_dashboard_report_document(uuid)'::regprocedure);
  v_definition:=replace(v_definition,'select coalesce(jsonb_agg', $guard$if not private.report_contract_confirmed(v_version.configuration_snapshot) then
    raise exception 'Relatório anterior à auditoria. Gere uma nova versão com dados verificados.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg$guard$);
  execute v_definition;
  v_definition:=pg_get_functiondef('public.get_client_portal_report_metrics(uuid)'::regprocedure);
  v_definition:=replace(v_definition,'return query', $guard$if not exists(select 1 from public.report_versions where id=p_report_version_id
    and private.report_contract_confirmed(configuration_snapshot)) then
    raise exception 'Relatório anterior à auditoria. Gere uma nova versão com dados verificados.' using errcode='22023';
  end if;
  return query$guard$);
  execute v_definition;
end;
$$;
