-- Revalidate authorization when queuing, collecting and persisting Meta jobs.
create function private.require_meta_collection_scope(p_client uuid,p_connection uuid,p_account text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_integration uuid;
begin
  select i.id into v_integration
  from public.clients c
  join public.meta_connections mc on mc.agency_id=c.agency_id and mc.client_id=c.id
  join public.integrations i on i.agency_id=mc.agency_id and i.id=mc.integration_id
  join public.meta_ad_accounts a on a.agency_id=mc.agency_id and a.meta_connection_id=mc.id
  join public.client_ad_accounts ca on ca.agency_id=c.agency_id and ca.client_id=c.id and ca.ad_account_id=a.id
  where c.id=p_client and c.archived_at is null and mc.id=p_connection
    and mc.connected_at is not null and i.provider='meta' and i.connection_status='connected'
    and a.external_id=p_account and a.archived_at is null and ca.active
    and nullif(btrim(a.business_id),'') is not null;
  if not found then
    raise exception 'Cliente, conexão ou conta sem autorização para coleta.' using errcode='42501';
  end if;
  return v_integration;
end;
$$;
revoke all on function private.require_meta_collection_scope(uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.guard_meta_collection_job_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='meta' then
    perform private.require_meta_collection_scope(new.client_id,new.connection_id,new.external_account_id);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_meta_collection_job_scope() from public,anon,authenticated,service_role;
create trigger guard_meta_collection_job_scope
  before insert or update of client_id,connection_id,provider,external_account_id on public.integration_collection_jobs
  for each row execute function private.guard_meta_collection_job_scope();

create function private.guard_meta_collection_snapshot_scope()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_connection uuid;
begin
  if new.provider='meta' then
    select connection_id into v_connection from public.integration_collection_jobs where id=new.job_id;
    perform private.require_meta_collection_scope(new.client_id,v_connection,new.external_account_id);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_meta_collection_snapshot_scope() from public,anon,authenticated,service_role;
create trigger guard_meta_collection_snapshot_scope before insert on public.integration_snapshots
  for each row execute function private.guard_meta_collection_snapshot_scope();

create function public.authorize_integration_collection_job(p_job_id uuid,p_attempt_count integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_job public.integration_collection_jobs;
begin
  select * into v_job from public.integration_collection_jobs where id=p_job_id for update;
  if not found or v_job.status<>'collecting' or v_job.attempt_count is distinct from p_attempt_count
    or v_job.started_at is null or v_job.started_at<=now()-interval '15 minutes' then
    raise exception 'Tentativa de coleta expirada ou já finalizada.' using errcode='40001';
  end if;
  if v_job.provider<>'meta' then
    raise exception 'Provedor sem autorização de coleta implementada.' using errcode='42501';
  end if;
  return private.require_meta_collection_scope(v_job.client_id,v_job.connection_id,v_job.external_account_id);
end;
$$;
revoke all on function public.authorize_integration_collection_job(uuid,integer) from public,anon,authenticated;
grant execute on function public.authorize_integration_collection_job(uuid,integer) to service_role;
