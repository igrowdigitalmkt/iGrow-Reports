-- Etapa 2.2G: Super Admin administra as configurações comerciais pela interface (sem SQL manual).
-- Incremental: só acrescenta 3 funções administrativas. Não altera tabelas, preços, versões, assinaturas, pagamentos nem organizações.
--  - platform_get_billing_settings(): leitura das regras (teste gratuito, tolerância, validade do checkout) e do estado de live_enabled.
--  - platform_update_billing_settings(...): altera SOMENTE trial_days, trial_plan_version_id, past_due_grace_days e checkout_minutes. NUNCA altera
--    live_enabled. Vale para o futuro: testes já iniciados guardam o próprio vencimento e plano; tolerância e prazo de checkout já gravados em
--    assinaturas/intenções existentes não mudam. O plano do teste precisa ser uma versão PUBLICADA de um plano PRIVADO e NÃO vendável (sem checkout).
--  - platform_billing_dashboard(ambiente): visão operacional somente leitura (assinaturas por estado, testes, eventos, cron, consumo de IA).
-- Todas exigem operador da plataforma com MFA (aal2), registram auditoria e não dão acesso às tabelas financeiras.

create function public.platform_get_billing_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s private.billing_settings;
begin
  perform private.require_operator();
  select * into s from private.billing_settings;
  return jsonb_build_object(
    'trial_days', s.trial_days, 'past_due_grace_days', s.past_due_grace_days, 'checkout_minutes', s.checkout_minutes, 'live_enabled', s.live_enabled,
    'trial_plan_version_id', s.trial_plan_version_id,
    'trial_plan', (select jsonb_build_object('plan_id', p.id, 'plan_name', p.name, 'version', v.version, 'visibility', p.visibility, 'sellable', p.sellable,
        'entitlements', coalesce((select jsonb_agg(jsonb_build_object('key', e.key, 'enabled', e.enabled, 'limit', e.limit_value, 'unlimited', e.unlimited) order by e.key)
          from private.plan_version_entitlements e where e.plan_version_id = v.id), '[]'::jsonb))
      from private.plan_versions v join private.plans p on p.id = v.plan_id where v.id = s.trial_plan_version_id),
    'trial_candidates', coalesce((select jsonb_agg(jsonb_build_object('version_id', v.id, 'plan_id', p.id, 'label', p.name || ' (versão ' || v.version || ')') order by p.name, v.version desc)
      from private.plans p join private.plan_versions v on v.plan_id = p.id where p.visibility = 'private' and not p.sellable and v.status = 'published'), '[]'::jsonb));
end $$;

