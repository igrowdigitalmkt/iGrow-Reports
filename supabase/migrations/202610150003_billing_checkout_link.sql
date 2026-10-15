-- Etapa 2.2B: contratação pelo checkout hospedado do Asaas. Incremental, não destrutiva; nada aqui cria planos, assinaturas ou cobranças.
--  1. Ofertas contratáveis (somente leitura, só para proprietário/administrador da organização).
--  2. Situação financeira para a tela de contratação e de retorno do checkout (plano atual, papel, última tentativa).
--  3. Vínculo checkout ↔ assinatura: o identificador do checkout (checkoutSession) e o identificador interno da contratação
--     (externalReference) precisam CONFERIR quando o Asaas os informa; divergência = revisão humana, nunca ativação.
--  4. Fechamento de intenção pelos eventos CHECKOUT_CANCELED / CHECKOUT_EXPIRED e busca da intenção pelo checkout.

-- ---------------------------------------------------------------------------------------------------
-- 1. Ofertas
-- ---------------------------------------------------------------------------------------------------
create function public.billing_list_offers(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_agency_role(p_agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  -- Só planos públicos, à venda, com versão publicada e preço. A contratação confere tudo de novo no servidor (billing_create_intent).
  return coalesce((
    select jsonb_agg(x.offer order by x.sort_order, x.name)
    from (
      select p.sort_order, p.name, jsonb_build_object(
        'plan_id', p.id, 'plan_version_id', v.id, 'version', v.version, 'name', p.name, 'description', p.description, 'recommended', p.recommended,
        'price_monthly_cents', v.price_monthly_cents, 'price_yearly_cents', v.price_yearly_cents,
        'entitlements', coalesce((select jsonb_agg(jsonb_build_object('key', d.key, 'label', d.label, 'kind', d.kind, 'unit', d.unit,
            'enabled', e.enabled, 'limit', e.limit_value, 'unlimited', e.unlimited) order by d.sort_order)
          from private.plan_version_entitlements e join private.entitlement_definitions d on d.key = e.key where e.plan_version_id = v.id), '[]'::jsonb)) as offer
      from private.plans p join private.plan_versions v on v.id = p.current_version_id
      where p.sellable and p.visibility = 'public' and v.status = 'published'
        and (coalesce(v.price_monthly_cents, 0) > 0 or coalesce(v.price_yearly_cents, 0) > 0)
    ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Situação financeira (mesma função da 2.2A, com campos a mais; os existentes não mudam)
-- ---------------------------------------------------------------------------------------------------
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
        'cancel_at_period_end', s.cancel_at_period_end, 'cancel_requested_at', s.cancel_requested_at)
      from private.billing_subscriptions s where s.agency_id = p_agency_id and s.status <> 'canceled'),
    'trial', (select jsonb_build_object('status', t.status, 'ends_at', t.ends_at) from private.billing_trials t where t.agency_id = p_agency_id),
    'pending_checkout', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'expires_at', i.expires_at,
        'verifying', i.status in ('dispatching', 'unknown'), 'retry_after', i.expires_at,
        'checkout_url', case when v_role = 'owner' then i.checkout_url end)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown')),
    -- Última tentativa já encerrada (expirada, cancelada ou com falha) nos últimos 7 dias, para explicar o que aconteceu.
    'last_intent', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'at', i.updated_at)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('completed', 'expired', 'canceled', 'failed')
        and i.updated_at > now() - interval '7 days' order by i.updated_at desc limit 1),
    'last_subscription', (select jsonb_build_object('status', s.status, 'activated', s.started_at is not null, 'canceled_at', s.canceled_at)
      from private.billing_subscriptions s where s.agency_id = p_agency_id order by s.created_at desc limit 1),
    'current_plan', (select jsonb_build_object('name', p.name, 'version', pv.version, 'kind', a.kind, 'access_state', a.access_state)
      from private.agency_plan_assignments a join private.plan_versions pv on pv.id = a.plan_version_id join private.plans p on p.id = pv.plan_id
      where a.agency_id = p_agency_id),
    'access', (select a.access_state from private.agency_plan_assignments a where a.agency_id = p_agency_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('due_date', p.due_date, 'amount_cents', p.amount_cents, 'status', p.status, 'confirmed_at', p.confirmed_at, 'invoice_url', p.invoice_url) order by p.due_date desc)
      from (select * from private.billing_payments where agency_id = p_agency_id order by due_date desc limit 12) p), '[]'::jsonb))
  into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Intenção pelo checkout (servidor)
