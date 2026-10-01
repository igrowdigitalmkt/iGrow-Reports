-- Mixed Meta account timezones are allowed for calendar-date reporting.
-- Different currencies remain incompatible. When multiple timezone names are present,
-- compatibility_issue is kept as an informational warning while data_status remains ok.

create or replace function public.get_client_portal_data_context(p_client_id uuid)
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
  select c.agency_id, a.timezone
    into v_agency_id, v_timezone
  from public.clients c
  join public.agencies a on a.id = c.agency_id
  where c.id = p_client_id;

  if v_agency_id is null then
    raise exception 'Cliente indisponivel.' using errcode = '22023';
  end if;

  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id, p_client_id) then
    raise exception 'Sem permissao para consultar o contexto de dados.' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(distinct a.currency)::integer,
    count(distinct a.timezone_name)::integer,
    min(a.currency)
  into
    v_account_count, v_currency_count, v_timezone_count, v_currency
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
  else
    v_status := 'ok';
    if v_timezone_count > 1 then
      v_issue := 'multiple_timezones';
    end if;

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

create or replace function public.get_client_portal_metric_summary(
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
    raise exception 'Periodo invalido.' using errcode = '22023';
  end if;

  select c.agency_id, a.timezone
    into v_agency_id, v_timezone
  from public.clients c
  join public.agencies a on a.id = c.agency_id
  where c.id = p_client_id;

  if v_agency_id is null then
    raise exception 'Cliente indisponivel.' using errcode = '22023';
  end if;

  if private.agency_role(v_agency_id) is null
    and not private.has_client_access(v_agency_id, p_client_id) then
    raise exception 'Sem permissao para consultar metricas do cliente.' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(distinct a.currency)::integer,
    count(distinct a.timezone_name)::integer,
    min(a.currency)
  into
    v_account_count, v_currency_count, v_timezone_count, v_currency
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
  else
    if v_timezone_count > 1 then
      v_issue := 'multiple_timezones';
    end if;

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
      if v_issue is null then v_issue := 'no_insights'; end if;
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

revoke all on function public.get_client_portal_data_context(uuid),
  public.get_client_portal_metric_summary(uuid,date,date)
from public, anon, authenticated, service_role;

grant execute on function public.get_client_portal_data_context(uuid),
  public.get_client_portal_metric_summary(uuid,date,date)
to authenticated;
