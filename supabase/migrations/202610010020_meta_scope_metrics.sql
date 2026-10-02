-- Provider aggregates are retained at their exact account/entity/date scope.
-- Only the trusted collector may write them; users read through authorized RPCs.
create table public.meta_dashboard_scopes (
  agency_id uuid not null, client_id uuid not null, scope_key text not null,
  date_from date not null, date_to date not null, payload jsonb not null,
  collected_at timestamptz not null default now(),
  primary key(agency_id,client_id,scope_key,date_from,date_to),
  foreign key(agency_id,client_id) references public.clients(agency_id,id),
  check(length(scope_key)=32), check(date_to>=date_from and date_to-date_from<370)
);
alter table public.meta_dashboard_scopes enable row level security;
revoke all on public.meta_dashboard_scopes from public,anon,authenticated;
grant all on public.meta_dashboard_scopes to service_role;

create function private.enrich_dashboard_scope(p_data jsonb,p_client uuid,p_from date,p_to date,p_accounts uuid[],p_entities text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb; v_key text; v_agency uuid;
begin
  select agency_id into v_agency from public.clients where id=p_client;
  select md5(coalesce((select string_agg(a::text,',' order by a::text) from unnest(p_accounts) a),'')||'|'||
    coalesce((select string_agg(e,',' order by e) from unnest(p_entities) e),'')) into v_key;
  select payload into v_payload from public.meta_dashboard_scopes
    where agency_id=v_agency and client_id=p_client and scope_key=v_key and date_from=p_from and date_to=p_to;
  if v_payload is null then return p_data; end if;
  return p_data||jsonb_build_object('summary',coalesce(p_data->'summary','{}')||coalesce(v_payload->'summary','{}'),
    'previousSummary',coalesce(p_data->'previousSummary','{}')||coalesce(v_payload->'previousSummary','{}'),
    'metrics',(select coalesce(jsonb_agg(m order by m->>'key'),'[]') from (
      select distinct on(m->>'key') m from jsonb_array_elements(coalesce(p_data->'metrics','[]')||coalesce(v_payload->'metrics','[]')) m
      order by m->>'key',m->>'label'
    ) q));
end;
$$;
revoke all on function private.enrich_dashboard_scope(jsonb,uuid,date,date,uuid[],text[]) from public,anon,authenticated,service_role;

alter function public.get_client_analytics(uuid,date,date,uuid[]) set schema private;
alter function private.get_client_analytics(uuid,date,date,uuid[]) rename to client_analytics_base;
revoke all on function private.client_analytics_base(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
create function public.get_client_analytics(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb; v_accounts uuid[];
begin
  v_data:=private.client_analytics_base(p_client_id,p_date_from,p_date_to,p_ad_account_ids);
  select array_agg(id::uuid) into v_accounts from jsonb_array_elements_text(v_data->'selectedAccountIds') id;
  return private.enrich_dashboard_scope(v_data,p_client_id,p_date_from,p_date_to,v_accounts,'{}');
end;
$$;
revoke all on function public.get_client_analytics(uuid,date,date,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_client_analytics(uuid,date,date,uuid[]) to authenticated;

alter function public.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]) set schema private;
alter function private.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]) rename to campaign_analytics_base;
revoke all on function private.campaign_analytics_base(uuid,date,date,uuid[],text[]) from public,anon,authenticated,service_role;
create function public.get_campaign_scoped_analytics(p_client_id uuid,p_date_from date,p_date_to date,p_ad_account_ids uuid[],p_entity_keys text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_data jsonb;
begin
  v_data:=private.campaign_analytics_base(p_client_id,p_date_from,p_date_to,p_ad_account_ids,p_entity_keys);
  return private.enrich_dashboard_scope(v_data,p_client_id,p_date_from,p_date_to,p_ad_account_ids,p_entity_keys);
end;
$$;
revoke all on function public.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_campaign_scoped_analytics(uuid,date,date,uuid[],text[]) to authenticated;
