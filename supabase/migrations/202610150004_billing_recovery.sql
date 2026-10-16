-- Etapa 2.2B (correção): recuperação segura de contratações pagas, mesmo quando o webhook atrasa, falha ou chega depois da expiração
-- local da intenção. Incremental e não destrutiva: as migrations anteriores não são alteradas; as funções abaixo são REDEFINIDAS
-- (create or replace) a partir das versões anteriores, com os trechos novos comentados.
--  1. Só o identificador do checkout (checkoutSession) ou a referência da contratação (externalReference) ativam: coincidência de cliente,
--     valor, ciclo e data vai para REVISÃO financeira (sem ativar, preservando intenção e pagamento). Sem prazo para o vínculo por identificador.
--  2. Nova contratação é bloqueada enquanto uma intenção expirada ainda pode ter sido paga e não foi conferida no Asaas (sem liberação por
--     decurso de prazo; liberação só por conferência conclusiva ou por operador, com auditoria).
--  3. Reconciliação periódica reivindica intenções a conferir (sem execução duplicada entre cron e webhook).
--  4. Pagamento de assinatura desconhecida (ex.: segunda assinatura) fica registrado para atendimento; nunca é descartado em silêncio.

alter table private.billing_checkout_intents add column if not exists recovery_checked_at timestamptz;
alter table private.billing_checkout_intents add column if not exists verified_after_expiry_at timestamptz;
alter table private.billing_checkout_intents add column if not exists review_required_at timestamptz;


