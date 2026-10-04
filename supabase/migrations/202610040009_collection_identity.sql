-- Claims must preserve the exact API/normalization contract that was queued.
drop function public.claim_integration_collection_job(timestamptz);
drop function private.claim_integration_collection_job(timestamptz);
create function private.claim_integration_collection_job(p_now timestamptz default now())
returns table (job_id uuid, client_id uuid, connection_id uuid, idempotency_key text, provider text, external_account_id text, date_from date, date_to date, entity_level text, attempt_count integer, api_version text, contract_version integer)
language plpgsql security definer set search_path='' as $$
begin
  return query
  with candidate as (
    select j.id from public.integration_collection_jobs j
    where (j.status in ('queued','partial') and j.next_attempt_at<=p_now)
      or (j.status='collecting' and coalesce(j.started_at,j.updated_at)<=p_now-interval '15 minutes')
    order by j.priority,j.next_attempt_at,j.created_at
    for update skip locked limit 1
  ), claimed as (
    update public.integration_collection_jobs j
    set status='collecting',attempt_count=j.attempt_count+1,started_at=p_now,completed_at=null,updated_at=p_now
    from candidate c where j.id=c.id
    returning j.id,j.client_id,j.connection_id,j.idempotency_key,j.provider,j.external_account_id,
      j.date_from,j.date_to,j.entity_level,j.attempt_count,j.api_version,j.contract_version
  ) select * from claimed;
end;
$$;
create function public.claim_integration_collection_job(p_now timestamptz default now())
returns table (job_id uuid, client_id uuid, connection_id uuid, idempotency_key text, provider text, external_account_id text, date_from date, date_to date, entity_level text, attempt_count integer, api_version text, contract_version integer)
language sql security definer set search_path='' as $$
  select * from private.claim_integration_collection_job(p_now);
$$;
revoke all on function private.claim_integration_collection_job(timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.claim_integration_collection_job(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_integration_collection_job(timestamptz) to service_role;

-- The result envelope and every normalized metric must match the job's scope.
create function private.guard_integration_snapshot_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_job public.integration_collection_jobs;v_metrics jsonb;
begin
  select * into v_job from public.integration_collection_jobs where id=new.job_id;
  if not found or new.client_id is distinct from v_job.client_id
    or new.provider is distinct from v_job.provider
    or new.external_account_id is distinct from v_job.external_account_id
    or new.date_from is distinct from v_job.date_from or new.date_to is distinct from v_job.date_to
    or new.entity_level is distinct from v_job.entity_level then
    raise exception 'Snapshot fora do escopo do job.' using errcode='22023';
  end if;
  v_metrics:=coalesce(new.payload->'metrics','[]'::jsonb);
  if jsonb_typeof(v_metrics) is distinct from 'array' then
    raise exception 'Métricas normalizadas inválidas.' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_metrics) m
    where m->>'clientId' is distinct from v_job.client_id::text
      or m->>'connectionId' is distinct from v_job.connection_id::text
      or m->>'provider' is distinct from v_job.provider
      or m->>'externalAccountId' is distinct from v_job.external_account_id
      or m->>'dateFrom' is distinct from v_job.date_from::text
      or m->>'dateTo' is distinct from v_job.date_to::text
      or m->>'level' is distinct from v_job.entity_level
  ) then
    raise exception 'Métrica fora do escopo do job.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_integration_snapshot_identity() from public,anon,authenticated,service_role;
create trigger guard_integration_snapshot_identity
  before insert or update on public.integration_snapshots
  for each row execute function private.guard_integration_snapshot_identity();
