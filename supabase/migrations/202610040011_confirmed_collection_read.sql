-- Authenticated DTO: exact scope/version, last confirmed snapshot, no raw payloads.
create function public.get_confirmed_collection_snapshot(
  p_client_id uuid,p_connection_id uuid,p_provider text,p_external_account_id text,
  p_date_from date,p_date_to date,p_entity_level text,p_api_version text,p_contract_version integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_agency uuid;v_result jsonb;
begin
  select agency_id into v_agency from public.clients where id=p_client_id and archived_at is null;
  if v_agency is null or not (
    private.has_client_access(v_agency,p_client_id)
    or private.has_agency_role(v_agency,array['owner','admin','editor','viewer']::public.agency_role[])
  ) then
    raise exception 'Sem permissão para consultar a coleta.' using errcode='42501';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from
    or p_entity_level is null or p_entity_level not in ('account','campaign','adset','ad')
    or p_contract_version is null or p_contract_version<1 then
    raise exception 'Escopo de consulta inválido.' using errcode='22023';
  end if;
  -- Removed account links stop authorizing new reads, while token expiry does
  -- not hide previously confirmed performance from an otherwise authorized client.
  if p_provider='meta' and not exists (
    select 1 from public.meta_connections mc
    join public.meta_ad_accounts a on a.agency_id=mc.agency_id and a.meta_connection_id=mc.id
    join public.client_ad_accounts ca on ca.agency_id=mc.agency_id and ca.ad_account_id=a.id
    where mc.id=p_connection_id and mc.agency_id=v_agency and mc.client_id=p_client_id
      and ca.client_id=p_client_id and ca.active and a.external_id=p_external_account_id
      and a.archived_at is null
  ) then
    raise exception 'Conta fora do escopo de leitura.' using errcode='42501';
  end if;
  select jsonb_build_object('snapshotId',s.id,'collectedAt',s.collected_at,'metrics',s.payload->'metrics')
  into v_result
  from public.integration_snapshots s join public.integration_collection_jobs j on j.id=s.job_id
  where s.client_id=p_client_id and s.provider=p_provider and s.external_account_id=p_external_account_id
    and s.date_from=p_date_from and s.date_to=p_date_to and s.entity_level=p_entity_level
    and s.status='confirmed' and j.client_id=p_client_id and j.connection_id=p_connection_id
    and j.provider=p_provider and j.external_account_id=p_external_account_id
    and j.date_from=p_date_from and j.date_to=p_date_to and j.entity_level=p_entity_level
    and j.api_version=p_api_version and j.contract_version=p_contract_version
  order by s.collected_at desc,s.created_at desc,s.id desc limit 1;
  return v_result;
end;
$$;
revoke all on function public.get_confirmed_collection_snapshot(uuid,uuid,text,text,date,date,text,text,integer) from public,anon;
grant execute on function public.get_confirmed_collection_snapshot(uuid,uuid,text,text,date,date,text,text,integer) to authenticated;
