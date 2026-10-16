-- Etapa 2.2D: monitoramento persistente do cron financeiro e lista das organizações com acesso restrito.
-- Incremental (não altera migrations anteriores) e sem dados pessoais: cada execução guarda só identificador, ambiente, horários,
-- estado, duração e CONTAGENS. Nenhum segredo, token, payload de evento, cartão ou dado financeiro de cliente.
-- Aplicada SOMENTE em igrow-homologacao (xvjvfvinnnrgnhskglvd) em 15/10/2026; NÃO aplicada em produção.

-- ---------------------------------------------------------------------------------------------------
-- 1. Execuções do cron
-- ---------------------------------------------------------------------------------------------------
create table private.billing_cron_runs (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox', 'production')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  items_processed integer not null default 0 check (items_processed >= 0),
  failures integer not null default 0 check (failures >= 0),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object' and octet_length(counts::text) <= 1500),
  error_code text check (error_code ~ '^[a-z0-9_]{1,60}$')
);
create index billing_cron_runs_env_started_idx on private.billing_cron_runs(environment, started_at desc);
alter table private.billing_cron_runs enable row level security;
revoke all on private.billing_cron_runs from public, anon, authenticated;

-- Abre uma execução. Execuções "running" esquecidas há mais de 10 minutos viram falha ("cron_timeout") e o histórico com mais de
-- 30 dias é apagado (só este histórico de monitoramento, nunca dados financeiros).
create function public.billing_cron_start(p_environment text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_environment not in ('sandbox', 'production') then raise exception 'Ambiente inválido.' using errcode = '22023'; end if;
  update private.billing_cron_runs set status = 'failed', finished_at = now(), error_code = 'cron_timeout',
      duration_ms = least(2147483647, (extract(epoch from (now() - started_at)) * 1000)::bigint)::integer, failures = failures + 1
    where environment = p_environment and status = 'running' and started_at < now() - interval '10 minutes';
  delete from private.billing_cron_runs where started_at < now() - interval '30 days';
  insert into private.billing_cron_runs(environment) values (p_environment) returning id into v_id;
  return v_id;
end $$;

create function public.billing_cron_finish(p_id uuid, p_status text, p_items integer default 0, p_failures integer default 0,
  p_counts jsonb default '{}'::jsonb, p_error_code text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_status not in ('success', 'partial', 'failed') then raise exception 'Estado inválido.' using errcode = '22023'; end if;
  update private.billing_cron_runs set status = p_status, finished_at = now(), items_processed = greatest(coalesce(p_items, 0), 0),
      failures = greatest(coalesce(p_failures, 0), 0), counts = case when jsonb_typeof(coalesce(p_counts, '{}'::jsonb)) = 'object' then coalesce(p_counts, '{}'::jsonb) else '{}'::jsonb end,
      error_code = p_error_code,
      duration_ms = least(2147483647, (extract(epoch from (now() - started_at)) * 1000)::bigint)::integer
    where id = p_id and status = 'running';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Saúde do cron: pronta para um monitor externo (HTTP 503 quando "ok" é falso) e para alertas
--    Limiares: sem execução bem-sucedida há mais de 15 min; 3 execuções seguidas sem sucesso; pendências acumuladas.
-- ---------------------------------------------------------------------------------------------------
create function public.billing_cron_health(p_environment text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_last_run timestamptz; v_last_success timestamptz; v_consecutive integer; v_minutes numeric; v_events integer; v_oldest numeric; v_review integer;
  v_reconcile integer; v_intents integer; v_flags text[] := '{}'; v_last_status text;
begin
  select started_at, status into v_last_run, v_last_status from private.billing_cron_runs where environment = p_environment order by started_at desc limit 1;
  select max(finished_at) into v_last_success from private.billing_cron_runs where environment = p_environment and status = 'success';
  select count(*) into v_consecutive from private.billing_cron_runs
    where environment = p_environment and status in ('failed', 'partial') and started_at > coalesce(v_last_success, '-infinity'::timestamptz);
  v_minutes := case when v_last_success is null then null else round((extract(epoch from (now() - v_last_success)) / 60)::numeric, 1) end;
  select count(*), round(coalesce(extract(epoch from (now() - min(received_at))) / 60, 0)::numeric, 1) into v_events, v_oldest
    from private.billing_events where environment = p_environment and status in ('received', 'failed', 'processing') and received_at < now() - interval '2 minutes';
  select count(*) into v_review from private.billing_events where environment = p_environment and status = 'needs_review';
  -- Assinaturas que deveriam ter sido reconferidas (atraso/suspensas/pendentes: de hora em hora) e não foram há mais de 2 horas.
  select count(*) into v_reconcile from private.billing_subscriptions
    where environment = p_environment and status in ('pending', 'past_due', 'suspended') and coalesce(reconcile_attempted_at, created_at) < now() - interval '2 hours';
  select count(*) into v_intents from private.billing_checkout_intents
    where environment = p_environment and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') and expires_at < now() - interval '30 minutes';
  if v_last_run is null then v_flags := array_append(v_flags, 'never_ran');
  elsif v_last_success is null or v_minutes > 15 then v_flags := array_append(v_flags, 'no_recent_success'); end if;
  if v_consecutive >= 3 then v_flags := array_append(v_flags, 'consecutive_failures'); end if;
  if v_events > 50 or v_oldest > 30 then v_flags := array_append(v_flags, 'events_backlog'); end if;
  if v_reconcile > 20 then v_flags := array_append(v_flags, 'reconcile_backlog'); end if;
  if v_intents > 20 then v_flags := array_append(v_flags, 'intents_backlog'); end if;
  return jsonb_build_object(
    'ok', coalesce(array_length(v_flags, 1), 0) = 0, 'flags', to_jsonb(v_flags), 'environment', p_environment, 'now', now(),
    'last_run_at', v_last_run, 'last_run_status', v_last_status, 'last_success_at', v_last_success, 'minutes_since_success', v_minutes,
    'consecutive_non_success', v_consecutive,
    'runs_last_hour', (select count(*) from private.billing_cron_runs where environment = p_environment and started_at > now() - interval '1 hour'),
    'backlog', jsonb_build_object('events_pending', v_events, 'oldest_pending_event_minutes', v_oldest, 'events_needing_review', v_review,
      'subscriptions_not_reconciled', v_reconcile, 'intents_expired_unresolved', v_intents));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Organizações com acesso restrito (coleta agendada de anúncios pula essas organizações sem consultar uma a uma)
-- ---------------------------------------------------------------------------------------------------
create function public.billing_restricted_agency_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.agency_id), '{}'::uuid[]) from private.agency_plan_assignments a where a.access_state = 'restricted';
$$;

revoke all on function public.billing_cron_start(text), public.billing_cron_finish(uuid, text, integer, integer, jsonb, text),
  public.billing_cron_health(text), public.billing_restricted_agency_ids() from public, anon, authenticated;
grant execute on function public.billing_cron_start(text), public.billing_cron_finish(uuid, text, integer, integer, jsonb, text),
  public.billing_cron_health(text), public.billing_restricted_agency_ids() to service_role;
