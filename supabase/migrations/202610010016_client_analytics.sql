-- One authorized read model is shared by the agency and the client's portal.
-- Account totals and campaign detail remain independent grains. Daily reach is
-- never summed into period reach, and different currencies are never added.
create function private.analytics_values(
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
    case when p_primary_action is not null then sum(coalesce((r->'actions'->>p_primary_action)::numeric,0)) end,
    case when p_revenue_action is not null then sum((r->'revenues'->>p_revenue_action)::numeric) end
  into v_count,v_spend,v_impressions,v_links,v_results,v_revenue
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
  if v_count=0 and p_complete then
    v_spend:=0; v_impressions:=0; v_links:=0;
    if p_primary_action is not null then v_results:=0; end if;
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
  if p_primary_key is not null then
    v_values:=v_values||jsonb_build_object(p_primary_key,v_results);
  end if;
  foreach v_key in array array['clicks','inline_post_engagement','outbound_clicks',
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
  return v_values;
end;
$$;
revoke all on function private.analytics_values(jsonb,text,text,text,text[],boolean,boolean,jsonb)
  from public,anon,authenticated,service_role;

create function public.get_client_analytics(
  p_client_id uuid, p_date_from date, p_date_to date, p_ad_account_ids uuid[] default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_agency uuid; v_accounts uuid[]; v_all_accounts jsonb;
  v_currency text; v_timezone text; v_currencies integer; v_timezones integer;
  v_primary_key text; v_primary_action text; v_revenue_action text;
  v_days integer; v_previous_from date; v_previous_to date; v_payload jsonb;
  v_warnings text[]:='{}'::text[];
begin
  if p_client_id is null or p_date_from is null or p_date_to is null
    or p_date_to<p_date_from or p_date_to-p_date_from>=370 then
    raise exception 'Período inválido. Selecione até 370 dias.' using errcode='22023';
  end if;
  select c.agency_id into v_agency from public.clients c where c.id=p_client_id;
  if v_agency is null or (private.agency_role(v_agency) is null
    and not private.has_client_access(v_agency,p_client_id)) then
    raise exception 'Sem permissão para consultar este cliente.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'externalId',a.external_id,
      'currency',a.currency,'timezoneName',a.timezone_name) order by a.name,a.id),'[]'::jsonb),
    coalesce(array_agg(a.id),'{}'::uuid[])
  into v_all_accounts,v_accounts
  from public.client_ad_accounts ca
  join public.meta_ad_accounts a on a.agency_id=ca.agency_id and a.id=ca.ad_account_id
  join public.meta_connections mc on mc.agency_id=a.agency_id and mc.id=a.meta_connection_id
  where ca.agency_id=v_agency and ca.client_id=p_client_id and ca.active
    and a.archived_at is null and a.business_id~'^[0-9]+$' and mc.client_id=p_client_id;
  if p_ad_account_ids is not null then
    if cardinality(p_ad_account_ids)=0 or not p_ad_account_ids<@v_accounts
      or array_position(p_ad_account_ids,null) is not null then
      raise exception 'Conta de anúncios indisponível para este cliente.' using errcode='42501';
    end if;
    select array_agg(distinct id) into v_accounts from unnest(p_ad_account_ids) id;
  end if;
  select count(distinct a.currency),count(distinct a.timezone_name),min(a.currency),min(a.timezone_name)
    into v_currencies,v_timezones,v_currency,v_timezone
  from public.meta_ad_accounts a where a.agency_id=v_agency and a.id=any(v_accounts);
  if v_currencies>1 then
    v_currency:=null;
    v_warnings:=array_append(v_warnings,'As contas usam moedas diferentes. Valores monetários são apresentados por conta; selecione uma moeda para consolidar.');
  end if;
  if v_timezones>1 then
    v_timezone:=null;
    v_warnings:=array_append(v_warnings,'As contas usam fusos diferentes. Cada dia respeita o fuso da conta na Meta; isso não bloqueia a consulta.');
  end if;
  if cardinality(v_accounts)>1 then
    v_warnings:=array_append(v_warnings,'Alcance, frequência e cliques únicos ficam disponíveis ao selecionar uma conta, pois pessoas podem aparecer em várias contas.');
  end if;
  if cardinality(v_accounts)=0 then
    v_warnings:=array_append(v_warnings,'Nenhuma conta ativa com portfólio empresarial está vinculada à conexão Meta deste cliente.');
  end if;
  select primary_metric_key,primary_action_type,revenue_action_type
    into v_primary_key,v_primary_action,v_revenue_action
  from public.client_metric_mappings where agency_id=v_agency and client_id=p_client_id;
  if v_primary_action is null then
    v_warnings:=array_append(v_warnings,'Defina o resultado principal do cliente para acompanhar conversões e custo por resultado.');
  end if;
  v_days:=p_date_to-p_date_from+1;
  v_previous_to:=p_date_from-1; v_previous_from:=p_date_from-v_days;

  with
  periods as (
    select 'current'::text as label,p_date_from as first_date,p_date_to as last_date
    union all select 'previous',v_previous_from,v_previous_to
  ),
  insights as materialized (
    select i.*,p.label,
      jsonb_build_object(
        'spend',i.spend,'impressions',i.impressions,'link_clicks',i.link_clicks,
        'reach',i.reach,'actions',coalesce(ac.actions,'{}'::jsonb),
        'revenues',coalesce(ac.revenues,'{}'::jsonb),
        'clicks',i.metadata->'clicks','inline_post_engagement',i.metadata->'inline_post_engagement',
        'outbound_clicks',i.metadata->'outbound_clicks','video_plays',i.metadata->'video_play_actions',
        'video_p25',i.metadata->'video_p25_watched_actions','video_p50',i.metadata->'video_p50_watched_actions',
        'video_p75',i.metadata->'video_p75_watched_actions','video_p95',i.metadata->'video_p95_watched_actions',
        'video_p100',i.metadata->'video_p100_watched_actions'
      ) as value_row
    from public.meta_daily_insights i join periods p on i.insight_date between p.first_date and p.last_date
    left join lateral (
      select jsonb_object_agg(a.action_type,a.action_value) as actions,
        jsonb_object_agg(a.action_type,a.value_amount) filter (where a.value_amount is not null) as revenues
      from public.meta_daily_actions a
      where a.agency_id=i.agency_id and a.ad_account_id=i.ad_account_id
        and a.insight_date=i.insight_date and a.level=i.level and a.external_entity_id=i.external_entity_id
    ) ac on true
    where i.agency_id=v_agency and i.ad_account_id=any(v_accounts) and i.level in ('account','campaign')
  ),
  action_catalog as (
    select coalesce(array_agg(distinct action_type),'{}'::text[]) as keys
    from insights i cross join lateral jsonb_object_keys(i.value_row->'actions') action_type
  ),
  account_days as materialized (
    select p.label,a.id as account_id,d::date as day,
      exists(select 1 from public.meta_collection_runs r
        where r.agency_id=v_agency and r.client_id=p_client_id and r.ad_account_id=a.id
          and r.status='complete' and r.levels@>array['account']::text[]
          and d::date between r.date_from and r.date_to) as covered
    from periods p cross join public.meta_ad_accounts a
    cross join lateral generate_series(p.first_date::timestamp,p.last_date::timestamp,interval '1 day') d
    where a.agency_id=v_agency and a.id=any(v_accounts)
  ),
  day_coverage as (
    select label,day,bool_and(covered) as covered from account_days group by label,day
  ),
  coverage as (
    select p.label,
      (select count(*)::integer from day_coverage d where d.label=p.label and d.covered) as covered_days,
      case when cardinality(v_accounts)>0 and
        (select count(*) from day_coverage d where d.label=p.label and d.covered)=v_days then 'complete'
      when exists(select 1 from insights i where i.label=p.label and i.level='account')
        or exists(select 1 from day_coverage d where d.label=p.label and d.covered) then 'partial'
      else 'empty' end as status
    from periods p
  ),
  unique_period as (
    select p.label,jsonb_build_object('reach',pi.reach,'frequency',pi.frequency,'unique_clicks',pi.unique_clicks) as metric_values
    from periods p join public.meta_period_insights pi
      on pi.agency_id=v_agency and pi.client_id=p_client_id and pi.ad_account_id=any(v_accounts)
      and pi.date_from=p.first_date and pi.date_to=p.last_date
    where cardinality(v_accounts)=1
  ),
  summaries as (
    select p.label,private.analytics_values(
      (select jsonb_agg(i.value_row) from insights i where i.label=p.label and i.level='account'),
      v_primary_key,v_primary_action,v_revenue_action,cat.keys,c.status='complete',v_currencies<=1,
      (select u.metric_values from unique_period u where u.label=p.label)
    ) as metric_values
    from periods p join coverage c on c.label=p.label cross join action_catalog cat
  ),
  daily as (
    select dc.label,dc.day,private.analytics_values(
      jsonb_agg(i.value_row) filter(where i.level='account'),
      v_primary_key,v_primary_action,v_revenue_action,cat.keys,dc.covered,v_currencies<=1,
      case when cardinality(v_accounts)=1 then jsonb_build_object(
        'reach',max(i.reach) filter(where i.level='account'),
        'frequency',max((i.metadata->>'frequency')::numeric) filter(where i.level='account'),
        'unique_clicks',max((i.metadata->>'unique_clicks')::numeric) filter(where i.level='account')) end
    ) as metric_values
    from day_coverage dc left join insights i on i.label=dc.label and i.insight_date=dc.day and i.level='account'
    cross join action_catalog cat
    group by dc.label,dc.day,dc.covered,cat.keys
    having dc.covered or count(i.ad_account_id)>0
  ),
  account_totals as (
    select a.id,a.name,a.currency,private.analytics_values(
      (select jsonb_agg(i.value_row) from insights i where i.label='current' and i.level='account' and i.ad_account_id=a.id),
      v_primary_key,v_primary_action,v_revenue_action,cat.keys,
      (select bool_and(d.covered) from account_days d where d.label='current' and d.account_id=a.id),true,
      (select jsonb_build_object('reach',pi.reach,'frequency',pi.frequency,'unique_clicks',pi.unique_clicks)
        from public.meta_period_insights pi where pi.agency_id=v_agency and pi.client_id=p_client_id
          and pi.ad_account_id=a.id and pi.date_from=p_date_from and pi.date_to=p_date_to)
    ) as metric_values
    from public.meta_ad_accounts a cross join action_catalog cat
    where a.agency_id=v_agency and a.id=any(v_accounts)
  ),
  campaigns as (
    select i.external_entity_id as id,coalesce(max(i.entity_name),i.external_entity_id) as name,
      i.ad_account_id as account_id,a.name as account_name,a.currency,
      (array_agg(i.captured_status order by i.insight_date desc))[1] as status,
      private.analytics_values(jsonb_agg(i.value_row),v_primary_key,v_primary_action,v_revenue_action,
        cat.keys,false,true) as metric_values
    from insights i join public.meta_ad_accounts a on a.agency_id=i.agency_id and a.id=i.ad_account_id
    cross join action_catalog cat where i.label='current' and i.level='campaign'
    group by i.external_entity_id,i.ad_account_id,a.name,a.currency,cat.keys
  ),
  extras(key,label,unit,precision,desirable,rank) as (values
    ('primary_results','Resultados principais','integer',0,'up',4),
    ('reach','Alcance no período','integer',0,'up',15),('frequency','Frequência','ratio',2,'neutral',16),
    ('unique_clicks','Cliques únicos','integer',0,'up',17),
    ('clicks','Todos os cliques','integer',0,'up',18),('inline_post_engagement','Engajamentos','integer',0,'up',19),
    ('outbound_clicks','Cliques de saída','integer',0,'up',20),('video_plays','Reproduções de vídeo','integer',0,'up',21),
    ('video_p25','Vídeo · 25%','integer',0,'up',22),('video_p50','Vídeo · 50%','integer',0,'up',23),
    ('video_p75','Vídeo · 75%','integer',0,'up',24),('video_p95','Vídeo · 95%','integer',0,'up',25),
    ('video_p100','Vídeo · 100%','integer',0,'up',26)
  ),
  metrics as (
    select md.key,md.label,md.unit,md.display_precision::integer as precision,md.desirable_direction as desirable,
      case md.key when 'spend' then 1 when 'impressions' then 2 when 'link_clicks' then 3
        when 'ctr_link' then 5 when 'cpc_link' then 6 when 'cpm' then 7 when 'cost_per_result' then 8
        when 'attributed_revenue' then 9 when 'roas' then 10 else 11 end as rank
    from public.metric_definitions md where md.active and md.key not in ('leads','conversations','purchases')
    union all select e.key,
      case when e.key='primary_results' then coalesce(
        (select md.label from public.metric_definitions md where md.key=v_primary_key),e.label
      ) else e.label end,e.unit,e.precision,e.desirable,e.rank from extras e
    union all select 'action:'||action_type,
      case action_type when 'landing_page_view' then 'Visualizações da página de destino'
        when 'lead' then 'Leads · Meta' when 'omni_purchase' then 'Compras · Meta'
        when 'onsite_conversion.messaging_conversation_started_7d' then 'Conversas iniciadas · Meta'
        when 'post_engagement' then 'Engajamentos na publicação · Meta'
        when 'video_view' then 'Visualizações de vídeo · Meta'
        else replace(action_type,'_',' ') end,'integer',0,'up',30
    from action_catalog cross join lateral unnest(keys) action_type
  )
  select jsonb_build_object(
    'dateFrom',p_date_from,'dateTo',p_date_to,'previousDateFrom',v_previous_from,'previousDateTo',v_previous_to,
    'currency',v_currency,'timezoneName',v_timezone,'primaryMetricKey',v_primary_key,'primaryActionType',v_primary_action,
    'accounts',v_all_accounts,'selectedAccountIds',to_jsonb(v_accounts),
    'summary',(select metric_values from summaries where label='current'),
    'previousSummary',(select metric_values from summaries where label='previous'),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',day,'values',metric_values) order by day) from daily where label='current'),'[]'::jsonb),
    'previousDaily',coalesce((select jsonb_agg(jsonb_build_object('date',day,'values',metric_values) order by day) from daily where label='previous'),'[]'::jsonb),
    'accountTotals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'currency',currency,'values',metric_values) order by name) from account_totals),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'accountId',account_id,'accountName',account_name,'currency',currency,'status',status,'values',metric_values) order by (metric_values->>'spend')::numeric desc nulls last,name) from campaigns),'[]'::jsonb),
    'metrics',(select jsonb_agg(jsonb_build_object('key',key,'label',label,'unit',unit,'precision',precision,'desirable',desirable) order by rank,key) from metrics),
    'coverage',jsonb_build_object(
      'status',(select status from coverage where label='current'),
      'previousStatus',(select status from coverage where label='previous'),
      'coveredDays',(select covered_days from coverage where label='current'),
      'previousCoveredDays',(select covered_days from coverage where label='previous'),'totalDays',v_days,
      'latestCollectedAt',(select max(collected_at) from (
        select i.collected_at from insights i
        union all select r.collected_at from public.meta_collection_runs r
          where r.agency_id=v_agency and r.client_id=p_client_id and r.ad_account_id=any(v_accounts)
            and r.status='complete' and r.date_from<=p_date_to and r.date_to>=v_previous_from
      ) collected)
    ),'warnings',to_jsonb(v_warnings)
  ) into v_payload;
  if v_payload->'coverage'->>'status'='partial' then
    v_warnings:=array_append(v_warnings,'O período tem dados parciais. Atualize a coleta para completar os dias e as contas selecionadas.');
  end if;
  if v_payload->'coverage'->>'previousStatus'<>'complete' then
    v_warnings:=array_append(v_warnings,'A comparação anterior ainda não tem cobertura completa; variações não devem ser interpretadas como crescimento confirmado.');
  end if;
  if cardinality(v_accounts)=1 and v_payload->'summary'->>'reach' is null then
    v_warnings:=array_append(v_warnings,'Alcance e frequência do período dependem de uma consulta agregada para estas datas. Alcances diários não são somados.');
  end if;
  return v_payload||jsonb_build_object('warnings',to_jsonb(v_warnings));
end;
$$;
revoke all on function public.get_client_analytics(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_client_analytics(uuid,date,date,uuid[]) to authenticated;
