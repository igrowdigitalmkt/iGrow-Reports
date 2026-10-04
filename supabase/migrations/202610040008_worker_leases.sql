-- Fifteen-minute claims are fenced by attempt_count. Result writes are atomic.
create index integration_collection_jobs_abandoned_idx
  on public.integration_collection_jobs(started_at) where status='collecting';
alter table public.integration_snapshots add column attempt_count integer;
create unique index integration_snapshots_attempt_idx
  on public.integration_snapshots(job_id,attempt_count);

-- client_users is hidden from client sessions; use an authorized policy helper.
create function private.can_read_integration_snapshot(p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.clients c join public.client_users cu
      on cu.agency_id=c.agency_id and cu.client_id=c.id
    where c.id=p_client_id and c.archived_at is null
      and cu.user_id=(select auth.uid()) and cu.active
  );
$$;
revoke all on function private.can_read_integration_snapshot(uuid) from public,anon;
grant execute on function private.can_read_integration_snapshot(uuid) to authenticated;
drop policy integration_snapshots_client_read on public.integration_snapshots;
create policy integration_snapshots_client_read on public.integration_snapshots
  for select to authenticated using (status='confirmed' and private.can_read_integration_snapshot(client_id));

create or replace function private.claim_integration_collection_job(p_now timestamptz default now())
returns table (job_id uuid, client_id uuid, connection_id uuid, idempotency_key text, provider text, external_account_id text, date_from date, date_to date, entity_level text, attempt_count integer)
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
    set status='collecting',attempt_count=j.attempt_count+1,started_at=p_now,
      completed_at=null,updated_at=p_now
    from candidate c where j.id=c.id
    returning j.id,j.client_id,j.connection_id,j.idempotency_key,j.provider,
      j.external_account_id,j.date_from,j.date_to,j.entity_level,j.attempt_count
  ) select * from claimed;
end;
$$;

drop function private.finish_integration_collection_job(uuid,text,timestamptz,text,text,timestamptz);
create function private.finish_integration_collection_job(
  p_job_id uuid,p_attempt_count integer,p_status text,
  p_next_attempt_at timestamptz default null,p_error_code text default null,
  p_error_message text default null,p_completed_at timestamptz default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status is null or p_status not in ('partial','confirmed','failed') then
    raise exception 'Estado de coleta inválido.' using errcode='22023';
  end if;
  update public.integration_collection_jobs
  set status=p_status,next_attempt_at=coalesce(p_next_attempt_at,next_attempt_at),
    last_error_code=p_error_code,last_error_message=p_error_message,
    completed_at=case when p_status='confirmed' then coalesce(p_completed_at,now()) else null end,
    updated_at=now()
  where id=p_job_id and status='collecting' and attempt_count=p_attempt_count
    and started_at>now()-interval '15 minutes';
  if not found then
    raise exception 'Tentativa de coleta expirada ou já finalizada.' using errcode='40001';
  end if;
end;
$$;

create function private.persist_integration_collection_result(
  p_job_id uuid,p_attempt_count integer,p_status text,p_metrics jsonb,
  p_reconciliation jsonb,p_raw_payloads jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_job public.integration_collection_jobs;v_snapshot uuid;
begin
  select * into v_job from public.integration_collection_jobs where id=p_job_id for update;
  if not found or v_job.status<>'collecting' or v_job.attempt_count is distinct from p_attempt_count
    or v_job.started_at is null or v_job.started_at<=now()-interval '15 minutes' then
    raise exception 'Tentativa de coleta expirada ou já finalizada.' using errcode='40001';
  end if;
  if p_status is null or p_status not in ('partial','confirmed')
    or jsonb_typeof(p_metrics) is distinct from 'array'
    or jsonb_typeof(p_raw_payloads) is distinct from 'array'
    or jsonb_typeof(p_reconciliation) is distinct from 'object'
    or (p_status='confirmed' and p_reconciliation->>'confirmed'='false') then
    raise exception 'Resultado de coleta inválido.' using errcode='22023';
  end if;
  select id into v_snapshot from public.integration_snapshots
    where job_id=p_job_id and attempt_count=p_attempt_count;
  if found then return v_snapshot;end if;
  insert into public.integration_raw_payloads(job_id,provider,endpoint,response_payload,http_status,collected_at)
  select p_job_id,v_job.provider,r->>'endpoint',r->'payload',(r->>'httpStatus')::integer,now()
    from jsonb_array_elements(p_raw_payloads) r;
  insert into public.integration_snapshots(job_id,attempt_count,client_id,provider,external_account_id,
    date_from,date_to,entity_level,status,payload,reconciliation,collected_at)
  values(p_job_id,p_attempt_count,v_job.client_id,v_job.provider,v_job.external_account_id,
    v_job.date_from,v_job.date_to,v_job.entity_level,p_status,jsonb_build_object('metrics',p_metrics),p_reconciliation,now())
  returning id into v_snapshot;
  return v_snapshot;
end;
$$;

-- PostgREST exposes public, never private. Only service_role can call these wrappers.
create function public.claim_integration_collection_job(p_now timestamptz default now())
returns table (job_id uuid, client_id uuid, connection_id uuid, idempotency_key text, provider text, external_account_id text, date_from date, date_to date, entity_level text, attempt_count integer)
language sql security definer set search_path='' as $$
  select * from private.claim_integration_collection_job(p_now);
$$;
create function public.finish_integration_collection_job(
  p_job_id uuid,p_attempt_count integer,p_status text,
  p_next_attempt_at timestamptz default null,p_error_code text default null,
  p_error_message text default null,p_completed_at timestamptz default null
) returns void language sql security definer set search_path='' as $$
  select private.finish_integration_collection_job(p_job_id,p_attempt_count,p_status,p_next_attempt_at,p_error_code,p_error_message,p_completed_at);
$$;
create function public.persist_integration_collection_result(
  p_job_id uuid,p_attempt_count integer,p_status text,p_metrics jsonb,p_reconciliation jsonb,p_raw_payloads jsonb
) returns uuid language sql security definer set search_path='' as $$
  select private.persist_integration_collection_result(p_job_id,p_attempt_count,p_status,p_metrics,p_reconciliation,p_raw_payloads);
$$;
create function public.record_integration_provider_health(
  p_integration_id uuid,p_provider text,p_ok boolean,p_error_code text default null,p_latency_ms integer default null
) returns public.integration_provider_health language sql security definer set search_path='' as $$
  select private.record_integration_provider_health(p_integration_id,p_provider,p_ok,p_error_code,p_latency_ms);
$$;

revoke all on function private.claim_integration_collection_job(timestamptz),
  private.finish_integration_collection_job(uuid,integer,text,timestamptz,text,text,timestamptz),
  private.persist_integration_collection_result(uuid,integer,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_integration_collection_job(timestamptz),
  public.finish_integration_collection_job(uuid,integer,text,timestamptz,text,text,timestamptz),
  public.persist_integration_collection_result(uuid,integer,text,jsonb,jsonb,jsonb),
  public.record_integration_provider_health(uuid,text,boolean,text,integer)
  from public,anon,authenticated;
grant execute on function public.claim_integration_collection_job(timestamptz),
  public.finish_integration_collection_job(uuid,integer,text,timestamptz,text,text,timestamptz),
  public.persist_integration_collection_result(uuid,integer,text,jsonb,jsonb,jsonb),
  public.record_integration_provider_health(uuid,text,boolean,text,integer)
  to service_role;
