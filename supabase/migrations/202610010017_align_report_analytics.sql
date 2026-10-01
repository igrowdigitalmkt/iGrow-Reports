-- Report snapshots must use the same account scope and coverage guarantees as
-- the interactive dashboard. Legacy rows alone never prove a complete period.
create or replace function public.get_client_portal_data_context(p_client_id uuid)
returns table(
  client_id uuid,data_status text,compatibility_issue text,currency text,
  timezone_name text,ad_account_count integer,latest_data_date date
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_agency uuid; v_agency_timezone text; v_accounts uuid[];
  v_currency text; v_timezone text; v_currencies integer; v_timezones integer;
  v_count integer; v_latest date; v_status text; v_issue text;
begin
  select c.agency_id,a.timezone into v_agency,v_agency_timezone
  from public.clients c join public.agencies a on a.id=c.agency_id where c.id=p_client_id;
  if v_agency is null or (private.agency_role(v_agency) is null
    and not private.has_client_access(v_agency,p_client_id)) then
    raise exception 'Sem permissão para consultar o contexto deste cliente.' using errcode='42501';
  end if;
  select coalesce(array_agg(a.id),'{}'::uuid[]),count(*)::integer,
    count(distinct a.currency)::integer,count(distinct a.timezone_name)::integer,
    min(a.currency),min(a.timezone_name)
  into v_accounts,v_count,v_currencies,v_timezones,v_currency,v_timezone
  from public.client_ad_accounts ca
  join public.meta_ad_accounts a on a.agency_id=ca.agency_id and a.id=ca.ad_account_id
  join public.meta_connections mc on mc.agency_id=a.agency_id and mc.id=a.meta_connection_id
  where ca.agency_id=v_agency and ca.client_id=p_client_id and ca.active
    and a.archived_at is null and a.business_id~'^[0-9]+$' and mc.client_id=p_client_id;
  if v_count=0 then
    v_status:='no_accounts';v_issue:='no_ad_accounts';v_timezone:=null;v_currency:=null;
  elsif v_currencies<>1 then
    v_status:='incompatible';v_issue:='multiple_currencies';v_currency:=null;
  else
    v_status:='ok';
    if v_timezones>1 then v_issue:='multiple_timezones'; end if;
  end if;
  if v_timezones>1 then v_timezone:=v_agency_timezone; end if;
  select max(i.insight_date) into v_latest from public.meta_daily_insights i
  where i.agency_id=v_agency and i.ad_account_id=any(v_accounts) and i.level='account';
  return query select p_client_id,v_status,v_issue,v_currency,v_timezone,v_count,v_latest;
end;
$$;

create or replace function public.get_client_portal_metric_summary(
  p_client_id uuid,p_date_from date,p_date_to date
)
returns table(
  client_id uuid,date_from date,date_to date,data_status text,compatibility_issue text,
  currency text,timezone_name text,ad_account_count integer,spend numeric,impressions bigint,
  link_clicks bigint,primary_metric_key text,primary_results numeric,attributed_revenue numeric,
  ctr_link numeric,cpc_link numeric,cpm numeric,cost_per_result numeric,roas numeric,latest_data_date date
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_data jsonb; v_summary jsonb; v_context record; v_status text; v_issue text; v_latest date;
begin
  -- The dashboard RPC validates dates, authenticates, and limits every underlying
  -- row to eligible accounts from this client's own Meta connection.
  v_data:=public.get_client_analytics(p_client_id,p_date_from,p_date_to,null);
  select * into v_context from public.get_client_portal_data_context(p_client_id);
  v_summary:=v_data->'summary';
  if v_context.ad_account_count=0 then
    v_status:='no_accounts';v_issue:='no_ad_accounts';
  elsif v_context.data_status='incompatible' then
    v_status:='incompatible';v_issue:=v_context.compatibility_issue;
  elsif v_data->'coverage'->>'status'='complete' then
    v_status:='ok';v_issue:=v_context.compatibility_issue;
  elsif v_data->'coverage'->>'status'='partial' then
    v_status:='partial';v_issue:='incomplete_collection';
  else
    v_status:='no_data';v_issue:='no_insights';
  end if;
  -- An unfinished local day cannot be frozen as a complete report, even if an
  -- operational caller prematurely marked a collection run complete.
  if v_status='ok' and exists (
    select 1 from jsonb_array_elements(v_data->'accounts') a
    where p_date_to >= (now() at time zone (a->>'timezoneName'))::date
  ) then
    v_status:='partial';v_issue:='day_incomplete';
  end if;
  select max((d->>'date')::date) into v_latest from jsonb_array_elements(v_data->'daily') d
    where d->'values'->>'impressions' is not null;
  return query select p_client_id,p_date_from,p_date_to,v_status,v_issue,
    v_context.currency,v_context.timezone_name,v_context.ad_account_count,
    (v_summary->>'spend')::numeric,(v_summary->>'impressions')::bigint,
    (v_summary->>'link_clicks')::bigint,v_data->>'primaryMetricKey',
    (v_summary->>'primary_results')::numeric,(v_summary->>'attributed_revenue')::numeric,
    (v_summary->>'ctr_link')::numeric,(v_summary->>'cpc_link')::numeric,
    (v_summary->>'cpm')::numeric,(v_summary->>'cost_per_result')::numeric,
    (v_summary->>'roas')::numeric,v_latest;
end;
$$;

-- The existing create_manual_report_version checks summary.data_status='ok'
-- inside its transaction. Returning partial above protects direct RPC callers
-- as well as the application's server action.
revoke all on function public.get_client_portal_data_context(uuid),
  public.get_client_portal_metric_summary(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_client_portal_data_context(uuid),
  public.get_client_portal_metric_summary(uuid,date,date) to authenticated;

-- Snapshot provenance follows the same eligible account scope as its totals.
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
    p_agency_id, array['owner','admin','editor']::public.agency_role[]
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
