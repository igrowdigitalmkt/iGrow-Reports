-- Etapa 2.2I: a reconciliação (sem evento) não pode apagar o vínculo do pagamento com o evento de origem.
-- Mudança única em billing_apply_payment: last_event_id passa a ser coalesce(novo, existente). Resto idêntico ao da 0004.
-- NÃO aplicada em nenhum banco nesta etapa (arquivo preparado).

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
    last_event_id = coalesce(excluded.last_event_id, private.billing_payments.last_event_id), updated_at = now();

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
