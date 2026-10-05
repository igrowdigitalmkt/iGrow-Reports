-- Authenticated catalog for snapshot reads; no credentials or connection metadata.
create function public.list_client_snapshot_accounts(p_client_id uuid)
returns table(id uuid,connection_id uuid,external_id text,name text,currency text,timezone_name text)
language plpgsql stable security definer set search_path='' as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.clients where clients.id=p_client_id and archived_at is null;
  if v_agency is null or not (
    private.has_client_access(v_agency,p_client_id)
    or private.has_agency_role(v_agency,array['owner','admin','editor','viewer']::public.agency_role[])
  ) then
    raise exception 'Sem permissão para consultar as contas.' using errcode='42501';
  end if;
  return query select a.id,mc.id,a.external_id,a.name,a.currency,a.timezone_name
    from public.meta_connections mc
    join public.meta_ad_accounts a on a.agency_id=mc.agency_id and a.meta_connection_id=mc.id
    join public.client_ad_accounts ca on ca.agency_id=mc.agency_id and ca.ad_account_id=a.id
    where mc.agency_id=v_agency and mc.client_id=p_client_id and ca.client_id=p_client_id
      and ca.active and a.archived_at is null
    order by a.name,a.id;
end;
$$;
revoke all on function public.list_client_snapshot_accounts(uuid) from public,anon;
grant execute on function public.list_client_snapshot_accounts(uuid) to authenticated;