create function public.platform_update_billing_settings(p_trial_days integer, p_trial_plan_version_id uuid, p_past_due_grace_days integer, p_checkout_minutes integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare old_s private.billing_settings;
begin
  perform private.require_operator();
  if p_trial_days is null or p_trial_days not between 1 and 90 then raise exception 'A duração do teste gratuito deve ficar entre 1 e 90 dias.' using errcode = '22023'; end if;
  if p_past_due_grace_days is null or p_past_due_grace_days not between 0 and 60 then raise exception 'A tolerância por inadimplência deve ficar entre 0 e 60 dias.' using errcode = '22023'; end if;
  if p_checkout_minutes is null or p_checkout_minutes not between 10 and 1440 then raise exception 'A validade do checkout deve ficar entre 10 e 1440 minutos.' using errcode = '22023'; end if;
  if p_trial_plan_version_id is not null and not exists (
    select 1 from private.plan_versions v join private.plans p on p.id = v.plan_id
    where v.id = p_trial_plan_version_id and v.status = 'published' and p.visibility = 'private' and not p.sellable) then
    raise exception 'O plano do teste precisa ser uma versão publicada de um plano privado e não vendável (sem checkout).' using errcode = '22023';
  end if;
  select * into old_s from private.billing_settings for update;
  -- live_enabled NÃO é tocado aqui (a liberação de cobrança real é uma decisão separada, fora da interface).
  update private.billing_settings set trial_days = p_trial_days, trial_plan_version_id = p_trial_plan_version_id,
    past_due_grace_days = p_past_due_grace_days, checkout_minutes = p_checkout_minutes, updated_at = now();
  perform private.audit_platform('commercial.billing_settings_updated', 'billing_settings', 'billing',
    jsonb_build_object('trial_days', jsonb_build_array(old_s.trial_days, p_trial_days), 'grace_days', jsonb_build_array(old_s.past_due_grace_days, p_past_due_grace_days),
      'checkout_minutes', jsonb_build_array(old_s.checkout_minutes, p_checkout_minutes),
      'trial_plan_version_id', jsonb_build_array(old_s.trial_plan_version_id, p_trial_plan_version_id)));
end $$;

create function public.platform_billing_dashboard(p_environment text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  if p_environment not in ('sandbox', 'production') then raise exception 'Ambiente inválido.' using errcode = '22023'; end if;
  return jsonb_build_object(
    'environment', p_environment,
    'live_enabled', (select live_enabled from private.billing_settings),
    'subscriptions', (select jsonb_build_object(
        'pending', count(*) filter (where status = 'pending'), 'active', count(*) filter (where status = 'active'),
        'past_due', count(*) filter (where status = 'past_due'), 'suspended', count(*) filter (where status = 'suspended'),
        'canceled', count(*) filter (where status = 'canceled'),
        'cancel_scheduled', count(*) filter (where cancel_at_period_end and status in ('active', 'past_due', 'suspended')))
      from private.billing_subscriptions where environment = p_environment),
    'trials', (select jsonb_build_object(
        'active', count(*) filter (where status = 'active' and ends_at > now()),
        'ending_in_3_days', count(*) filter (where status = 'active' and ends_at > now() and ends_at <= now() + interval '3 days'),
        'expired', count(*) filter (where status = 'expired' or (status = 'active' and ends_at <= now())))
      from private.billing_trials),
    'events', (select jsonb_build_object(
        'pending', count(*) filter (where status in ('received', 'failed', 'processing')), 'needs_review', count(*) filter (where status = 'needs_review'),
        'oldest_pending_at', min(received_at) filter (where status in ('received', 'failed', 'processing')))
      from private.billing_events where environment = p_environment),
    -- Só o que exige atenção, sem identificadores do Asaas, chaves ou dados de cartão.
    'attention', coalesce((select jsonb_agg(row order by sort_key) from (
        select s.created_at as sort_key, jsonb_build_object('agency_id', s.agency_id, 'agency_name', a.name, 'status', s.status, 'cycle', s.cycle, 'amount_cents', s.amount_cents,
          'current_period_end', s.current_period_end, 'grace_ends_at', s.grace_ends_at, 'cancel_at_period_end', s.cancel_at_period_end,
          'remote_cancel_pending', s.remote_cancel_pending, 'attention_reason', s.attention_reason) as row
        from private.billing_subscriptions s join public.agencies a on a.id = s.agency_id
        where s.environment = p_environment and (s.status in ('past_due', 'suspended') or s.attention_reason is not null or s.remote_cancel_pending)
        order by s.created_at desc limit 30) q), '[]'::jsonb),
    'cron', public.billing_cron_health(p_environment),
    'ai', (select jsonb_build_object('month_cost_usd', coalesce(sum(cost_usd), 0), 'organizations_with_usage', count(distinct agency_id))
      from public.ai_usage where status = 'ok' and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'));
end $$;

revoke all on function public.platform_get_billing_settings(), public.platform_update_billing_settings(integer, uuid, integer, integer),
  public.platform_billing_dashboard(text) from public, anon, service_role;
grant execute on function public.platform_get_billing_settings(), public.platform_update_billing_settings(integer, uuid, integer, integer),
  public.platform_billing_dashboard(text) to authenticated;
