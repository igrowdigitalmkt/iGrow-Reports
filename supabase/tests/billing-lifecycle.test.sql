begin;
set local search_path=public,extensions;
select no_plan();

-- Fixtures fictícias. U1 = proprietário das organizações 1-6, 8 e 9; U2 admin e U3 editor da organização 1; U4 proprietário da organização 7.
insert into auth.users(id,email,email_confirmed_at) values
('2d000000-0000-4000-8000-000000000001','dono@example.test',now()),('2d000000-0000-4000-8000-000000000002','admin@example.test',now()),
('2d000000-0000-4000-8000-000000000003','editor@example.test',now()),('2d000000-0000-4000-8000-000000000004','outro@example.test',now());
insert into agencies(id,name) select ('2daaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'Org '||n from generate_series(1,9) n;
insert into agency_users(agency_id,user_id,role) select ('2daaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, '2d000000-0000-4000-8000-000000000001', 'owner' from generate_series(1,9) n where n <> 7;
insert into agency_users(agency_id,user_id,role) values
('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002','admin'),
('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000003','editor'),
('2daaaaaa-0000-4000-8000-000000000007','2d000000-0000-4000-8000-000000000004','owner');
insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values ('2dbbbbbb-0000-4000-8000-000000000001','pro','Profissional','x','public',true,true,10);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values ('2dcccccc-0000-4000-8000-000000000001','2dbbbbbb-0000-4000-8000-000000000001',1,4990,49900);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('2dcccccc-0000-4000-8000-000000000001','clients',10);
update private.plan_versions set status='published',published_at=now() where id='2dcccccc-0000-4000-8000-000000000001';
update private.plans set current_version_id='2dcccccc-0000-4000-8000-000000000001' where id='2dbbbbbb-0000-4000-8000-000000000001';

-- Assinatura ATIVA como no fluxo real: intenção com checkout → assinatura pelo checkoutSession → cobrança confirmada (vencimento p_due).
create function public.zz_activate(p_n int, p_user uuid, p_cycle text, p_due date) returns uuid language plpgsql as $$
declare v_agency uuid := ('2daaaaaa-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid; v_cust text := 'cus_L'||p_n; v_chk text := 'chk_L'||p_n; v_int uuid; v_value numeric := case p_cycle when 'monthly' then 49.90 else 499.00 end;
begin
  perform public.billing_set_customer(v_agency,'sandbox',v_cust);
  v_int := (public.billing_create_intent(v_agency,p_user,'2dcccccc-0000-4000-8000-000000000001',p_cycle,'chave-l-'||p_n,'sandbox') ->> 'intent_id')::uuid;
  perform public.billing_mark_intent(v_int,'dispatching');
  perform public.billing_mark_intent(v_int,'awaiting_payment',v_chk,'https://sandbox.example.test/'||v_chk);
  perform public.billing_apply_subscription('sandbox',jsonb_build_object('id','sub_L'||p_n,'customer',v_cust,'value',v_value,'cycle',upper(p_cycle),'status','ACTIVE','billingType','CREDIT_CARD','checkoutSession',v_chk));
  perform public.billing_apply_payment('sandbox',public.zz_pay('pay_L'||p_n||'a','sub_L'||p_n,v_cust,v_value,p_due,'CONFIRMED'));
  return (select id from private.billing_subscriptions where asaas_subscription_id='sub_L'||p_n);
end $$;
create function public.zz_pay(p_id text,p_sub text,p_cust text,p_value numeric,p_due date,p_status text,p_observed timestamptz default now()) returns jsonb language sql as $$
  select jsonb_build_object('id',p_id,'subscription',p_sub,'customer',p_cust,'value',p_value,'dueDate',p_due,'status',p_status,'billingType','CREDIT_CARD','confirmedDate',case when p_status in ('CONFIRMED','RECEIVED') then p_due end,'observedAt',p_observed);
$$;

select ok(has_function_privilege('service_role','public.billing_request_cancel(uuid,uuid)','execute') and not has_function_privilege('authenticated','public.billing_request_cancel(uuid,uuid)','execute') and not has_function_privilege('anon','public.billing_confirm_remote_cancel(uuid)','execute'),'Cancelamento e confirmação remota: só o servidor (que confere o proprietário)');

-- ======================= RENOVAÇÃO MENSAL =======================
select public.zz_activate(3,'2d000000-0000-4000-8000-000000000001','monthly',current_date);
select is((select status||'/'||cycle||'/'||amount_cents from private.billing_subscriptions where asaas_subscription_id='sub_L3'),'active/monthly/4990','Mensal: assinatura ativa pelo pagamento confirmado');
select set_config('t.end3a',(select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L3'),true);
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3b','sub_L3','cus_L3',49.90,(current_date + interval '1 month')::date,'PENDING')),'recorded_only','Mensal: cobrança da próxima mensalidade ainda PENDENTE não amplia o período');
select is((select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L3'),current_setting('t.end3a'),'Mensal: período inalterado enquanto não há confirmação financeira');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3b','sub_L3','cus_L3',49.90,(current_date + interval '1 month')::date,'CONFIRMED')),'activated','Mensal: renovação CONFIRMADA atualiza o período');
select ok((select current_period_end > current_setting('t.end3a')::timestamptz and current_period_end = ((current_date + interval '2 month')::timestamp at time zone 'America/Sao_Paulo') from private.billing_subscriptions where asaas_subscription_id='sub_L3'),'Mensal: novo período = vencimento da renovação + 1 mês');
select is((select (next_due_date = (current_date + interval '2 month')::date)::text from private.billing_subscriptions where asaas_subscription_id='sub_L3'),'true','Mensal: próximo vencimento atualizado');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2daaaaaa-0000-4000-8000-000000000003'),1,'Mensal: nenhuma segunda assinatura para representar a renovação');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000003'),1,'Mensal: direitos não duplicados');
select is((select count(*)::int from private.billing_audit_log where agency_id='2daaaaaa-0000-4000-8000-000000000003' and action='payment.renewed'),1,'Mensal: renovação auditada uma vez');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3b','sub_L3','cus_L3',49.90,(current_date + interval '1 month')::date,'CONFIRMED')),'noop_duplicate','Pagamento duplicado: o mesmo pagamento não conta duas vezes');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3b','sub_L3','cus_L3',49.90,(current_date + interval '1 month')::date,'CONFIRMED',now() - interval '1 hour')),'stale_snapshot','Evento fora de ordem (retrato antigo) é ignorado');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3a','sub_L3','cus_L3',49.90,current_date,'CONFIRMED')),'noop_duplicate','Cobrança antiga reaplicada depois não encolhe o período');
select is((select count(*)::int from private.billing_payments where subscription_id=(select id from private.billing_subscriptions where asaas_subscription_id='sub_L3')),2,'Duas cobranças registradas, nenhuma contada em dobro');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3c','sub_L3','cus_L3',10.00,(current_date + interval '2 month')::date,'CONFIRMED')),'mismatch','Valor diferente do contratado nunca amplia o período');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L3d','sub_OUTRA','cus_L3',49.90,(current_date + interval '2 month')::date,'CONFIRMED')),'unknown_subscription','Cobrança de assinatura desconhecida não amplia nada');

