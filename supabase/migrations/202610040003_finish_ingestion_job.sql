-- Persist a worker transition without allowing stale workers to overwrite a newer state.
create or replace function private.finish_integration_collection_job(
  p_job_id uuid,
  p_status text,
  p_next_attempt_at timestamptz default null,
  p_error_code text default null,
  p_error_message text default null,
  p_completed_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('partial','confirmed','failed') then
    raise exception 'Estado de coleta inválido.' using errcode = '22023';
  end if;
  update public.integration_collection_jobs
  set status = p_status,
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
      last_error_code = p_error_code,
      last_error_message = p_error_message,
      completed_at = p_completed_at,
      updated_at = now()
  where id = p_job_id and status = 'collecting';
  if not found then
    raise exception 'Job inexistente ou já finalizado.' using errcode = '40001';
  end if;
end;
$$;
revoke all on function private.finish_integration_collection_job(uuid,text,timestamptz,text,text,timestamptz) from public, anon, authenticated;
grant execute on function private.finish_integration_collection_job(uuid,text,timestamptz,text,text,timestamptz) to service_role;
