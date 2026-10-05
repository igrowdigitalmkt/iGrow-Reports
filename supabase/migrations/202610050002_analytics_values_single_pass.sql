-- Same contract as private.analytics_values in 202610030027_metric_integrity,
-- computed with one aggregate per group of indicators instead of one scan of
-- every row per indicator. The dashboard calls this once per day of both
-- periods, per account and per campaign, so the per-indicator scans dominated
-- long periods and timed out on small database instances.
create or replace function private.analytics_values(
  p_rows jsonb,p_primary_key text,p_primary_action text,p_revenue_action text,
  p_actions text[],p_complete boolean,p_money_compatible boolean,p_unique jsonb default null
) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_rows jsonb[]; v_count integer; v_native boolean; v_spend numeric; v_impressions numeric; v_links numeric;
  v_revenue numeric; v_values jsonb; v_scalars jsonb; v_actions jsonb; v_results jsonb; v_provider jsonb;
  v_empty_complete boolean;
begin
  select coalesce(array_agg(private.canonical_daily_row(r)),'{}') into v_rows
  from jsonb_array_elements(coalesce(p_rows,'[]')) r;
  v_count:=cardinality(v_rows);
  v_empty_complete:=v_count=0 and p_complete;

  select case when count(r->>'spend')=count(*) then sum((r->>'spend')::numeric) end,
    case when count(r->>'impressions')=count(*) then sum((r->>'impressions')::numeric) end,
    case when count(r->>'link_clicks')=count(*) then sum((r->>'link_clicks')::numeric) end,
    case when p_revenue_action is not null then sum((r->'revenues'->>p_revenue_action)::numeric) end,
    -- Every source must explicitly confirm Results; NULL counts as unconfirmed.
    v_count>0 and count(*) filter (where r->'provider_results'->>'result:provider_known' is distinct from '1')=0
    into v_spend,v_impressions,v_links,v_revenue,v_native
  from unnest(v_rows) r;
  if v_empty_complete then v_spend:=0;v_impressions:=0;v_links:=0;v_native:=true;end if;
  if not p_money_compatible then v_spend:=null;v_revenue:=null;end if;

  -- Additive indicators: summed only when every row reports them.
  select jsonb_object_agg(k.key,case when v_empty_complete then 0 else s.amount end) into v_scalars
  from unnest(array['instagram_profile_visits','clicks','inline_post_engagement','outbound_clicks',
    'video_plays','video_p25','video_p50','video_p75','video_p95','video_p100']) k(key)
  left join lateral (
    select case when count(r->>k.key)=count(*) then sum((r->>k.key)::numeric) end amount from unnest(v_rows) r
  ) s on true;

  -- Actions: a row without the action counts as zero only if its actions were confirmed.
  select coalesce(jsonb_object_agg('action:'||k.key,a.amount)||jsonb_object_agg('cost:action:'||k.key,v_spend/nullif(a.amount,0)),'{}')
    into v_actions
  from unnest(coalesce(p_actions,'{}'::text[])) k(key)
  cross join lateral (
    select case when v_empty_complete then 0
      when bool_and(r->'actions'->>k.key is not null or coalesce(r->>'actions_confirmed'='true',false))
      then sum(coalesce((r->'actions'->>k.key)::numeric,0)) end amount
    from unnest(v_rows) r
  ) a;

  select jsonb_object_agg(k.key,s.amount) into v_results
  from unnest(array['result:messages','result:profile_visits','result:leads','result:registrations','result:purchases']) k(key)
  left join lateral (
    select case when count(r->>k.key)=count(*) then sum((r->>k.key)::numeric) end amount from unnest(v_rows) r
  ) s on true;

  v_values:=jsonb_build_object('spend',v_spend,'impressions',v_impressions,'link_clicks',v_links,
    'attributed_revenue',v_revenue,'ctr_link',v_links/nullif(v_impressions,0)*100,
    'cpc_link',v_spend/nullif(v_links,0),'cpm',v_spend/nullif(v_impressions,0)*1000,
    'roas',v_revenue/nullif(v_spend,0),'reach',p_unique->'reach','frequency',p_unique->'frequency','unique_clicks',p_unique->'unique_clicks')
    ||v_scalars||v_actions||v_results;

  if v_native then
    select coalesce(jsonb_object_agg(key,amount),'{}') into v_provider from (
      select e.key,sum(e.value::text::numeric) amount
      from unnest(v_rows) r
      cross join lateral jsonb_each(case when jsonb_typeof(r->'provider_results')='object' then r->'provider_results' else '{}' end) e
      where e.key like 'result:provider:%' and e.value<>'null'::jsonb group by e.key
    ) q;
    v_values:=v_values||v_provider||jsonb_build_object('result:provider_known',1);
  end if;
  return private.result_values(v_values,p_complete);
end;
$$;
revoke all on function private.analytics_values(jsonb,text,text,text,text[],boolean,boolean,jsonb) from public,anon,authenticated,service_role;
