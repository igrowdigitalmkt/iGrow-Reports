-- TESTE (não faz parte do produto): simulação da tolerância de 7 dias, da suspensão e da regularização em HOMOLOGAÇÃO.
-- Tudo acontece dentro de UMA transação que termina em exceção proposital (SIMULACAO_REVERTIDA): organização, assinatura, cobranças e
-- auditoria fictícias NÃO ficam gravadas. Não fala com o Asaas, não muda o relógio e não toca em nenhuma organização real.
-- Executar com o MCP execute_sql (projeto de homologação) ou psql. A mensagem final traz o resultado de cada passo.
do $t$
declare
  v_owner uuid := '22000000-0000-4000-8000-000000000001';
  v_plan  uuid := '22cccccc-0000-4000-8000-000000000001';   -- "TESTE-2.2 Plano pago": 49,90/mês
  v_org uuid; v_intent uuid; v_sid uuid; v_log text := '';
  v_cus text := 'cus_SIM_' || substr(md5(random()::text), 1, 8);
  v_chk text := 'chk_SIM_' || substr(md5(random()::text), 1, 8);
  v_sub text := 'sub_SIM_' || substr(md5(random()::text), 1, 8);
  v_due date := current_date - 8;      -- renovação que venceu há 8 dias (fora dos 7 dias de tolerância)
  r text; sub private.billing_subscriptions; ai jsonb; acc text;
