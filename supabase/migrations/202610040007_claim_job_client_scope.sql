-- Return the tenant scope from an already deployed claim function.
drop function if exists private.claim_integration_collection_job(timestamptz);
create function private.claim_integration_collection_job(p_now timestamptz default now())
returns table (job_id uuid, client_id uuid, connection_id uuid, idempotency_key text, provider text, external_account_id text, date_from date, date_to date, entity_level text, attempt_count integer)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with candidate as (select j.id from public.integration_collection_jobs j where j.status in ('queued','partial') and j.next_attempt_at <= p_now order by j.priority asc, j.next_attempt_at asc, j.created_at asc for update skip locked limit 1),
  claimed as (update public.integration_collection_jobs j set status = 'collecting', attempt_count = j.attempt_count + 1, started_at = p_now, updated_at = p_now from candidate c where j.id = c.id returning j.id, j.client_id, j.connection_id, j.idempotency_key, j.provider, j.external_account_id, j.date_from, j.date_to, j.entity_level, j.attempt_count)
  select * from claimed;
end;
$$;
revoke all on function private.claim_integration_collection_job(timestamptz) from public, anon, authenticated;
grant execute on function private.claim_integration_collection_job(timestamptz) to service_role;