-- ---------------------------------------------------------------------------------------------------
create function public.billing_intent_by_checkout(p_environment text, p_checkout_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('intent_id', i.id, 'agency_id', i.agency_id, 'status', i.status, 'asaas_customer_id', bc.asaas_customer_id)
    from private.billing_checkout_intents i
    left join private.billing_customers bc on bc.agency_id = i.agency_id and bc.environment = i.environment
    where i.environment = p_environment and i.asaas_checkout_id = p_checkout_id), 'null'::jsonb);
$$;

-- CHECKOUT_CANCELED / CHECKOUT_EXPIRED fecham só intenções ainda em aberto; nunca uma já concluída.
create function public.billing_close_intent(p_environment text, p_checkout_id text, p_status text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare i private.billing_checkout_intents;
begin
  if p_status not in ('canceled', 'expired') then raise exception 'Estado inválido.' using errcode = '22023'; end if;
  select * into i from private.billing_checkout_intents where environment = p_environment and asaas_checkout_id = p_checkout_id for update;
  if not found then return 'unknown_checkout'; end if;
  if i.status = 'completed' then return 'already_completed'; end if;
  if i.status not in ('awaiting_payment', 'unknown', 'dispatching') then return 'noop'; end if;
  update private.billing_checkout_intents set status = p_status, updated_at = now() where id = i.id;
  perform private.billing_audit('system', null, i.agency_id, null, 'intent.' || p_status, jsonb_build_object('intent_id', i.id, 'source', 'checkout_event'));
  return 'closed';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Vínculo checkout ↔ assinatura (mesma função da correção anterior + conferências; o resto não muda)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.billing_apply_subscription(p_environment text, p_snapshot jsonb, p_event_id bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id text := p_snapshot ->> 'id'; v_customer text := p_snapshot ->> 'customer'; v_value numeric := nullif(p_snapshot ->> 'value', '')::numeric;
  v_session text := nullif(p_snapshot ->> 'checkoutSession', ''); v_ext text := nullif(p_snapshot ->> 'externalReference', '');
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
  -- Identificadores do checkout: quando o Asaas os informa, precisam ser OS DESTA intenção. Divergência = nunca ativa, vai para revisão.
  if (v_session is not null and i.asaas_checkout_id is not null and v_session <> i.asaas_checkout_id)
     or (v_ext ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_ext::uuid <> i.id) then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.checkout_mismatch',
      jsonb_build_object('asaas_subscription_id', v_id, 'intent_id', i.id, 'event_id', p_event_id));
    return 'mismatch';
  end if;
  insert into private.billing_subscriptions(agency_id, environment, plan_version_id, cycle, amount_cents, asaas_subscription_id, asaas_customer_id, intent_id)
  values (v_agency, p_environment, i.plan_version_id, i.cycle, i.amount_cents, v_id, v_customer, i.id) returning * into sub;
  -- Intenção com resultado desconhecido aprende o identificador do checkout pelo qual a assinatura nasceu.
  update private.billing_checkout_intents set status = 'completed', subscription_id = sub.id, completed_at = now(), updated_at = now(),
    asaas_checkout_id = coalesce(asaas_checkout_id, v_session) where id = i.id;
  perform private.billing_audit('system', null, v_agency, sub.id, 'subscription.created',
    jsonb_build_object('intent_id', i.id, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'checkout_confirmed', coalesce(v_session = i.asaas_checkout_id, false)));
  return 'created';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------------------------------
revoke all on function public.billing_list_offers(uuid) from public, anon, service_role;
grant execute on function public.billing_list_offers(uuid) to authenticated;
revoke all on function public.billing_intent_by_checkout(text, text), public.billing_close_intent(text, text, text) from public, anon, authenticated;
grant execute on function public.billing_intent_by_checkout(text, text), public.billing_close_intent(text, text, text) to service_role;
