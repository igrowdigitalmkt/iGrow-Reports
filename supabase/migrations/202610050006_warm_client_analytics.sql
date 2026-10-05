-- Lets the daily job pre-compute the standard dashboard periods right after the
-- collection, so even the first view of the day is served from
-- private.client_analytics_cache. Only the service key may call it. It runs the
-- regular, authorized path (private.client_analytics_base) as the agency owner of
-- that client, then restores the caller identity; nothing is returned to the
-- caller besides whether a result is stored.
create function public.warm_client_analytics(p_client_id uuid,p_date_from date,p_date_to date)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_owner uuid; v_previous text:=current_setting('request.jwt.claim.sub',true); v_payload jsonb;
begin
  select au.user_id into v_owner
  from public.clients c join public.agency_users au on au.agency_id=c.agency_id
  where c.id=p_client_id and c.archived_at is null and au.role='owner'
  order by au.created_at, au.user_id limit 1;
  if v_owner is null then return false; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  begin
    v_payload:=private.client_analytics_base(p_client_id,p_date_from,p_date_to,null);
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(v_previous,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous,''),true);
  return v_payload is not null;
end;
$$;
revoke all on function public.warm_client_analytics(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.warm_client_analytics(uuid,date,date) to service_role;