-- 2. Nova contratação só depois de conferir uma anterior que pode ter sido paga.
create or replace function public.billing_create_intent(p_agency_id uuid, p_user_id uuid, p_plan_version_id uuid, p_cycle text, p_request_key text, p_environment text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s private.billing_settings; i private.billing_checkout_intents; pv record; v_amount integer;
begin
  if p_cycle not in ('monthly', 'yearly') then raise exception 'Ciclo de cobrança inválido.' using errcode = '22023'; end if;
  if p_environment not in ('sandbox', 'production') then raise exception 'Ambiente inválido.' using errcode = '22023'; end if;
  if char_length(coalesce(p_request_key, '')) not between 8 and 80 then raise exception 'Chave de idempotência inválida.' using errcode = '22023'; end if;
  select * into s from private.billing_settings;
  if p_environment = 'production' and not s.live_enabled then raise exception 'Cobrança em produção ainda não está liberada.' using errcode = '42501'; end if;
  if not private.billing_is_owner(p_agency_id, p_user_id) then raise exception 'Somente o proprietário da organização pode contratar.' using errcode = '42501'; end if;

  perform private.billing_lock_agency(p_agency_id);
  update private.billing_checkout_intents set status = 'expired', updated_at = now()
    where agency_id = p_agency_id and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') and expires_at < now();
  -- Nunca enviada ao Asaas (o processo morreu antes): liberada com segurança, sem risco de cobrança duplicada.
  update private.billing_checkout_intents set status = 'failed', last_error = 'Abandonada antes do envio ao Asaas.', updated_at = now()
    where agency_id = p_agency_id and status = 'creating' and dispatched_at is null and created_at < now() - interval '3 minutes';

  -- Reenvio da mesma solicitação (clique duplo, nova tentativa): devolve a mesma intenção.
  select * into i from private.billing_checkout_intents where agency_id = p_agency_id and request_key = p_request_key;
  if found then
    if i.plan_version_id <> p_plan_version_id or i.cycle <> p_cycle then
      raise exception 'Esta chave de solicitação já foi usada com outros dados.' using errcode = '22023';
    end if;
    return jsonb_build_object('reused', true, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i);
  end if;
  if exists (select 1 from private.billing_subscriptions where agency_id = p_agency_id and status <> 'canceled') then
    raise exception 'A organização já possui uma assinatura. Regularize ou cancele a atual antes de contratar outra.' using errcode = '23505';
  end if;
  -- Outra aba, outro clique ou checkout em andamento (inclusive com resultado desconhecido): reaproveita, nunca cria um segundo.
  select * into i from private.billing_checkout_intents where agency_id = p_agency_id and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown');
  if found then return jsonb_build_object('reused', true, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i); end if;

  -- Contratação anterior que expirou no relógio local, mas pode ter sido paga: antes de abrir outra, o servidor confere no Asaas
  -- (billing_mark_intent_verified). Evita uma segunda cobrança enquanto a primeira ainda pode estar chegando. NÃO há liberação por
  -- decurso de prazo: só a conferência conclusiva (ou a decisão de um operador, com auditoria) libera.
  if exists (select 1 from private.billing_checkout_intents where agency_id = p_agency_id and status = 'expired' and dispatched_at is not null
             and verified_after_expiry_at is null) then
    raise exception 'Estamos verificando a sua contratação anterior no Asaas.' using errcode = '55000';
  end if;

  -- Preço sempre do servidor: versão publicada e atual de um plano à venda, com preço válido para o ciclo.
  select pv2.id, pv2.status, pv2.price_monthly_cents, pv2.price_yearly_cents, p.current_version_id, p.sellable into pv
    from private.plan_versions pv2 join private.plans p on p.id = pv2.plan_id where pv2.id = p_plan_version_id;
  if pv.id is null or pv.status <> 'published' or pv.current_version_id <> pv.id or not pv.sellable then
    raise exception 'Este plano não está disponível para contratação.' using errcode = '22023';
  end if;
  v_amount := case p_cycle when 'monthly' then pv.price_monthly_cents else pv.price_yearly_cents end;
  if v_amount is null or v_amount <= 0 then raise exception 'O plano não tem preço para este ciclo.' using errcode = '22023'; end if;

  insert into private.billing_checkout_intents(agency_id, requested_by, environment, plan_version_id, cycle, amount_cents, request_key, expires_at)
  values (p_agency_id, p_user_id, p_environment, p_plan_version_id, p_cycle, v_amount, p_request_key, now() + make_interval(mins => s.checkout_minutes + 15))
  returning * into i;
  perform private.billing_audit('user', p_user_id, p_agency_id, null, 'intent.created', jsonb_build_object('intent_id', i.id, 'cycle', p_cycle, 'amount_cents', v_amount));
  return jsonb_build_object('reused', false, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i);
end $$;

-- Estado para a tela (campos novos: recovery, conflict, pending_checkout.dispatched_at).
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
        'verifying', i.status in ('dispatching', 'unknown'), 'retry_after', i.expires_at, 'dispatched_at', i.dispatched_at,
        'checkout_url', case when v_role = 'owner' then i.checkout_url end)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown')),
    -- Última tentativa já encerrada (expirada, cancelada ou com falha) nos últimos 7 dias, para explicar o que aconteceu.
    'last_intent', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'at', i.updated_at)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('completed', 'expired', 'canceled', 'failed')
        and i.updated_at > now() - interval '7 days' order by i.updated_at desc limit 1),
    'last_subscription', (select jsonb_build_object('status', s.status, 'activated', s.started_at is not null, 'canceled_at', s.canceled_at)
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

-- Fechamento por CHECKOUT_EXPIRED/CHECKOUT_CANCELED: expirar pelo Asaas confirma que não foi pago.
create or replace function public.billing_close_intent(p_environment text, p_checkout_id text, p_status text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare i private.billing_checkout_intents;
begin
  if p_status not in ('canceled', 'expired') then raise exception 'Estado inválido.' using errcode = '22023'; end if;
  select * into i from private.billing_checkout_intents where environment = p_environment and asaas_checkout_id = p_checkout_id for update;
  if not found then return 'unknown_checkout'; end if;
  if i.status = 'completed' then return 'already_completed'; end if;
  -- CHECKOUT_EXPIRED vindo do Asaas é a confirmação de que NÃO foi pago: libera uma nova contratação sem outra conferência.
  if p_status = 'expired' and i.status = 'expired' and i.verified_after_expiry_at is null and i.review_required_at is null then
    update private.billing_checkout_intents set verified_after_expiry_at = now(), updated_at = now() where id = i.id;
    return 'verified';
  end if;
  if i.status not in ('awaiting_payment', 'unknown', 'dispatching') then return 'noop'; end if;
  update private.billing_checkout_intents set status = p_status, updated_at = now(),
    verified_after_expiry_at = case when p_status = 'expired' and review_required_at is null then now() else verified_after_expiry_at end where id = i.id;
  perform private.billing_audit('system', null, i.agency_id, null, 'intent.' || p_status, jsonb_build_object('intent_id', i.id, 'source', 'checkout_event'));
  return 'closed';
end $$;

-- 4. Pagamento de assinatura desconhecida fica registrado.
create or replace function public.billing_apply_payment(p_environment text, p_snapshot jsonb, p_event_id bigint default null, p_signal text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  s private.billing_settings; sub private.billing_subscriptions; pay private.billing_payments;
  v_sub_ext text := p_snapshot ->> 'subscription'; v_id text := p_snapshot ->> 'id'; v_agency uuid;
  v_status text := upper(coalesce(p_snapshot ->> 'status', 'OTHER')); v_type text := upper(coalesce(p_snapshot ->> 'billingType', ''));
  v_amount integer := round((p_snapshot ->> 'value')::numeric * 100)::integer; v_due date := (p_snapshot ->> 'dueDate')::date;
  v_observed timestamptz := coalesce((p_snapshot ->> 'observedAt')::timestamptz, now());
  v_cand_end timestamptz; v_new_end timestamptz; v_prev text; v_grace timestamptz; v_confirmed timestamptz;
begin
  if v_sub_ext is null then return 'ignored_no_subscription'; end if;
  select agency_id into v_agency from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_sub_ext;
  if v_agency is null then
    -- Pagamento de uma assinatura que o iGrow não conhece (ex.: segunda assinatura do mesmo cliente): fica registrado na auditoria
    -- (uma vez por cobrança) para atendimento. Nada é ativado, cancelado ou reembolsado.
    select agency_id into v_agency from private.billing_customers where environment = p_environment and asaas_customer_id = p_snapshot ->> 'customer';
    if v_agency is not null then perform private.billing_lock_agency(v_agency); end if;
    if v_agency is not null and not exists (select 1 from private.billing_audit_log where agency_id = v_agency and action = 'payment.unlinked' and metadata ->> 'payment' = v_id) then
      perform private.billing_audit('system', null, v_agency, null, 'payment.unlinked',
        jsonb_build_object('payment', v_id, 'asaas_subscription_id', v_sub_ext, 'status', v_status, 'amount_cents', v_amount, 'event_id', p_event_id));
    end if;
    return 'unknown_subscription';
  end if;
  perform private.billing_lock_agency(v_agency);
  select * into sub from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_sub_ext for update;
  select * into s from private.billing_settings;
  if p_snapshot ->> 'customer' is distinct from sub.asaas_customer_id then
    update private.billing_subscriptions set attention_reason = 'Pagamento de outro cliente vinculado a esta assinatura.' where id = sub.id;
    return 'mismatch';
  end if;
  if v_status not in ('PENDING', 'AWAITING_RISK_ANALYSIS', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'OVERDUE', 'REFUNDED', 'REFUND_REQUESTED',
      'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED') then
    v_status := 'OTHER';
  end if;
  v_confirmed := nullif(coalesce(p_snapshot ->> 'confirmedDate', p_snapshot ->> 'paymentDate'), '')::timestamptz;

  -- Retrato mais antigo que o já gravado: ignorado (eventos fora de ordem não desfazem o que é mais novo).
  select * into pay from private.billing_payments where environment = p_environment and asaas_payment_id = v_id;
  if found and pay.observed_at > v_observed then return 'stale_snapshot'; end if;
  insert into private.billing_payments(environment, asaas_payment_id, agency_id, subscription_id, amount_cents, due_date, status, billing_type, confirmed_at, invoice_url, observed_at, last_event_id)
  values (p_environment, v_id, sub.agency_id, sub.id, v_amount, v_due, v_status, v_type, case when v_status in ('CONFIRMED', 'RECEIVED') then coalesce(v_confirmed, v_observed) end,
          left(p_snapshot ->> 'invoiceUrl', 600), v_observed, p_event_id)
  on conflict (environment, asaas_payment_id) do update set status = excluded.status, billing_type = excluded.billing_type, amount_cents = excluded.amount_cents,
    due_date = excluded.due_date, invoice_url = coalesce(excluded.invoice_url, private.billing_payments.invoice_url),
    confirmed_at = coalesce(private.billing_payments.confirmed_at, excluded.confirmed_at), observed_at = excluded.observed_at,
    last_event_id = excluded.last_event_id, updated_at = now();

  if v_amount <> sub.amount_cents then
    update private.billing_subscriptions set attention_reason = 'Valor do pagamento diverge do contratado.' where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.value_mismatch', jsonb_build_object('payment', v_id, 'expected', sub.amount_cents, 'received', v_amount));
    return 'mismatch';
  end if;

  if v_status in ('CONFIRMED', 'RECEIVED') then
    -- Só cartão de crédito libera acesso (pagamento "recebido em dinheiro" registrado à mão no Asaas nunca ativa nada).
    if v_type <> 'CREDIT_CARD' then
      update private.billing_subscriptions set attention_reason = 'Pagamento confirmado sem ser por cartão de crédito.' where id = sub.id;
      return 'mismatch';
    end if;
    if sub.status = 'canceled' then
      update private.billing_subscriptions set attention_reason = 'Pagamento confirmado em assinatura já cancelada: revisar estorno.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.after_cancel', jsonb_build_object('payment', v_id));
      return 'payment_for_canceled';
    end if;
    -- Período pago: do vencimento ao próximo ciclo. Nunca encolhe (eventos repetidos ou antigos não mudam nada).
    v_cand_end := (v_due::timestamp at time zone 'America/Sao_Paulo') + case sub.cycle when 'monthly' then interval '1 month' else interval '1 year' end;
    v_new_end := greatest(coalesce(sub.current_period_end, v_cand_end), v_cand_end);
    -- Cobrança antiga já superada por um atraso mais antigo ainda em aberto não reativa a assinatura.
    if sub.status in ('past_due', 'suspended') and sub.overdue_due_date is not null and v_due < sub.overdue_due_date then
      return 'recorded_only';
    end if;
    if sub.status = 'suspended' and v_new_end <= now() then
      update private.billing_subscriptions set attention_reason = 'Pagamento de cobrança antiga não cobre o período atual; aguardar a próxima cobrança.' where id = sub.id;
      return 'stale_payment';
    end if;
    if sub.status = 'active' and v_new_end = sub.current_period_end then return 'noop_duplicate'; end if;
    v_prev := sub.status;
    update private.billing_subscriptions set status = 'active', started_at = coalesce(started_at, now()),
      current_period_start = case when sub.current_period_start is null or v_new_end > sub.current_period_end then (v_due::timestamp at time zone 'America/Sao_Paulo') else sub.current_period_start end,
      current_period_end = v_new_end, next_due_date = (v_new_end at time zone 'America/Sao_Paulo')::date,
      grace_ends_at = null, overdue_due_date = null where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id,
      case v_prev when 'pending' then 'subscription.activated' when 'active' then 'payment.renewed' else 'subscription.reactivated' end,
      jsonb_build_object('payment', v_id, 'period_end', v_new_end, 'event_id', p_event_id));
    perform private.billing_sync_access(sub.agency_id);
    return 'activated';
  end if;

  if v_status = 'OVERDUE' or p_signal = 'capture_refused' then
    if sub.status = 'pending' then
      if v_status = 'OVERDUE' then
        update private.billing_subscriptions set status = 'canceled', canceled_at = now(), remote_cancel_pending = true where id = sub.id;
        perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.activation_failed', jsonb_build_object('payment', v_id));
        perform private.billing_sync_access(sub.agency_id);
        return 'activation_failed';
      end if;
      return 'recorded_only';
    end if;
    if sub.status in ('active', 'past_due') and (sub.overdue_due_date is null or v_due < sub.overdue_due_date) then
      -- Tolerância: vencimento + dias configurados, até o fim desse dia em Brasília.
      v_grace := ((v_due + s.past_due_grace_days + 1)::timestamp at time zone 'America/Sao_Paulo');
      update private.billing_subscriptions set status = 'past_due', overdue_due_date = v_due, grace_ends_at = v_grace where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.past_due', jsonb_build_object('payment', v_id, 'grace_ends_at', v_grace));
      return 'past_due';
    end if;
    return 'recorded_only';
  end if;

  if v_status in ('REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then
    -- Dinheiro devolvido ou contestado: pede decisão humana; o acesso não muda sozinho (evita bloqueio ou liberação indevidos).
    update private.billing_subscriptions set attention_reason = 'Estorno ou contestação em ' || v_id || ': revisar.' where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.' || lower(v_status), jsonb_build_object('payment', v_id));
    return 'needs_review';
  end if;
  return 'recorded_only';
end $$;

-- 1. Recuperação de intenção expirada, com vínculo inequívoco.
create or replace function public.billing_apply_subscription(p_environment text, p_snapshot jsonb, p_event_id bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id text := p_snapshot ->> 'id'; v_customer text := p_snapshot ->> 'customer'; v_value numeric := nullif(p_snapshot ->> 'value', '')::numeric;
  v_session text := nullif(p_snapshot ->> 'checkoutSession', ''); v_ext text := nullif(p_snapshot ->> 'externalReference', '');
  v_cycle text; v_amount integer; v_recovered boolean := false; v_link text; v_n integer; v_unknown integer; v_match integer; v_inactive boolean; v_agency uuid; sub private.billing_subscriptions; i private.billing_checkout_intents;
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
    -- Conflito financeiro: o pagamento não é descartado nem a assinatura atual é tocada; só fica marcado para atendimento.
    update private.billing_subscriptions set attention_reason = 'Conflito: há pagamento em outra assinatura deste cliente; revisar duplicidade (nada foi cancelado ou reembolsado).'
      where agency_id = v_agency and status <> 'canceled' and attention_reason is null;
    return 'duplicate_subscription';
  end if;
  -- Vínculo INEQUÍVOCO: só o identificador do checkout (checkoutSession) ou a referência da contratação (externalReference) desta
  -- assinatura, emitidos pelo Asaas e gravados na intenção antes do pagamento, ativam automaticamente. Cliente, valor, ciclo e data
  -- iguais NÃO bastam (coincidência): vão para revisão financeira, sem ativar, preservando a intenção e o pagamento.
  -- Não há prazo para o vínculo por identificador: uma assinatura legitimamente paga nunca se perde por demora do webhook.
  select * into i from private.billing_checkout_intents x where x.agency_id = v_agency and x.environment = p_environment
    and ((v_session is not null and x.asaas_checkout_id = v_session)
      or (v_ext ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and x.id = v_ext::uuid))
    order by x.created_at desc limit 1 for update;
  if found then
    v_link := 'checkout';
    if i.status in ('completed', 'canceled', 'failed') then
      perform private.billing_audit('system', null, v_agency, null, 'subscription.intent_closed',
        jsonb_build_object('asaas_subscription_id', v_id, 'intent_id', i.id, 'intent_status', i.status, 'event_id', p_event_id));
      return 'intent_closed';
    end if;
  else
    -- O identificador pertence à intenção de OUTRA organização: divergência grave, nunca vincula.
    if (v_session is not null and exists (select 1 from private.billing_checkout_intents x where x.environment = p_environment and x.asaas_checkout_id = v_session and x.agency_id <> v_agency))
       or (v_ext ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists (select 1 from private.billing_checkout_intents x where x.environment = p_environment and x.id = v_ext::uuid and x.agency_id <> v_agency)) then
      perform private.billing_audit('system', null, v_agency, null, 'subscription.cross_organization_checkout', jsonb_build_object('asaas_subscription_id', v_id, 'event_id', p_event_id));
      return 'mismatch';
    end if;
    -- Sem identificador que case com uma intenção desta organização. Candidatas = intenções já enviadas ao Asaas (em aberto ou expiradas).
    select count(*), count(*) filter (where x.asaas_checkout_id is null),
           count(*) filter (where x.cycle = v_cycle and x.amount_cents = v_amount and upper(coalesce(p_snapshot ->> 'billingType', '')) = 'CREDIT_CARD')
      into v_n, v_unknown, v_match
      from private.billing_checkout_intents x where x.agency_id = v_agency and x.environment = p_environment
       and x.status in ('dispatching', 'awaiting_payment', 'unknown', 'expired') and x.dispatched_at is not null;
    if v_n = 0 then return 'no_intent'; end if;
    -- Checkout informado que não é o de nenhuma candidata (todas conhecem o seu): identificador divergente.
    if (v_session is not null and v_unknown = 0) or v_ext ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform private.billing_audit('system', null, v_agency, null, 'subscription.checkout_mismatch', jsonb_build_object('asaas_subscription_id', v_id, 'event_id', p_event_id));
      return 'mismatch';
    end if;
    if v_match = 0 then
      perform private.billing_audit('system', null, v_agency, null, 'subscription.mismatch', jsonb_build_object('asaas_subscription_id', v_id, 'event_id', p_event_id));
      return 'mismatch';
    end if;
    -- Coincidência de cliente, valor, ciclo e cartão SEM identificador verificável: NUNCA ativa. Preserva intenção e pagamento, bloqueia nova
    -- cobrança e encaminha para revisão financeira.
    update private.billing_checkout_intents x set review_required_at = coalesce(x.review_required_at, now()), updated_at = now()
      where x.agency_id = v_agency and x.environment = p_environment and x.status in ('dispatching', 'awaiting_payment', 'unknown', 'expired')
        and x.dispatched_at is not null and x.cycle = v_cycle and x.amount_cents = v_amount;
    if not exists (select 1 from private.billing_audit_log where agency_id = v_agency and action = 'subscription.unlinked_candidate' and metadata ->> 'asaas_subscription_id' = v_id) then
      perform private.billing_audit('system', null, v_agency, null, 'subscription.unlinked_candidate',
        jsonb_build_object('asaas_subscription_id', v_id, 'candidates', v_match, 'reason', 'sem identificador de checkout verificável', 'event_id', p_event_id));
    end if;
    return 'unlinked_candidate';
  end if;
  v_recovered := i.status = 'expired';
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
  if v_recovered then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.recovered_after_expiry', jsonb_build_object('asaas_subscription_id', v_id, 'intent_id', i.id, 'link', v_link, 'event_id', p_event_id));
  end if;
  insert into private.billing_subscriptions(agency_id, environment, plan_version_id, cycle, amount_cents, asaas_subscription_id, asaas_customer_id, intent_id)
  values (v_agency, p_environment, i.plan_version_id, i.cycle, i.amount_cents, v_id, v_customer, i.id) returning * into sub;
  -- Intenção com resultado desconhecido aprende o identificador do checkout pelo qual a assinatura nasceu.
  update private.billing_checkout_intents set status = 'completed', subscription_id = sub.id, completed_at = now(), updated_at = now(),
    asaas_checkout_id = coalesce(asaas_checkout_id, v_session) where id = i.id;
  perform private.billing_audit('system', null, v_agency, sub.id, 'subscription.created',
    jsonb_build_object('intent_id', i.id, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'checkout_confirmed', coalesce(v_session = i.asaas_checkout_id, false), 'link', v_link, 'recovered_after_expiry', v_recovered));
  return 'created';
end $$;

-- 3. Trabalho de reconciliação. Passa a ser volátil: REIVINDICA as intenções a conferir (carimba recovery_checked_at com skip locked),
--    então duas execuções simultâneas do cron nunca conferem a mesma intenção ao mesmo tempo.
drop function if exists public.billing_reconcile_work(integer);
create or replace function public.billing_reconcile_work(p_limit integer default 20, p_environment text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_intents jsonb;
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

  return jsonb_build_object(
    -- Assinatura pendente (pagamento ainda não refletido) é conferida a cada 5 minutos por 3 dias; as demais, uma vez por dia.
    'reconcile', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'environment', x.environment, 'asaas_subscription_id', x.asaas_subscription_id) order by x.last_reconciled_at nulls first)
      from (select id, environment, asaas_subscription_id, last_reconciled_at from private.billing_subscriptions
            where status in ('pending', 'active', 'past_due', 'suspended')
              and (last_reconciled_at is null or last_reconciled_at <
                   now() - case when status = 'pending' and created_at > now() - interval '3 days' then interval '5 minutes' else interval '1 day' end)
            order by last_reconciled_at nulls first limit greatest(1, least(coalesce(p_limit, 20), 100))) x), '[]'::jsonb),
    'remote_cancel', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'environment', c.environment, 'asaas_subscription_id', c.asaas_subscription_id))
      from (select id, environment, asaas_subscription_id from private.billing_subscriptions where remote_cancel_pending limit 50) c), '[]'::jsonb),
    'intents', v_intents);
