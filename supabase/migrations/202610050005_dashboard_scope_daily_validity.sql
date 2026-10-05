-- Exact-period Meta aggregates are refreshed with the daily collection
-- (src/modules/meta/daily-refresh.ts). Keep serving them for 24 hours instead of
-- one; a newer daily collection for the same accounts still invalidates them
-- immediately, exactly as before.
create or replace function private.valid_dashboard_scope(p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language sql stable security definer set search_path='' as $$
  select s.payload||jsonb_build_object('_collectedAt',s.collected_at)
  from public.meta_dashboard_scopes s
  join public.clients c on c.agency_id=s.agency_id and c.id=s.client_id
  where s.client_id=p_client and s.date_from=p_from and s.date_to=p_to
    and s.scope_key=md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(p_accounts) a),'')||'|'||
      coalesce((select string_agg(e,',' order by e) from unnest(p_entities) e),''))
    and s.payload->>'version'='11' and s.collected_at>=now()-interval '24 hours'
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