begin
  insert into public.agencies(name) values ('TESTE-2.2 SIMULACAO ' || v_chk) returning id into v_org;
  insert into public.agency_users(agency_id, user_id, role) values (v_org, v_owner, 'owner');
  perform public.billing_set_customer(v_org, 'sandbox', v_cus);
  v_intent := (public.billing_create_intent(v_org, v_owner, v_plan, 'monthly', 'sim-' || v_chk, 'sandbox') ->> 'intent_id')::uuid;
  perform public.billing_mark_intent(v_intent, 'dispatching');
  perform public.billing_mark_intent(v_intent, 'awaiting_payment', v_chk, 'https://sandbox.example.test/' || v_chk);
  r := public.billing_apply_subscription('sandbox', jsonb_build_object('id', v_sub, 'customer', v_cus, 'value', 49.9, 'cycle', 'MONTHLY', 'status', 'ACTIVE', 'billingType', 'CREDIT_CARD', 'checkoutSession', v_chk), null);
  v_log := v_log || 'assinatura=' || r;
  -- 1ª cobrança paga há ~38 dias (ativação), depois a renovação vencida (OVERDUE) há 8 dias.
  r := public.billing_apply_payment('sandbox', jsonb_build_object('id', 'pay_SIM_a', 'subscription', v_sub, 'customer', v_cus, 'value', 49.9, 'dueDate', (v_due - 30)::text, 'status', 'CONFIRMED', 'billingType', 'CREDIT_CARD', 'confirmedDate', (v_due - 30)::text, 'observedAt', (now() - interval '9 days')::text), null, null);
  v_log := v_log || ' | ativação=' || r;
  update private.billing_subscriptions set current_period_end = (v_due::timestamp at time zone 'America/Sao_Paulo') where agency_id = v_org;  -- período pago terminou no vencimento da renovação
  r := public.billing_apply_payment('sandbox', jsonb_build_object('id', 'pay_SIM_b', 'subscription', v_sub, 'customer', v_cus, 'value', 49.9, 'dueDate', v_due::text, 'status', 'OVERDUE', 'billingType', 'CREDIT_CARD', 'observedAt', (now() - interval '8 days')::text), null, null);
  select * into sub from private.billing_subscriptions where agency_id = v_org;
  v_log := v_log || ' | atraso=' || r || ' (status ' || sub.status || ', tolerância até ' || sub.grace_ends_at || ', acesso ' || (select access_state from private.agency_plan_assignments where agency_id = v_org) || ')';

  -- Tolerância ainda vigente? (simulado: grace_ends_at futuro → manutenção NÃO suspende)
  update private.billing_subscriptions set grace_ends_at = now() + interval '1 hour' where agency_id = v_org;
  perform public.billing_run_maintenance();
  select * into sub from private.billing_subscriptions where agency_id = v_org;
  v_log := v_log || ' | dentro da tolerância: status=' || sub.status || ' acesso=' || (select access_state from private.agency_plan_assignments where agency_id = v_org);

  -- Tolerância esgotada (simulado: grace_ends_at vencido) → suspensão.
  update private.billing_subscriptions set grace_ends_at = now() - interval '1 minute' where agency_id = v_org;
  perform public.billing_run_maintenance();
  select * into sub from private.billing_subscriptions where agency_id = v_org;
  acc := (select access_state from private.agency_plan_assignments where agency_id = v_org);
  v_log := v_log || ' | após tolerância: status=' || sub.status || ' acesso=' || acc || ' restrito=' || public.agency_billing_restricted(v_org);
  v_log := v_log || ' | direitos=[' || (select string_agg(d.key || '=' || (private.resolve_entitlement(v_org, d.key)).enabled || '/' || coalesce((private.resolve_entitlement(v_org, d.key)).limit_value::text, '-'), ',' order by d.key) from private.entitlement_definitions d) || ']';
  begin
    set local role service_role;
    ai := public.agency_ai_entitlement(v_org);
    reset role;
    v_log := v_log || ' | IA=' || ai::text;
  exception when others then reset role; v_log := v_log || ' | IA: não verificada (' || sqlerrm || ')';
  end;
  v_log := v_log || ' | dados preservados: organização=' || (select count(*) from public.agencies where id = v_org) || ' membros=' || (select count(*) from public.agency_users where agency_id = v_org);
  r := public.billing_run_maintenance()::text;
  select * into sub from private.billing_subscriptions where agency_id = v_org;
  v_log := v_log || ' | 2ª manutenção idempotente: status=' || sub.status;

  -- Regularização: a mesma cobrança em atraso passa a CONFIRMED (mais nova que o retrato OVERDUE).
  r := public.billing_apply_payment('sandbox', jsonb_build_object('id', 'pay_SIM_b', 'subscription', v_sub, 'customer', v_cus, 'value', 49.9, 'dueDate', v_due::text, 'status', 'CONFIRMED', 'billingType', 'CREDIT_CARD', 'confirmedDate', current_date::text, 'observedAt', now()::text), null, null);
  select * into sub from private.billing_subscriptions where agency_id = v_org;
  v_log := v_log || ' | regularização=' || r || ' status=' || sub.status || ' tolerância=' || coalesce(sub.grace_ends_at::text, 'zerada') || ' período até ' || sub.current_period_end
    || ' acesso=' || (select access_state from private.agency_plan_assignments where agency_id = v_org) || ' restrito=' || public.agency_billing_restricted(v_org);
  r := public.billing_apply_payment('sandbox', jsonb_build_object('id', 'pay_SIM_b', 'subscription', v_sub, 'customer', v_cus, 'value', 49.9, 'dueDate', v_due::text, 'status', 'CONFIRMED', 'billingType', 'CREDIT_CARD', 'confirmedDate', current_date::text, 'observedAt', now()::text), null, null);
  v_log := v_log || ' | repetição=' || r || ' | pagamentos=' || (select count(*) from private.billing_payments where agency_id = v_org) || ' assinaturas=' || (select count(*) from private.billing_subscriptions where agency_id = v_org)
    || ' | auditoria=[' || (select string_agg(action, ',' order by id) from private.billing_audit_log where agency_id = v_org and action like 'subscription.%' or action = 'payment.renewed' and agency_id = v_org) || ']';
  raise exception 'SIMULACAO_REVERTIDA: %', v_log;
end $t$;
