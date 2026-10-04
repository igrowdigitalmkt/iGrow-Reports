

-- Result aggregation contract v11.
-- A provider row with zero spend and zero impressions contributes zero Results
-- even when Meta omits the Results field. Delivering rows still require native
-- Results and are never inferred from secondary actions.

create or replace function private.valid_dashboard_scope(p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language sql stable security definer set search_path='' as $$
  select s.payload||jsonb_build_object('_collectedAt',s.collected_at)
  from public.meta_dashboard_scopes s
  join public.clients c on c.agency_id=s.agency_id and c.id=s.client_id
  where s.client_id=p_client and s.date_from=p_from and s.date_to=p_to
    and s.scope_key=md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(p_accounts) a),'')||'|'||
      coalesce((select string_agg(e,',' order by e) from unnest(p_entities) e),''))
    and s.payload->>'version'='11' and s.collected_at>=now()-interval '1 hour'
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

create or replace function private.canonical_daily_row(p_row jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_values jsonb:=p_row->'canonical_values';v_actions jsonb;v_revenues jsonb;v_results jsonb;
begin
  if p_row->>'analytics_version' is distinct from '11' or jsonb_typeof(v_values) is distinct from 'object' then return p_row;end if;
  select coalesce(jsonb_object_agg(substr(key,8),value),'{}') into v_actions from jsonb_each(v_values) where key like 'action:%';
  select coalesce(jsonb_object_agg(substr(key,14),value),'{}') into v_revenues from jsonb_each(v_values) where key like 'value:action:%';
  select coalesce(jsonb_object_agg(key,value),'{}') into v_results from jsonb_each(v_values)
    where key='result:provider_known' or key like 'result:provider:%';
  return p_row||v_values||jsonb_build_object('actions',v_actions,'revenues',v_revenues,'provider_results',v_results);
end;
$$;
revoke all on function private.canonical_daily_row(jsonb) from public,anon,authenticated,service_role;

create or replace function private.enrich_dashboard_scope(p_data jsonb,p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb;v_data jsonb:=p_data;
begin
  v_payload:=private.valid_dashboard_scope(p_client,p_from,p_to,p_accounts,p_entities);
  if v_payload is null then
    return v_data||jsonb_build_object('metaAggregate',jsonb_build_object('confirmed',false,'collectedAt',null,'version',null));
  end if;
  v_data:=v_data||jsonb_build_object(
    'metaAggregate',jsonb_build_object('confirmed',true,'collectedAt',v_payload->'_collectedAt','version',11),
    'summary',private.result_values(coalesce(v_payload->'summary','{}'),true),
    'previousSummary',private.result_values(coalesce(v_payload->'previousSummary','{}'),true),
    'estimatedMetricKeys',coalesce(v_payload->'estimatedMetricKeys','[]'),
    'warnings',(select coalesce(jsonb_agg(w),'[]') from jsonb_array_elements_text(coalesce(v_data->'warnings','[]')) w
      where w not like 'Alcance, frequÃªncia e cliques Ãºnicos ficam disponÃ­veis ao selecionar uma conta%'
        and not(v_payload->'summary'->>'reach' is not null and w like 'Alcance e frequÃªncia do perÃ­odo dependem%')),
    'metrics',(select coalesce(jsonb_agg(m order by m->>'key'),'[]') from (
      select distinct on(m->>'key') m from jsonb_array_elements(coalesce(v_data->'metrics','[]')||coalesce(v_payload->'metrics','[]')) m
      order by m->>'key',m->>'label'
    ) q));
  if coalesce(cardinality(p_entities),0)=0 then
    v_data:=v_data||jsonb_build_object(
      'accountTotals',(select coalesce(jsonb_agg(a||jsonb_build_object('values',
        coalesce(v_payload->'accountValues'->(a->>'id'),'{}')) order by a->>'name'),'[]')
        from jsonb_array_elements(v_data->'accountTotals') a),
      'campaigns',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',e->'id','name',e->'name','accountId',e->'accountId','accountName',e->'accountName',
        'currency',e->'currency','status',null,
        'values',coalesce(v_payload->'entityValues'->((e->>'accountId')||':'||(e->>'key')),'{}'))
        order by e->>'name'),'[]')
        from jsonb_array_elements(coalesce(v_payload->'entityCatalog','[]')) e
        where e->>'level'='campaign'));
  end if;
  return v_data;
end;
$$;
revoke all on function private.enrich_dashboard_scope(jsonb,uuid,date,date,uuid[],text[]) from public,anon,authenticated,service_role;

-- Reports generated from this audited contract remain publishable and readable.
create or replace function private.report_contract_confirmed(p_configuration jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_configuration->>'snapshot_version'~'^[0-9]+$'
    and (p_configuration->>'snapshot_version')::integer>=5
    and p_configuration->'analytics'->'metaAggregate'->>'confirmed'='true'
    and p_configuration->'analytics'->'metaAggregate'->>'version'='11',false);
$$;
revoke all on function private.report_contract_confirmed(jsonb) from public,anon,authenticated,service_role;




