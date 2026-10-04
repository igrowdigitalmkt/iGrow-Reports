create or replace function private.record_integration_provider_health(
  p_integration_id uuid, p_provider text, p_ok boolean,
  p_error_code text default null, p_latency_ms integer default null
)
returns public.integration_provider_health
language plpgsql security definer set search_path = ''
as $$
declare result public.integration_provider_health;
begin
  insert into public.integration_provider_health(integration_id, provider, status, last_success_at, last_failure_at, last_error_code, consecutive_failures, avg_latency_ms, updated_at)
  values (p_integration_id, p_provider, case when p_ok then 'healthy' else 'degraded' end, case when p_ok then now() else null end, case when p_ok then null else now() end, case when p_ok then null else coalesce(p_error_code, 'unknown') end, case when p_ok then 0 else 1 end, p_latency_ms, now())
  on conflict (integration_id, provider) do update set
    status = case when p_ok then 'healthy' when public.integration_provider_health.consecutive_failures + 1 >= 5 then 'blocked' else 'degraded' end,
    last_success_at = case when p_ok then now() else public.integration_provider_health.last_success_at end,
    last_failure_at = case when p_ok then public.integration_provider_health.last_failure_at else now() end,
    last_error_code = case when p_ok then null else coalesce(p_error_code, 'unknown') end,
    consecutive_failures = case when p_ok then 0 else public.integration_provider_health.consecutive_failures + 1 end,
    avg_latency_ms = case when p_latency_ms is null then public.integration_provider_health.avg_latency_ms when public.integration_provider_health.avg_latency_ms is null then p_latency_ms else round((public.integration_provider_health.avg_latency_ms * 4 + p_latency_ms) / 5.0)::integer end,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function private.record_integration_provider_health(uuid,text,boolean,text,integer) from public, anon, authenticated;
grant execute on function private.record_integration_provider_health(uuid,text,boolean,text,integer) to service_role;
