-- Store each computed dashboard period (client, dates, accounts) and serve it
-- again while the data it depends on is unchanged. The computation itself is
-- untouched (renamed to client_analytics_compute); results are identical by
-- construction. Daily rows are only rewritten by collection, so after the first
-- view a period costs a cheap fingerprint read instead of a full recomputation.
--
-- Fingerprint: physical row versions (ctid, xmin) of the large inputs — any
-- insert, update or delete changes them, including several changes inside one
-- transaction — and the full text of the small inputs.
--
-- Note for future migrations: the computation now lives in
-- private.client_analytics_compute; private.client_analytics_base is the cache.

create table private.client_analytics_cache (
  client_id uuid not null,
  date_from date not null,
  date_to date not null,
  accounts_key text not null,
  fingerprint text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (client_id, date_from, date_to, accounts_key)
);
create index client_analytics_cache_age_idx on private.client_analytics_cache(client_id, computed_at);
revoke all on table private.client_analytics_cache from public, anon, authenticated, service_role;

alter function private.client_analytics_base(uuid,date,date,uuid[]) rename to client_analytics_compute;
revoke all on function private.client_analytics_compute(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;

create function private.client_analytics_fingerprint(p_agency uuid,p_client uuid,p_accounts uuid[],p_from date,p_to date)
returns text language sql stable security definer set search_path='' as $$
  select md5(concat_ws('|','client-analytics-cache-v1',
    (select count(*)||':'||md5(coalesce(string_agg(i.ctid::text||i.xmin::text,',' order by i.ctid),''))
      from public.meta_daily_insights i
      where i.agency_id=p_agency and i.ad_account_id=any(p_accounts)
        and i.insight_date between p_from and p_to and i.level in ('account','campaign')),
    (select count(*)||':'||md5(coalesce(string_agg(a.ctid::text||a.xmin::text,',' order by a.ctid),''))
      from public.meta_daily_actions a
      where a.agency_id=p_agency and a.ad_account_id=any(p_accounts)
        and a.insight_date between p_from and p_to and a.level in ('account','campaign')),
    (select md5(coalesce(string_agg(r::text,',' order by r::text),'')) from public.meta_collection_runs r
      where r.agency_id=p_agency and r.client_id=p_client),
    (select md5(coalesce(string_agg(p::text,',' order by p::text),'')) from public.meta_period_insights p
      where p.agency_id=p_agency and p.client_id=p_client),
    (select md5(coalesce(string_agg(m::text,','),'')) from public.client_metric_mappings m
      where m.agency_id=p_agency and m.client_id=p_client),
    (select md5(coalesce(string_agg(x,',' order by x),'')) from (
      select ca::text x from public.client_ad_accounts ca where ca.agency_id=p_agency and ca.client_id=p_client
      union all select concat_ws(',',a.id,a.name,a.external_id,a.currency,a.timezone_name,a.business_id,a.archived_at,a.meta_connection_id)
        from public.meta_ad_accounts a join public.client_ad_accounts ca on ca.agency_id=a.agency_id and ca.ad_account_id=a.id
        where ca.agency_id=p_agency and ca.client_id=p_client
      union all select concat_ws(',',mc.id,mc.client_id) from public.meta_connections mc where mc.agency_id=p_agency
    ) s),
    (select md5(coalesce(string_agg(d::text,',' order by d.key),'')) from public.metric_definitions d),
    -- A migration that changes the computation invalidates every stored period.
    (select md5(string_agg(p.prosrc,',' order by p.proname)) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname in ('client_analytics_compute','analytics_values',
        'canonical_daily_row','result_values','provider_result_family'))));
$$;
revoke all on function private.client_analytics_fingerprint(uuid,uuid,uuid[],date,date) from public,anon,authenticated,service_role;

create function private.client_analytics_base(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[] default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_agency uuid; v_accounts uuid[]; v_key text; v_fingerprint text; v_payload jsonb;
begin
  -- Invalid periods, unauthorized callers and foreign accounts are rejected by the
  -- computation with its own errors; nothing is read from the cache for them.
  if p_client_id is null or p_date_from is null or p_date_to is null
    or p_date_to<p_date_from or p_date_to-p_date_from>=370 then
    return private.client_analytics_compute(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  end if;
  select c.agency_id into v_agency from public.clients c where c.id=p_client_id;
  if v_agency is null or (private.agency_role(v_agency) is null
    and not private.has_client_access(v_agency,p_client_id)) then
    return private.client_analytics_compute(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  end if;
  -- Same account scope as the computation.
  select coalesce(array_agg(a.id order by a.id),'{}'::uuid[]) into v_accounts
  from public.client_ad_accounts ca
  join public.meta_ad_accounts a on a.agency_id=ca.agency_id and a.id=ca.ad_account_id
  join public.meta_connections mc on mc.agency_id=a.agency_id and mc.id=a.meta_connection_id
  where ca.agency_id=v_agency and ca.client_id=p_client_id and ca.active
    and a.archived_at is null and a.business_id~'^[0-9]+$' and mc.client_id=p_client_id;
  if p_ad_account_ids is not null then
    if cardinality(p_ad_account_ids)=0 or not p_ad_account_ids<@v_accounts
      or array_position(p_ad_account_ids,null) is not null then
      return private.client_analytics_compute(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
    end if;
    select array_agg(distinct id order by id) into v_accounts from unnest(p_ad_account_ids) id;
  end if;
  v_key:=coalesce(array_to_string(v_accounts,','),'')||case when p_ad_account_ids is null then '|all' else '' end;
  v_fingerprint:=private.client_analytics_fingerprint(v_agency,p_client_id,v_accounts,
    p_date_from-(p_date_to-p_date_from+1),p_date_to);

  select c.payload into v_payload from private.client_analytics_cache c
  where c.client_id=p_client_id and c.date_from=p_date_from and c.date_to=p_date_to
    and c.accounts_key=v_key and c.fingerprint=v_fingerprint;
  if v_payload is not null then return v_payload; end if;

  v_payload:=private.client_analytics_compute(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  begin
    insert into private.client_analytics_cache(client_id,date_from,date_to,accounts_key,fingerprint,payload)
    values (p_client_id,p_date_from,p_date_to,v_key,v_fingerprint,v_payload)
    on conflict (client_id,date_from,date_to,accounts_key)
      do update set fingerprint=excluded.fingerprint,payload=excluded.payload,computed_at=now();
    -- Periods not viewed for a few days are dropped; they are recomputed on demand.
    delete from private.client_analytics_cache where client_id=p_client_id and computed_at<now()-interval '3 days';
  exception when read_only_sql_transaction then
    null; -- read-only callers still get the computed result, just not stored
  end;
  return v_payload;
end;
$$;
revoke all on function private.client_analytics_base(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;

-- The dashboard reads through this function; it may now store a computed period.
alter function public.get_client_analytics(uuid,date,date,uuid[]) volatile;