end $$;

-- Intenções expiradas que ainda bloqueiam uma nova contratação (para a conferência imediata, no momento de contratar).
create function public.billing_recovery_candidates(p_agency_id uuid, p_environment text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'asaas_customer_id', bc.asaas_customer_id)), '[]'::jsonb)
  from private.billing_checkout_intents i
  join private.billing_customers bc on bc.agency_id = i.agency_id and bc.environment = i.environment
  where i.agency_id = p_agency_id and i.environment = p_environment and i.status = 'expired' and i.dispatched_at is not null
    and i.verified_after_expiry_at is null;
$$;

-- Marca a intenção como conferida no Asaas DEPOIS da expiração (o checkout não pode mais ser pago; 2 minutos de folga para a assinatura
-- aparecer). Só o servidor chama, depois de listar as assinaturas do cliente com sucesso e sem resultado truncado.
create function public.billing_mark_intent_verified(p_intent_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_agency uuid;
begin
  update private.billing_checkout_intents set verified_after_expiry_at = now(), updated_at = now()
    where id = p_intent_id and status = 'expired' and verified_after_expiry_at is null and review_required_at is null and now() > expires_at + interval '2 minutes'
    returning agency_id into v_agency;
  if v_agency is null then return false; end if;
  perform private.billing_audit('system', null, v_agency, null, 'intent.verified_after_expiry', jsonb_build_object('intent_id', p_intent_id));
  return true;
end $$;

-- Tratamento financeiro: um OPERADOR da plataforma (após conferir no painel do Asaas) pode liberar uma intenção que o sistema não conseguiu
-- conferir sozinho. Nunca cria assinatura nem altera cobrança; exige justificativa e fica na auditoria (ator = operador).
create function public.billing_operator_release_intent(p_intent_id uuid, p_note text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_agency uuid;
begin
  perform private.require_operator();
  if char_length(btrim(coalesce(p_note, ''))) < 15 then raise exception 'Informe a justificativa da conferência (mínimo de 15 caracteres).' using errcode = '22023'; end if;
  update private.billing_checkout_intents set verified_after_expiry_at = now(), updated_at = now()
    where id = p_intent_id and status = 'expired' and verified_after_expiry_at is null returning agency_id into v_agency;
  if v_agency is null then return false; end if;
  perform private.billing_audit('operator', auth.uid(), v_agency, null, 'intent.released_by_operator', jsonb_build_object('intent_id', p_intent_id, 'note', left(btrim(p_note), 500)));
  return true;
end $$;

revoke all on function public.billing_recovery_candidates(uuid, text), public.billing_mark_intent_verified(uuid) from public, anon, authenticated;
grant execute on function public.billing_recovery_candidates(uuid, text), public.billing_mark_intent_verified(uuid) to service_role;
revoke all on function public.billing_reconcile_work(integer, text) from public, anon, authenticated;
grant execute on function public.billing_reconcile_work(integer, text) to service_role;
revoke all on function public.billing_operator_release_intent(uuid, text) from public, anon, service_role;
grant execute on function public.billing_operator_release_intent(uuid, text) to authenticated;

