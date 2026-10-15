-- Correção incremental (achada na homologação com concorrência real): duas aplicações simultâneas da MESMA assinatura nova.
-- Quem decidia "assinatura nova" antes de a trava da organização começar podia, depois de esperar, encontrar a própria assinatura
-- já criada pela outra chamada e se acusar de "duplicate_subscription". Agora, depois de obter a trava, confere de novo se a
-- assinatura (mesmo identificador no Asaas) já existe e responde 'noop'. Só esta função muda; nada além disso.
create or replace function public.billing_apply_subscription(p_environment text, p_snapshot jsonb, p_event_id bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id text := p_snapshot ->> 'id'; v_customer text := p_snapshot ->> 'customer'; v_value numeric := nullif(p_snapshot ->> 'value', '')::numeric;
  v_cycle text; v_amount integer; v_inactive boolean; v_agency uuid; sub private.billing_subscriptions; i private.billing_checkout_intents;
begin
  v_cycle := case upper(coalesce(p_snapshot ->> 'cycle', '')) when 'MONTHLY' then 'monthly' when 'YEARLY' then 'yearly' else null end;
  v_amount := case when v_value is null then null else round(v_value * 100)::integer end;
  v_inactive := coalesce((p_snapshot ->> 'deleted')::boolean, false) or upper(coalesce(p_snapshot ->> 'status', 'ACTIVE')) in ('INACTIVE', 'EXPIRED');

  select agency_id into v_agency from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_id;
  if v_agency is not null then
    perform private.billing_lock_agency(v_agency);
    select * into sub from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_id for update;
    if v_customer is not null and v_customer <> sub.asaas_customer_id then
      update private.billing_subscriptions set attention_reason = 'Cliente da assinatura no Asaas diverge do registrado.' where id = sub.id;
      return 'mismatch';
    end if;
    if sub.status = 'canceled' then return 'already_canceled'; end if;
    if v_inactive then
      if sub.status = 'pending' then
        update private.billing_subscriptions set status = 'canceled', canceled_at = now() where id = sub.id;
        perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.canceled_before_activation', jsonb_build_object('event_id', p_event_id));
        perform private.billing_sync_access(sub.agency_id);
        return 'canceled_before_activation';
      end if;
      if sub.cancel_at_period_end then return 'cancel_already_recorded'; end if;
      update private.billing_subscriptions set cancel_at_period_end = true,
        attention_reason = 'Assinatura encerrada no Asaas sem pedido no iGrow; acesso mantido até o fim do período pago.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.ended_at_gateway', jsonb_build_object('event_id', p_event_id));
      return 'cancel_recorded';
    end if;
    if v_amount is not null and v_amount <> sub.amount_cents then
      update private.billing_subscriptions set attention_reason = 'Valor da assinatura no Asaas diverge do contratado.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.value_mismatch', jsonb_build_object('expected', sub.amount_cents, 'received', v_amount));
      return 'mismatch';
    end if;
    return 'noop';
  end if;

  select agency_id into v_agency from private.billing_customers where environment = p_environment and asaas_customer_id = v_customer;
  if v_agency is null then return 'unattributed'; end if;
  perform private.billing_lock_agency(v_agency);
  -- Outra chamada simultânea pode ter registrado esta MESMA assinatura enquanto esta esperava a trava: não é duplicidade.
  if exists (select 1 from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_id) then return 'noop'; end if;
  if v_inactive then return 'ignored_inactive'; end if;
  if exists (select 1 from private.billing_subscriptions where agency_id = v_agency and status <> 'canceled') then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.duplicate_detected', jsonb_build_object('asaas_subscription_id', v_id, 'event_id', p_event_id));
    return 'duplicate_subscription';
  end if;
  select * into i from private.billing_checkout_intents where agency_id = v_agency and environment = p_environment
    and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') order by created_at desc limit 1 for update;
  if not found then return 'no_intent'; end if;
  if v_cycle is distinct from i.cycle or v_amount is distinct from i.amount_cents or upper(coalesce(p_snapshot ->> 'billingType', '')) <> 'CREDIT_CARD' then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.mismatch', jsonb_build_object('asaas_subscription_id', v_id, 'intent_id', i.id));
    return 'mismatch';
  end if;
  insert into private.billing_subscriptions(agency_id, environment, plan_version_id, cycle, amount_cents, asaas_subscription_id, asaas_customer_id, intent_id)
  values (v_agency, p_environment, i.plan_version_id, i.cycle, i.amount_cents, v_id, v_customer, i.id) returning * into sub;
  update private.billing_checkout_intents set status = 'completed', subscription_id = sub.id, completed_at = now(), updated_at = now() where id = i.id;
  perform private.billing_audit('system', null, v_agency, sub.id, 'subscription.created', jsonb_build_object('intent_id', i.id, 'cycle', i.cycle, 'amount_cents', i.amount_cents));
  return 'created';
end $$;
