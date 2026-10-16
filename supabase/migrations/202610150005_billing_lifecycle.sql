-- Etapa 2.2C: ciclo de vida das assinaturas (cancelamento, renovação, inadimplência). Incremental e não destrutiva.
-- A fundação (2.2A) já tem cancelamento no banco (período pago preservado), renovação por pagamento confirmado, tolerância de 7 dias,
-- suspensão e regularização; esta migration só acrescenta o que faltava para a TELA e para a RECONCILIAÇÃO:
--  1. get_agency_billing passa a informar remote_cancel_pending e overdue_due_date (e ciclo/valor da última assinatura): a tela só diz que a
--     renovação foi interrompida DEPOIS da confirmação do Asaas.
--  2. billing_confirm_remote_cancel passa a auditar a confirmação (subscription.remote_cancel_confirmed, uma vez).
--  3. billing_reconcile_work reconfere de hora em hora assinaturas em atraso/suspensas e as que vencem hoje ou amanhã (renovação ou
--     inadimplência percebidas mesmo sem webhook); as demais seguem diárias.
--  4. billing_reconcile_work passa a REIVINDICAR as assinaturas a conferir (carimbo reconcile_attempted_at, skip locked), por prioridade (atraso/suspensa,
--     vencimento próximo, pendente, demais) e em rodízio: uma assinatura com erro não volta ao topo da fila nem impede a conferência das demais.

alter table private.billing_subscriptions add column if not exists reconcile_attempted_at timestamptz;

create or replace function public.get_agency_billing(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_role public.agency_role;
begin
  if not private.has_agency_role(p_agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  v_role := private.agency_role(p_agency_id);
  select jsonb_build_object(
    'role', v_role,
    'can_contract', v_role = 'owner',
    'subscription', (select jsonb_build_object('status', s.status, 'cycle', s.cycle, 'amount_cents', s.amount_cents, 'plan_version_id', s.plan_version_id,
        'current_period_end', s.current_period_end, 'next_due_date', s.next_due_date, 'grace_ends_at', s.grace_ends_at,
        'cancel_at_period_end', s.cancel_at_period_end, 'cancel_requested_at', s.cancel_requested_at,
        -- Cancelamento pedido mas ainda não confirmado no Asaas: a tela NÃO pode dizer que a renovação já foi interrompida.
        'remote_cancel_pending', s.remote_cancel_pending, 'overdue_due_date', s.overdue_due_date)
      from private.billing_subscriptions s where s.agency_id = p_agency_id and s.status <> 'canceled'),
    'trial', (select jsonb_build_object('status', t.status, 'ends_at', t.ends_at) from private.billing_trials t where t.agency_id = p_agency_id),
    'pending_checkout', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'expires_at', i.expires_at,
        'verifying', i.status in ('dispatching', 'unknown'), 'retry_after', i.expires_at, 'dispatched_at', i.dispatched_at,
        'checkout_url', case when v_role = 'owner' then i.checkout_url end)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown')),
    -- Última tentativa já encerrada (expirada, cancelada ou com falha) nos últimos 7 dias, para explicar o que aconteceu.
    'last_intent', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'at', i.updated_at)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('completed', 'expired', 'canceled', 'failed')
        and i.updated_at > now() - interval '7 days' order by i.updated_at desc limit 1),
    'last_subscription', (select jsonb_build_object('status', s.status, 'activated', s.started_at is not null, 'canceled_at', s.canceled_at, 'cycle', s.cycle, 'amount_cents', s.amount_cents)
      from private.billing_subscriptions s where s.agency_id = p_agency_id order by s.created_at desc limit 1),
    -- Contratação que expirou no relógio mas ainda está sendo conferida no Asaas (pode ter sido paga): a tela não incentiva novo pagamento.
    'recovery', (select jsonb_build_object('since', i.expires_at, 'review', i.review_required_at is not null) from private.billing_checkout_intents i where i.agency_id = p_agency_id
      and i.status = 'expired' and i.dispatched_at is not null and i.verified_after_expiry_at is null
      order by i.created_at desc limit 1),
    -- Pagamento em outra assinatura detectado: exige atendimento (nada é cancelado ou reembolsado automaticamente).
    'conflict', exists (select 1 from private.billing_subscriptions s where s.agency_id = p_agency_id and s.status <> 'canceled' and s.attention_reason like 'Conflito:%'),
    'current_plan', (select jsonb_build_object('name', p.name, 'version', pv.version, 'kind', a.kind, 'access_state', a.access_state)
      from private.agency_plan_assignments a join private.plan_versions pv on pv.id = a.plan_version_id join private.plans p on p.id = pv.plan_id
      where a.agency_id = p_agency_id),
    'access', (select a.access_state from private.agency_plan_assignments a where a.agency_id = p_agency_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('due_date', p.due_date, 'amount_cents', p.amount_cents, 'status', p.status, 'confirmed_at', p.confirmed_at, 'invoice_url', p.invoice_url) order by p.due_date desc)
      from (select * from private.billing_payments where agency_id = p_agency_id order by due_date desc limit 12) p), '[]'::jsonb))
  into v;
  return v;