-- ======================= RENOVAÇÃO ANUAL =======================
select public.zz_activate(4,'2d000000-0000-4000-8000-000000000001','yearly',current_date);
select ok((select current_period_end = ((current_date + interval '1 year')::timestamp at time zone 'America/Sao_Paulo') and cycle='yearly' and amount_cents=49900 from private.billing_subscriptions where asaas_subscription_id='sub_L4'),'Anual: pagamento integral dá 12 meses de período');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L4b','sub_L4','cus_L4',499.00,(current_date + interval '1 year')::date,'CONFIRMED')),'activated','Anual: renovação anual confirmada');
select ok((select current_period_end = ((current_date + interval '2 year')::timestamp at time zone 'America/Sao_Paulo') from private.billing_subscriptions where asaas_subscription_id='sub_L4'),'Anual: novo período anual (e não mensal)');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2daaaaaa-0000-4000-8000-000000000004'),1,'Anual: continua uma só assinatura');

-- ======================= CANCELAMENTO (mensal) =======================
select public.zz_activate(1,'2d000000-0000-4000-8000-000000000001','monthly',current_date);
select set_config('t.end1',(select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L1'),true);
select throws_ok($$select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000002')$$,'42501',null,'Administrador não cancela');
select throws_ok($$select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000003')$$,'42501',null,'Editor não cancela');
select throws_ok($$select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000004')$$,'42501',null,'Proprietário de OUTRA organização não cancela');
select throws_ok($$select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000008','2d000000-0000-4000-8000-000000000001')$$,'22023',null,'Organização sem assinatura: nada a cancelar');
select is((select status||'/'||coalesce(cancel_requested_at::text,'-') from private.billing_subscriptions where asaas_subscription_id='sub_L1'),'active/-','Pedidos recusados não alteram a assinatura');
select is((public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001') ->> 'remote_cancel_pending')::boolean,true,'Proprietário: pedido registrado, aviso ao Asaas pendente');
select is((select status||'/'||cancel_at_period_end::text||'/'||remote_cancel_pending::text from private.billing_subscriptions where asaas_subscription_id='sub_L1'),'active/true/true','Continua ATIVA (período pago preservado); renovação marcada para parar');
select is((select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L1'),current_setting('t.end1'),'O fim do período pago NÃO muda com o cancelamento');
select is((select access_state||'/'||kind from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000001'),'full/subscription','O acesso continua completo');
select is((public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000001','2d000000-0000-4000-8000-000000000001') ->> 'remote_cancel_pending')::boolean,true,'Clique duplo / pedido repetido: devolve o mesmo pedido');
select is((select count(*)::int from private.billing_audit_log where agency_id='2daaaaaa-0000-4000-8000-000000000001' and action='subscription.cancel_requested'),1,'... e a auditoria registra o pedido uma única vez');
select is((public.billing_reconcile_work(20,'sandbox') -> 'remote_cancel') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L1')),true,'Timeout do Asaas: o cancelamento pendente volta para a reconciliação');
set local role authenticated;
select set_config('request.jwt.claim.sub','2d000000-0000-4000-8000-000000000001',true);
select is((public.get_agency_billing('2daaaaaa-0000-4000-8000-000000000001') -> 'subscription' ->> 'remote_cancel_pending')::boolean,true,'A tela recebe "cancelamento pendente" (não afirma que a renovação parou)');
select is(public.get_agency_billing('2daaaaaa-0000-4000-8000-000000000001') -> 'subscription' ->> 'status','active','A tela recebe o estado ativo até o fim do período');
select set_config('request.jwt.claim.sub','2d000000-0000-4000-8000-000000000002',true);
select is((public.get_agency_billing('2daaaaaa-0000-4000-8000-000000000001') ->> 'can_contract')::boolean,false,'Administrador consulta, mas não pode contratar/cancelar');
reset role;
select set_config('request.jwt.claim.sub','',true);
select public.billing_confirm_remote_cancel((select id from private.billing_subscriptions where asaas_subscription_id='sub_L1'));
select public.billing_confirm_remote_cancel((select id from private.billing_subscriptions where asaas_subscription_id='sub_L1'));
select is((select count(*)::int from private.billing_audit_log where agency_id='2daaaaaa-0000-4000-8000-000000000001' and action='subscription.remote_cancel_confirmed'),1,'Confirmação do Asaas auditada uma vez (repetida não duplica)');
select is((select remote_cancel_pending::text from private.billing_subscriptions where asaas_subscription_id='sub_L1'),'false','Aviso ao Asaas concluído');
select is(public.billing_apply_subscription('sandbox',jsonb_build_object('id','sub_L1','customer','cus_L1','value',49.90,'cycle','MONTHLY','status','INACTIVE','deleted',true,'billingType','CREDIT_CARD')),'cancel_already_recorded','Webhook de remoção depois do cancelamento: nada muda (já registrado)');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L1x','sub_L1','cus_L1',49.90,(current_date + interval '1 month')::date,'PENDING')),'recorded_only','Cobrança pendente que chega depois do cancelamento não amplia o período');
select is((public.billing_run_maintenance() ->> 'subscriptions_canceled')::int,0,'Dentro do período pago nada é encerrado');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L1'),'active','... a assinatura segue ativa');
-- Fim do período pago
update private.billing_subscriptions set current_period_end = now() - interval '1 minute' where asaas_subscription_id='sub_L1';
select is((public.billing_run_maintenance() ->> 'subscriptions_canceled')::int >= 1,true,'Fim do período pago: a assinatura é encerrada');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L1'),'canceled','Cancelada');
select is((select access_state from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000001'),'restricted','Acesso pago restrito depois do período pago');
select is((select count(*)::int from public.agencies a join private.billing_customers c on c.agency_id=a.id join agency_users u on u.agency_id=a.id where a.id='2daaaaaa-0000-4000-8000-000000000001'),3,'Organização, cliente financeiro e equipe preservados (nada apagado)');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000001'),true,'Recursos pagos bloqueados (automações pagas e IA)');
select is(((public.billing_reconcile_work(20,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L1'))),false,'Assinatura cancelada não é mais reconferida');

-- ======================= CANCELAMENTO (anual): período anual preservado =======================
select public.zz_activate(2,'2d000000-0000-4000-8000-000000000001','yearly',current_date - 90);
select set_config('t.end2',(select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L2'),true);
select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000002','2d000000-0000-4000-8000-000000000001');
select is((select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_L2'),current_setting('t.end2'),'Anual cancelada no 90º dia: o fim do período anual pago NÃO é antecipado');
select is((select status||'/'||access_state from private.billing_subscriptions s join private.agency_plan_assignments a on a.agency_id=s.agency_id where s.asaas_subscription_id='sub_L2'),'active/full','Anual cancelada: acesso completo até o fim do período');

-- ======================= INADIMPLÊNCIA, TOLERÂNCIA, SUSPENSÃO, REGULARIZAÇÃO =======================
select public.zz_activate(5,'2d000000-0000-4000-8000-000000000001','monthly',current_date - 31);
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L5'),'active','Inadimplência: assinatura ativa e em dia até o vencimento');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L5b','sub_L5','cus_L5',49.90,current_date - 1,'OVERDUE')),'past_due','Um dia de atraso: assinatura em atraso');
select is((select access_state from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000005'),'full','Um dia de atraso: o acesso continua completo (tolerância)');
select ok((select grace_ends_at = (((current_date - 1) + 8)::timestamp at time zone 'America/Sao_Paulo') from private.billing_subscriptions where asaas_subscription_id='sub_L5'),'Tolerância de 7 dias: vai até o fim do 7º dia depois do vencimento');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000005'),false,'Durante a tolerância nada é bloqueado');
select is((public.billing_run_maintenance() ->> 'subscriptions_suspended')::int,0,'Dentro dos 7 dias a manutenção não suspende');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L5b','sub_L5','cus_L5',49.90,current_date - 1,'OVERDUE',now() + interval '1 second')),'recorded_only','Evento de atraso repetido não reinicia a tolerância');
update private.billing_subscriptions set grace_ends_at = now() - interval '1 second' where asaas_subscription_id='sub_L5';
select is((public.billing_run_maintenance() ->> 'subscriptions_suspended')::int,1,'Tolerância esgotada: suspensão automática');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L5'),'suspended','Suspensa');
select is((select access_state from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000005'),'restricted','Suspensa: acesso restrito');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000005'),true,'Suspensa: recursos pagos bloqueados');
select is((select count(*)::int from agency_users where agency_id='2daaaaaa-0000-4000-8000-000000000005'),1,'Suspensa: equipe e dados preservados');
select is(((public.billing_reconcile_work(20,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L5'))),true,'Suspensa: continua sendo reconferida (regularização percebida mesmo sem webhook)');
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L5b','sub_L5','cus_L5',49.90,current_date - 1,'CONFIRMED',now() + interval '1 minute')),'activated','Regularização: pagamento da cobrança em atraso confirmado');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L5'),'active','Regularizada: ativa de novo');
select is((select access_state from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000005'),'full','Regularizada: direitos restaurados');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000005'),false,'Regularizada: recursos pagos liberados de novo');
select ok((select grace_ends_at is null and overdue_due_date is null from private.billing_subscriptions where asaas_subscription_id='sub_L5'),'Regularizada: tolerância e atraso zerados');
select is((select count(*)::int from private.billing_audit_log where agency_id='2daaaaaa-0000-4000-8000-000000000005' and action='subscription.reactivated'),1,'Regularização auditada');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2daaaaaa-0000-4000-8000-000000000005'),1,'Regularizar não cria outra assinatura');

-- Contratação inicial recusada NÃO ganha tolerância
select public.billing_set_customer('2daaaaaa-0000-4000-8000-000000000006','sandbox','cus_L6');
select set_config('t.i6',(public.billing_create_intent('2daaaaaa-0000-4000-8000-000000000006','2d000000-0000-4000-8000-000000000001','2dcccccc-0000-4000-8000-000000000001','monthly','chave-l-6','sandbox') ->> 'intent_id'),true);
select public.billing_mark_intent(current_setting('t.i6')::uuid,'dispatching');
select public.billing_mark_intent(current_setting('t.i6')::uuid,'awaiting_payment','chk_L6','https://sandbox.example.test/chk_L6');
select public.billing_apply_subscription('sandbox',jsonb_build_object('id','sub_L6','customer','cus_L6','value',49.90,'cycle','MONTHLY','status','ACTIVE','billingType','CREDIT_CARD','checkoutSession','chk_L6'));
select is(public.billing_apply_payment('sandbox',public.zz_pay('pay_L6a','sub_L6','cus_L6',49.90,current_date,'OVERDUE')),'activation_failed','Primeira cobrança não paga: contratação encerrada, SEM tolerância de 7 dias');
select is((select status||'/'||coalesce(grace_ends_at::text,'sem tolerância') from private.billing_subscriptions where asaas_subscription_id='sub_L6'),'canceled/sem tolerância','Nunca esteve em atraso nem ativa');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000006'),0,'Nenhum direito pago foi concedido');

-- ======================= COMPATIBILIDADE E ISOLAMENTO =======================
select public.zz_activate(7,'2d000000-0000-4000-8000-000000000004','monthly',current_date);
select throws_ok($$select public.billing_request_cancel('2daaaaaa-0000-4000-8000-000000000007','2d000000-0000-4000-8000-000000000001')$$,'42501',null,'Isolamento: proprietário de outra organização não cancela a assinatura desta');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_L7'),'active','Isolamento: a assinatura da organização 7 não foi tocada pelos cancelamentos/atrasos das outras');
insert into private.agency_plan_assignments(agency_id,plan_version_id,kind,access_state,note) values ('2daaaaaa-0000-4000-8000-000000000009','2dcccccc-0000-4000-8000-000000000001','administrative','full','cortesia de teste');
select public.billing_run_maintenance();
select is((select kind||'/'||access_state from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000009'),'administrative/full','Concessão administrativa gratuita preservada pelas rotinas');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000009'),false,'Concessão administrativa nunca é restrita pelo financeiro');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2daaaaaa-0000-4000-8000-000000000008'),0,'Organização antiga sem assinatura: nenhum plano ou restrição criado');
select is(public.agency_billing_restricted('2daaaaaa-0000-4000-8000-000000000008'),false,'Organização antiga continua sem restrição');

-- ======================= CADÊNCIA DA RECONCILIAÇÃO =======================
select public.zz_activate(8,'2d000000-0000-4000-8000-000000000001','monthly',current_date - 29);
update private.billing_subscriptions set last_reconciled_at = now() - interval '2 hours' where asaas_subscription_id in ('sub_L8','sub_L7','sub_L3','sub_L4','sub_L2');
select is(((public.billing_reconcile_work(50,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L8'))),true,'Vence hoje ou amanhã e a renovação ainda não chegou: reconferida de hora em hora');
select is(((public.billing_reconcile_work(50,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L4'))),false,'Assinatura anual longe do vencimento: segue diária');
update private.billing_subscriptions set last_reconciled_at = now() - interval '30 minutes' where asaas_subscription_id='sub_L8';
select is(((public.billing_reconcile_work(50,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L8'))),false,'Reconferida há 30 min não repete (sem excesso de consultas ao gateway)');

-- ======================= RECONCILIAÇÃO: PRIORIDADE, RODÍZIO E NÃO-INANIÇÃO =======================
-- Muitas assinaturas "com erro" (ex.: de teste) não podem impedir a conferência de quem precisa de atendimento.
select public.zz_activate(9,'2d000000-0000-4000-8000-000000000001','monthly',current_date - 29);
update private.billing_subscriptions set status = 'canceled', canceled_at = now() where asaas_subscription_id not in ('sub_L5','sub_L8','sub_L9','sub_L3','sub_L4');
update private.billing_subscriptions set last_reconciled_at = now() - interval '3 hours', reconcile_attempted_at = null;
update private.billing_subscriptions set status = 'suspended', grace_ends_at = now() - interval '1 day' where asaas_subscription_id = 'sub_L9';
update private.billing_subscriptions set last_reconciled_at = now() - interval '2 days' where asaas_subscription_id in ('sub_L3','sub_L4','sub_L5');
select set_config('t.r1',(public.billing_reconcile_work(2,'sandbox') -> 'reconcile')::text,true);
select is(jsonb_array_length(current_setting('t.r1')::jsonb),2,'Limite por rodada respeitado');
select ok(current_setting('t.r1')::jsonb @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L9')),'Suspensa vem ANTES das demais (prioridade a quem precisa de atendimento)');
select is((select count(*)::int from private.billing_subscriptions where reconcile_attempted_at is not null),2,'As reivindicadas ficam carimbadas (tentativa), mesmo sem sucesso');
select set_config('t.r2',(public.billing_reconcile_work(2,'sandbox') -> 'reconcile')::text,true);
select is(jsonb_array_length(current_setting('t.r2')::jsonb),2,'2ª rodada: traz OUTRAS assinaturas (as que falharam não ficam presas no topo da fila)');
select is(current_setting('t.r2')::jsonb @> current_setting('t.r1')::jsonb,false,'2ª rodada não repete as reivindicadas há menos de 4 minutos');
select set_config('t.r3',(public.billing_reconcile_work(10,'sandbox') -> 'reconcile')::text,true);
select is(jsonb_array_length(current_setting('t.r3')::jsonb),1,'3ª rodada: só sobra a última elegível; nada é perdido e nada se repete');
select is(jsonb_array_length(public.billing_reconcile_work(10,'sandbox') -> 'reconcile'),0,'Todas tentadas: nenhuma é repetida antes de 4 minutos');
update private.billing_subscriptions set reconcile_attempted_at = now() - interval '5 minutes';
select ok(((public.billing_reconcile_work(10,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L9'))),'Passados 4 minutos, a que falhou volta a ser tentada (sem prazo final)');
select is(((public.billing_reconcile_work(10,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_L9'))),false,'... mas só uma vez por janela');

-- ======================= VÍNCULO COM O EVENTO DE ORIGEM (0006) =======================
-- Cobrança futura PENDING extra na assinatura da organização 3 (não altera período, estado nem direitos).
select public.billing_apply_payment('sandbox',public.zz_pay('pay_L3x','sub_L3','cus_L3',49.90,current_date+60,'PENDING',now()+interval '1 minute'),777);
select is((select last_event_id from private.billing_payments where asaas_payment_id='pay_L3x'),777::bigint,'Pagamento registrado por um evento guarda o id do evento');
select public.billing_apply_payment('sandbox',public.zz_pay('pay_L3x','sub_L3','cus_L3',49.90,current_date+60,'PENDING',now()+interval '2 minutes'),null);
select is((select last_event_id from private.billing_payments where asaas_payment_id='pay_L3x'),777::bigint,'Releitura sem evento (reconciliação) NÃO apaga o vínculo com o evento de origem');
select public.billing_apply_payment('sandbox',public.zz_pay('pay_L3x','sub_L3','cus_L3',49.90,current_date+60,'PENDING',now()+interval '3 minutes'),778);
select is((select last_event_id from private.billing_payments where asaas_payment_id='pay_L3x'),778::bigint,'Um novo evento atualiza o vínculo');

select * from finish();
rollback;
