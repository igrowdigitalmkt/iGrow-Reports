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
    or v_data->>'primaryActionType' is null or exists(
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
      'primary_metric_key',v_data->>'primaryMetricKey','primary_action_type',v_data->>'primaryActionType','estimated_metric_keys',v_data->'estimatedMetricKeys','snapshot_version',3,'analytics',v_data,'orientation',coalesce(p_header->>'orientation','vertical'),
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