end $$;

create or replace function public.billing_confirm_remote_cancel(p_subscription_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_agency uuid;
begin
  update private.billing_subscriptions set remote_cancel_pending = false where id = p_subscription_id and remote_cancel_pending returning agency_id into v_agency;
  if v_agency is not null then
    perform private.billing_audit('system', null, v_agency, p_subscription_id, 'subscription.remote_cancel_confirmed', '{}'::jsonb);
  end if;
end $$;

create or replace function public.billing_reconcile_work(p_limit integer default 20, p_environment text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_intents jsonb; v_subs jsonb;
begin
  with picked as (
    select i.id from private.billing_checkout_intents i
    where i.dispatched_at is not null and (p_environment is null or i.environment = p_environment)
      and ((i.status in ('dispatching', 'unknown', 'awaiting_payment') and i.dispatched_at < now() - interval '2 minutes')
        -- Expirada e NÃO conferida: continua sendo conferida enquanto for necessário (a cada 4 min no 1º dia, depois a cada 30 min); sem prazo final.
        or (i.status = 'expired' and i.verified_after_expiry_at is null)
        -- Já conferida: nova conferência a cada 6 horas por 3 dias após a expiração (o checkout não pode mais ser pago; é só defesa extra).
        or (i.status = 'expired' and i.verified_after_expiry_at is not null and i.expires_at > now() - interval '3 days'))
      and (i.recovery_checked_at is null or i.recovery_checked_at < now() - case
             when i.status = 'expired' and i.verified_after_expiry_at is not null then interval '6 hours'
             when i.status = 'expired' and i.expires_at < now() - interval '1 day' then interval '30 minutes'
             else interval '4 minutes' end)
    order by i.created_at limit 25 for update of i skip locked),
  stamped as (
    update private.billing_checkout_intents i set recovery_checked_at = now() from picked where i.id = picked.id
    returning i.id, i.environment, i.agency_id, i.status)
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'environment', s.environment, 'status', s.status, 'asaas_customer_id', bc.asaas_customer_id)), '[]'::jsonb)
    into v_intents
    from stamped s join private.billing_customers bc on bc.agency_id = s.agency_id and bc.environment = s.environment;

  -- Assinaturas a conferir: REIVINDICADAS (carimbo de tentativa, skip locked), por prioridade e em rodízio. Uma assinatura com erro não volta ao
  -- topo da fila a cada rodada (nova tentativa só depois de 4 min) e não impede a conferência das demais; quem precisa de atendimento vem antes.
  with eligible as (
    select s.id, case when s.status in ('past_due', 'suspended') then 1
                      when s.status = 'active' and s.next_due_date <= ((now() at time zone 'America/Sao_Paulo')::date + 1) then 2
                      when s.status = 'pending' then 3 else 4 end as prio
    from private.billing_subscriptions s
    where s.status in ('pending', 'active', 'past_due', 'suspended') and (p_environment is null or s.environment = p_environment)
      and (s.last_reconciled_at is null or s.last_reconciled_at < now() - case
             when s.status = 'pending' and s.created_at > now() - interval '3 days' then interval '5 minutes'
             when s.status in ('past_due', 'suspended') then interval '1 hour'
             when s.status = 'active' and s.next_due_date <= ((now() at time zone 'America/Sao_Paulo')::date + 1) then interval '1 hour'
             else interval '1 day' end)
      and (s.reconcile_attempted_at is null or s.reconcile_attempted_at < now() - interval '4 minutes')
    order by 2, s.reconcile_attempted_at nulls first, s.last_reconciled_at nulls first
    limit greatest(1, least(coalesce(p_limit, 20), 100)) for update of s skip locked),
  stamped as (
    update private.billing_subscriptions s set reconcile_attempted_at = now() from eligible e where s.id = e.id
    returning s.id, s.environment, s.asaas_subscription_id, e.prio, s.last_reconciled_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'environment', environment, 'asaas_subscription_id', asaas_subscription_id)
           order by prio, last_reconciled_at nulls first), '[]'::jsonb) into v_subs from stamped;

  return jsonb_build_object(
    -- Assinatura pendente (pagamento ainda não refletido) é conferida a cada 5 minutos por 3 dias; as demais, uma vez por dia.
    'reconcile', v_subs,
    'remote_cancel', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'environment', c.environment, 'asaas_subscription_id', c.asaas_subscription_id))
      from (select id, environment, asaas_subscription_id from private.billing_subscriptions where remote_cancel_pending limit 50) c), '[]'::jsonb),
    'intents', v_intents);
end $$;
