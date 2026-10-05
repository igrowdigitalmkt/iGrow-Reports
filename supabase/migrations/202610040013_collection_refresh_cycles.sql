-- Retry budgets restart per explicit refresh without reusing fencing attempts.
alter table public.integration_collection_jobs add column retry_epoch_attempt integer not null default 0
  check (retry_epoch_attempt>=0 and retry_epoch_attempt<=attempt_count);

create function public.request_meta_collection_refresh(
  p_client_id uuid,p_connection_id uuid,p_date_from date,p_date_to date,
  p_api_version text,p_contract_version integer,p_scopes jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope jsonb;v_account text;v_level text;v_key text;v_id uuid;v_job public.integration_collection_jobs;
  v_created integer:=0;v_rescheduled integer:=0;v_preserved integer:=0;v_seen text[]:='{}';
begin
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>369
    or p_api_version is null or p_api_version!~'^v[0-9]+\.[0-9]+$'
    or p_contract_version is null or p_contract_version<1
    or jsonb_typeof(p_scopes) is distinct from 'array' then
    raise exception 'Solicitação de coleta inválida.' using errcode='22023';
  end if;
  if jsonb_array_length(p_scopes)<1 or jsonb_array_length(p_scopes)>400 then
    raise exception 'Solicitação de coleta inválida.' using errcode='22023';
  end if;
  for v_scope in select value from jsonb_array_elements(p_scopes) order by value->>'externalAccountId',value->>'level' loop
    v_account:=v_scope->>'externalAccountId';v_level:=v_scope->>'level';
    if v_account is null or v_account!~'^act_[0-9]+$' or v_level is null or v_level not in ('account','campaign','adset','ad') then
      raise exception 'Escopo de coleta inválido.' using errcode='22023';
    end if;
    perform private.require_meta_collection_scope(p_client_id,p_connection_id,v_account);
    v_key:=concat_ws(':',p_client_id,p_connection_id,'meta',v_account,p_date_from,p_date_to,v_level,p_api_version,p_contract_version);
    if v_key=any(v_seen) then raise exception 'Escopo duplicado.' using errcode='22023';end if;
    v_seen:=array_append(v_seen,v_key);
    v_id:=null;
    insert into public.integration_collection_jobs(client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,contract_version,idempotency_key,status,next_attempt_at)
    values(p_client_id,p_connection_id,'meta',v_account,p_date_from,p_date_to,v_level,p_api_version,p_contract_version,v_key,'queued',now())
    on conflict(idempotency_key) do nothing returning id into v_id;
    if v_id is not null then v_created:=v_created+1;continue;end if;
    select * into v_job from public.integration_collection_jobs where idempotency_key=v_key for update;
    if v_job.client_id is distinct from p_client_id or v_job.connection_id is distinct from p_connection_id
      or v_job.provider<>'meta' or v_job.external_account_id is distinct from v_account
      or v_job.date_from is distinct from p_date_from or v_job.date_to is distinct from p_date_to
      or v_job.entity_level is distinct from v_level or v_job.api_version is distinct from p_api_version
      or v_job.contract_version is distinct from p_contract_version then
      raise exception 'Identidade divergente na solicitação.' using errcode='22023';
    end if;
    if v_job.status in ('confirmed','failed') then
      update public.integration_collection_jobs set status='queued',next_attempt_at=now(),
        retry_epoch_attempt=attempt_count,started_at=null,completed_at=null,
        last_error_code=null,last_error_message=null,updated_at=now() where id=v_job.id;
      v_rescheduled:=v_rescheduled+1;
    else v_preserved:=v_preserved+1;end if;
  end loop;
  return jsonb_build_object('created',v_created,'rescheduled',v_rescheduled,'preserved',v_preserved);
end;
$$;
revoke all on function public.request_meta_collection_refresh(uuid,uuid,date,date,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.request_meta_collection_refresh(uuid,uuid,date,date,text,integer,jsonb) to service_role;

drop function public.claim_integration_collection_job(timestamptz);
drop function private.claim_integration_collection_job(timestamptz);
create function private.claim_collection_job_for_provider(p_now timestamptz,p_provider text)
returns table(job_id uuid,client_id uuid,connection_id uuid,idempotency_key text,provider text,external_account_id text,date_from date,date_to date,entity_level text,attempt_count integer,api_version text,contract_version integer,retry_attempt_count integer)
language plpgsql security definer set search_path='' as $$
begin
  return query with candidate as (
    select j.id from public.integration_collection_jobs j
    where (p_provider is null or j.provider=p_provider) and (
      (j.status in ('queued','partial') and j.next_attempt_at<=p_now)
      or (j.status='collecting' and coalesce(j.started_at,j.updated_at)<=p_now-interval '15 minutes'))
    order by j.priority,j.next_attempt_at,j.created_at for update skip locked limit 1
  ),claimed as (
    update public.integration_collection_jobs j set status='collecting',attempt_count=j.attempt_count+1,
      started_at=p_now,completed_at=null,updated_at=p_now from candidate c where j.id=c.id
    returning j.id,j.client_id,j.connection_id,j.idempotency_key,j.provider,j.external_account_id,
      j.date_from,j.date_to,j.entity_level,j.attempt_count,j.api_version,j.contract_version,j.attempt_count-j.retry_epoch_attempt
  ) select * from claimed;
end;
$$;
create function private.claim_integration_collection_job(p_now timestamptz default now())
returns table(job_id uuid,client_id uuid,connection_id uuid,idempotency_key text,provider text,external_account_id text,date_from date,date_to date,entity_level text,attempt_count integer,api_version text,contract_version integer,retry_attempt_count integer)
language sql security definer set search_path='' as $$select * from private.claim_collection_job_for_provider(p_now,null);$$;
create function public.claim_integration_collection_job(p_now timestamptz default now())
returns table(job_id uuid,client_id uuid,connection_id uuid,idempotency_key text,provider text,external_account_id text,date_from date,date_to date,entity_level text,attempt_count integer,api_version text,contract_version integer,retry_attempt_count integer)
language sql security definer set search_path='' as $$select * from private.claim_integration_collection_job(p_now);$$;
revoke all on function private.claim_integration_collection_job(timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.claim_integration_collection_job(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_integration_collection_job(timestamptz) to service_role;
create function public.claim_meta_collection_job(p_now timestamptz default now())
returns table(job_id uuid,client_id uuid,connection_id uuid,idempotency_key text,provider text,external_account_id text,date_from date,date_to date,entity_level text,attempt_count integer,api_version text,contract_version integer,retry_attempt_count integer)
language sql security definer set search_path='' as $$select * from private.claim_collection_job_for_provider(p_now,'meta');$$;
revoke all on function private.claim_collection_job_for_provider(timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_meta_collection_job(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_meta_collection_job(timestamptz) to service_role;
