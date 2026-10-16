begin;
set local search_path=public,extensions;
select no_plan();

-- Fixtures fictícias (nenhum dado real). Cada organização cobre um cenário de recuperação.
insert into auth.users(id,email,email_confirmed_at) values
('2c000000-0000-4000-8000-000000000001','dono@example.test',now()),
('2c000000-0000-4000-8000-000000000002','admin@example.test',now());
insert into agencies(id,name) select ('2caaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'Org '||n from generate_series(1,12) n;
insert into agency_users(agency_id,user_id,role) values
('2caaaaaa-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001','owner'),
('2caaaaaa-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000002','admin');

insert into agency_users(agency_id,user_id,role) select ('2caaaaaa-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, '2c000000-0000-4000-8000-000000000001', 'owner' from generate_series(2,12) n;

insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values ('2cbbbbbb-0000-4000-8000-000000000001','pro','Profissional','x','public',true,true,10);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values ('2cccccc0-0000-4000-8000-000000000001','2cbbbbbb-0000-4000-8000-000000000001',1,4990,49900);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('2cccccc0-0000-4000-8000-000000000001','clients',10);
update private.plan_versions set status='published',published_at=now() where id='2cccccc0-0000-4000-8000-000000000001';
update private.plans set current_version_id='2cccccc0-0000-4000-8000-000000000001' where id='2cbbbbbb-0000-4000-8000-000000000001';

create function public.zz_sub(p_id text,p_cust text,p_value numeric,p_cycle text,p_session text default null,p_ext text default null,p_created text default to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'))
returns jsonb language sql as $$
  select jsonb_build_object('id',p_id,'customer',p_cust,'value',p_value,'cycle',p_cycle,'status','ACTIVE','billingType','CREDIT_CARD','checkoutSession',p_session,'externalReference',p_ext,'dateCreated',p_created);
$$;
-- Cria cliente + intenção enviada (como o servidor) e a devolve; a expiração é simulada movendo o relógio da intenção para o passado.
create function public.zz_intent(p_agency uuid,p_cust text,p_checkout text,p_key text,p_cycle text default 'monthly') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform public.billing_set_customer(p_agency,'sandbox',p_cust);
  v := (public.billing_create_intent(p_agency,'2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001',p_cycle,p_key,'sandbox') ->> 'intent_id')::uuid;
  perform public.billing_mark_intent(v,'dispatching');
  if p_checkout is not null then perform public.billing_mark_intent(v,'awaiting_payment',p_checkout,'https://sandbox.example.test/'||p_checkout); else perform public.billing_mark_intent(v,'unknown'); end if;
  return v;
end $$;
create function public.zz_expire(p_intent uuid) returns void language sql as $$
  update private.billing_checkout_intents set status='expired', expires_at=now()-interval '1 hour', created_at=now()-interval '2 hours', dispatched_at=now()-interval '90 minutes' where id=p_intent;
$$;

-- Permissões das funções novas: só o servidor
select ok(has_function_privilege('service_role','public.billing_recovery_candidates(uuid,text)','execute') and has_function_privilege('service_role','public.billing_mark_intent_verified(uuid)','execute')
  and not has_function_privilege('authenticated','public.billing_recovery_candidates(uuid,text)','execute') and not has_function_privilege('anon','public.billing_mark_intent_verified(uuid)','execute'),'Funções de recuperação: só service_role');
select ok(has_function_privilege('service_role','public.billing_reconcile_work(integer,text)','execute') and not has_function_privilege('authenticated','public.billing_reconcile_work(integer,text)','execute'),'Trabalho de reconciliação segue só do servidor');
select ok(has_function_privilege('authenticated','public.billing_operator_release_intent(uuid,text)','execute') and not has_function_privilege('service_role','public.billing_operator_release_intent(uuid,text)','execute') and not has_function_privilege('anon','public.billing_operator_release_intent(uuid,text)','execute'),'Liberação por operador: só usuários autenticados (e exige operador com 2 etapas)');

-- CENÁRIO A: pago antes da expiração, webhook chega DEPOIS de a intenção expirar no relógio local → recuperada pelo vínculo do checkout
select set_config('t.a',public.zz_intent('2caaaaaa-0000-4000-8000-000000000001','cus_R0001','chk_R0001','chave-a-0001')::text,true);
select public.zz_expire(current_setting('t.a')::uuid);
select is((select status from private.billing_checkout_intents where id=current_setting('t.a')::uuid),'expired','A: a intenção está expirada no relógio local');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0001','cus_R0001',49.90,'MONTHLY','chk_R0001')),'created','A: assinatura paga (checkout confere) é recuperada mesmo com a intenção expirada');
select is((select status from private.billing_checkout_intents where id=current_setting('t.a')::uuid),'completed','A: a intenção é concluída e ligada à assinatura');
select is((select count(*)::int from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000001' and action='subscription.recovered_after_expiry'),1,'A: a recuperação fica registrada na auditoria');
select is((select metadata ->> 'link' from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000001' and action='subscription.created'),'checkout','A: vínculo pelo identificador do checkout');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0001','cus_R0001',49.90,'MONTHLY','chk_R0001')),'noop','A: o mesmo evento repetido não cria nada de novo');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000001'),1,'A: uma única assinatura financeira');

-- Valor, ciclo ou cartão diferentes continuam recusados, mesmo com o vínculo do checkout
select public.zz_expire(public.zz_intent('2caaaaaa-0000-4000-8000-000000000002','cus_R0002','chk_R0002','chave-b-0001'));
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0002','cus_R0002',99.90,'MONTHLY','chk_R0002')),'mismatch','Valor diferente do contratado: nunca ativa (vínculo não basta)');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0002','cus_R0002',49.90,'YEARLY','chk_R0002')),'mismatch','Ciclo diferente: nunca ativa');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000002'),0,'Nenhuma assinatura criada nos casos divergentes');

-- Checkout de OUTRA organização: o cliente é da organização 2, mas o checkout pertence à organização 1 → nunca vincula
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0003','cus_R0002',49.90,'MONTHLY','chk_R0001')),'mismatch','Checkout de outra organização: divergência grave, nunca vincula (e nada é criado)');
select is((select count(*)::int from private.billing_subscriptions where asaas_subscription_id='sub_R0003'),0,'... nenhuma assinatura criada');
-- externalReference de outra intenção
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0004','cus_R0002',49.90,'MONTHLY',null,current_setting('t.a'))),'mismatch','externalReference de intenção de outra organização: divergência grave, nunca vincula');

-- CENÁRIO B: checkout expirado sem pagamento → continua encerrado; nova contratação só depois de conferir no Asaas
select set_config('t.b',public.zz_intent('2caaaaaa-0000-4000-8000-000000000003','cus_R0005','chk_R0005','chave-c-0001')::text,true);
select public.zz_expire(current_setting('t.b')::uuid);
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000003'),0,'B: sem pagamento, nada é criado');
select throws_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000003','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-c-0002','sandbox')$$,'55000',null,'C: com resultado desconhecido (expirada, não conferida), nova contratação é BLOQUEADA');
select is(jsonb_array_length(public.billing_recovery_candidates('2caaaaaa-0000-4000-8000-000000000003','sandbox')),1,'C: a intenção aparece como candidata à conferência');
select is(public.billing_mark_intent_verified(current_setting('t.b')::uuid),true,'C: depois de conferir no Asaas, é marcada como conferida');
select is(public.billing_mark_intent_verified(current_setting('t.b')::uuid),false,'C: marcar de novo não faz nada');
select lives_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000003','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-c-0002','sandbox')$$,'C: conferida, uma nova contratação é liberada');
select is(jsonb_array_length(public.billing_recovery_candidates('2caaaaaa-0000-4000-8000-000000000003','sandbox')),0,'C: nada mais a conferir');

-- Conferir cedo demais (antes de 2 minutos da expiração) não libera
select set_config('t.b2',public.zz_intent('2caaaaaa-0000-4000-8000-000000000004','cus_R0006','chk_R0006','chave-d-0001')::text,true);
update private.billing_checkout_intents set status='expired', expires_at=now()-interval '30 seconds' where id=current_setting('t.b2')::uuid;
select is(public.billing_mark_intent_verified(current_setting('t.b2')::uuid),false,'Conferência antes da folga de 2 minutos após a expiração não vale');

-- CHECKOUT_EXPIRED vindo do Asaas é a confirmação de que não foi pago
select set_config('t.b3',public.zz_intent('2caaaaaa-0000-4000-8000-000000000005','cus_R0007','chk_R0007','chave-e-0001')::text,true);
select is(public.billing_close_intent('sandbox','chk_R0007','expired'),'closed','Evento do Asaas fecha a intenção como expirada');
select lives_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000005','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-e-0002','sandbox')$$,'... e libera nova contratação sem outra conferência');
-- Evento de checkout expirado depois de a intenção ter expirado no relógio
select set_config('t.b4',public.zz_intent('2caaaaaa-0000-4000-8000-000000000006','cus_R0008','chk_R0008','chave-f-0001')::text,true);
select public.zz_expire(current_setting('t.b4')::uuid);
select is(public.billing_close_intent('sandbox','chk_R0008','expired'),'verified','Intenção expirada no relógio + evento do Asaas: fica conferida');
select is(public.billing_close_intent('sandbox','chk_R0008','canceled'),'noop','Cancelamento tardio de intenção já expirada não muda nada');

-- Coincidência NÃO basta: intenção que nunca soube o checkout (resposta perdida) + assinatura com cliente, valor, ciclo e data iguais, mas SEM identificador verificável
select set_config('t.w',public.zz_intent('2caaaaaa-0000-4000-8000-000000000007','cus_R0009',null,'chave-g-0001')::text,true);
select public.zz_expire(current_setting('t.w')::uuid);
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0009','cus_R0009',99.90,'MONTHLY','chk_DESCONHECIDO')),'mismatch','Coincidência: valor diferente é divergência (nunca ativa)');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0009','cus_R0009',49.90,'MONTHLY','chk_DESCONHECIDO')),'unlinked_candidate','Coincidência (cliente, valor, ciclo, data, cartão) NÃO ativa: vai para revisão financeira');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000007'),0,'... nenhuma assinatura é criada');
select is((select status from private.billing_checkout_intents where id=current_setting('t.w')::uuid),'expired','... a intenção é preservada');
select ok((select review_required_at is not null and asaas_checkout_id is null from private.billing_checkout_intents where id=current_setting('t.w')::uuid),'... marcada para revisão, sem inventar vínculo (checkout continua desconhecido)');
select public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0009','cus_R0009',49.90,'MONTHLY','chk_DESCONHECIDO'));
select is((select count(*)::int from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000007' and action='subscription.unlinked_candidate'),1,'... registrado uma única vez, mesmo reprocessado');
select is(public.billing_mark_intent_verified(current_setting('t.w')::uuid),false,'... e a conferência automática NÃO libera nova contratação enquanto houver revisão pendente');
select throws_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000007','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-g-0002','sandbox')$$,'55000',null,'... nenhuma cobrança duplicada: nova contratação segue bloqueada');
select is(public.billing_close_intent('sandbox','chk_QUALQUER','expired'),'unknown_checkout','(evento de checkout desconhecido não libera nada)');

-- Checkout em aberto conhecido, mas assinatura SEM checkoutSession/externalReference: a coincidência também não ativa (comportamento anterior da 2.2B removido)
select set_config('t.o',public.zz_intent('2caaaaaa-0000-4000-8000-000000000008','cus_R0010','chk_R0010','chave-h-0001')::text,true);
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0010','cus_R0010',49.90,'MONTHLY',null,null)),'unlinked_candidate','Intenção em aberto + assinatura sem identificadores: revisão, não ativa');
select is((select status from private.billing_checkout_intents where id=current_setting('t.o')::uuid),'awaiting_payment','... a intenção em aberto é preservada');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0010','cus_R0010',49.90,'MONTHLY','chk_R0010')),'created','... com o checkoutSession correto, ativa normalmente');

-- Intenção cancelada pelo Asaas: pagamento posterior com o mesmo checkout vai para revisão (não reabre)
select set_config('t.c',public.zz_intent('2caaaaaa-0000-4000-8000-000000000009','cus_R0011','chk_R0011','chave-i-0001')::text,true);
select public.billing_close_intent('sandbox','chk_R0011','canceled');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0011','cus_R0011',49.90,'MONTHLY','chk_R0011')),'intent_closed','Intenção cancelada: pagamento posterior exige revisão, não ativa');

-- SEM prazo para o vínculo por identificador: intenção expirada há 40 dias ainda é recuperada pelo checkout (pagamento legítimo nunca se perde)
select public.billing_mark_intent_verified(id) from private.billing_checkout_intents where agency_id='2caaaaaa-0000-4000-8000-000000000002';
select public.zz_expire(public.zz_intent('2caaaaaa-0000-4000-8000-000000000002','cus_R0002','chk_R0012','chave-b-0002'));
update private.billing_checkout_intents set expires_at=now()-interval '40 days', created_at=now()-interval '41 days', dispatched_at=now()-interval '41 days' where asaas_checkout_id='chk_R0012';
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0012','cus_R0002',49.90,'MONTHLY','chk_R0012')),'created','Intenção expirada há 40 dias é recuperada pelo checkout (não há prazo)');
-- ... e sem decurso de prazo para liberar: intenção expirada e NÃO conferida há 10 dias continua bloqueando nova contratação
select public.zz_expire(public.zz_intent('2caaaaaa-0000-4000-8000-000000000012','cus_R0020','chk_R0020','chave-k-0001'));
update private.billing_checkout_intents set expires_at=now()-interval '10 days', created_at=now()-interval '11 days', dispatched_at=now()-interval '11 days' where asaas_checkout_id='chk_R0020';
select throws_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000012','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-k-0002','sandbox')$$,'55000',null,'Não conferida há 10 dias: o decurso de prazo NÃO libera nova contratação');
select ok((public.billing_recovery_candidates('2caaaaaa-0000-4000-8000-000000000012','sandbox')) @> jsonb_build_array(jsonb_build_object('status','expired')),'... e continua candidata à conferência');
select ok((select (public.billing_reconcile_work(20,'sandbox') -> 'intents') @> jsonb_build_array(jsonb_build_object('status','expired','asaas_customer_id','cus_R0020'))),'... e a reconciliação continua conferindo (a cada 30 min após o 1º dia, sem prazo final)');

-- CENÁRIO D: o Asaas tem pagamento de OUTRA assinatura da organização que já tem a sua → conflito registrado, nada é descartado nem cancelado
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0013','cus_R0001',49.90,'MONTHLY','chk_OUTRO')),'duplicate_subscription','D: segunda assinatura do mesmo cliente não é ativada');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000001' and status<>'canceled'),1,'D: continua uma só assinatura viva');
select ok((select attention_reason like 'Conflito:%' from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000001' and status<>'canceled'),'D: a assinatura atual fica marcada para atendimento');
select is((select count(*)::int from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000001' and action='subscription.duplicate_detected'),1,'D: o conflito fica registrado');
select is(public.billing_apply_payment('sandbox',jsonb_build_object('id','pay_R0013','subscription','sub_R0013','customer','cus_R0001','value',49.90,'dueDate','2026-10-15','status','CONFIRMED','billingType','CREDIT_CARD','observedAt',now())),'unknown_subscription','D: a cobrança da assinatura duplicada não é aplicada à atual');
select public.billing_apply_payment('sandbox',jsonb_build_object('id','pay_R0013','subscription','sub_R0013','customer','cus_R0001','value',49.90,'dueDate','2026-10-15','status','CONFIRMED','billingType','CREDIT_CARD','observedAt',now()));
select is((select count(*)::int from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000001' and action='payment.unlinked' and metadata ->> 'payment'='pay_R0013'),1,'D: o pagamento não vinculado é registrado uma única vez (não descartado em silêncio)');
select is((select count(*)::int from private.billing_payments where asaas_payment_id='pay_R0013'),0,'D: nenhum pagamento é atribuído à assinatura errada');

-- Estado para a tela
set local role authenticated;
select set_config('request.jwt.claim.sub','2c000000-0000-4000-8000-000000000001',true);
select is((public.get_agency_billing('2caaaaaa-0000-4000-8000-000000000001') ->> 'conflict')::boolean,true,'Tela: conflito sinalizado ao proprietário');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Reconciliação: reivindica intenções a conferir, sem repetir entre execuções (cron e webhook simultâneos)
update private.billing_checkout_intents set recovery_checked_at=null;
update private.billing_checkout_intents set recovery_checked_at=null;
select set_config('t.first',(public.billing_reconcile_work(20,'sandbox') -> 'intents')::text,true);
select ok(jsonb_array_length(current_setting('t.first')::jsonb) > 0,'1ª execução reivindica intenções a conferir');
select ok(current_setting('t.first')::jsonb @> jsonb_build_array(jsonb_build_object('id',current_setting('t.b2')::uuid,'status','expired')),'... inclusive a expirada e ainda não conferida');
select is(jsonb_array_length(public.billing_reconcile_work(20,'sandbox') -> 'intents'),0,'2ª execução imediata (outro cron ou webhook) não repete as mesmas intenções');
select is((select count(*)::int from private.billing_checkout_intents where recovery_checked_at is not null),jsonb_array_length(current_setting('t.first')::jsonb)::int,'Só as reivindicadas foram carimbadas');
-- Conferida há mais de 4 minutos volta a ser conferida; expirada já conferida só a cada 6 horas
update private.billing_checkout_intents set recovery_checked_at=now()-interval '5 minutes' where id=current_setting('t.b2')::uuid;
select ok((public.billing_reconcile_work(20,'sandbox') -> 'intents') @> jsonb_build_array(jsonb_build_object('id',current_setting('t.b2')::uuid)),'Passados 4 minutos, a intenção volta a ser conferida');
update private.billing_checkout_intents set expires_at=now()-interval '10 minutes', verified_after_expiry_at=now(), recovery_checked_at=now()-interval '1 hour' where id=current_setting('t.b2')::uuid;
select ok(not ((public.billing_reconcile_work(20,'sandbox') -> 'intents') @> jsonb_build_array(jsonb_build_object('id',current_setting('t.b2')::uuid))),'Expirada já conferida não é consultada de novo antes de 6 horas');

-- Assinatura pendente: reconferida a cada 5 minutos (pagamento ainda não refletido); ativa só diariamente
select ok((select count(*) from private.billing_subscriptions where status='pending') >= 1,'Há assinatura pendente a conferir');
update private.billing_subscriptions set last_reconciled_at=now()-interval '6 minutes', reconcile_attempted_at=null where asaas_subscription_id='sub_R0001';
select ok((public.billing_reconcile_work(20,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_R0001')),'Pendente há mais de 5 minutos entra na reconciliação');
update private.billing_subscriptions set last_reconciled_at=now()-interval '1 minute' where asaas_subscription_id='sub_R0001';
select ok(not ((public.billing_reconcile_work(20,'sandbox') -> 'reconcile') @> jsonb_build_array(jsonb_build_object('asaas_subscription_id','sub_R0001'))),'Conferida há 1 minuto não é repetida');

-- Assinatura ANUAL expirada e recuperada: ciclo e valor integral (sem parcelamento) conferem com a intenção
select public.zz_expire(public.zz_intent('2caaaaaa-0000-4000-8000-000000000011','cus_R0014','chk_R0014','chave-j-0001','yearly'));
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0014','cus_R0014',499.00,'MONTHLY','chk_R0014')),'mismatch','Anual: assinatura mensal não é aceita para uma contratação anual');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_R0014','cus_R0014',499.00,'YEARLY','chk_R0014')),'created','Anual: valor integral (R$ 499,00) e ciclo anual conferem → recuperada');
select is((select cycle||'/'||amount_cents from private.billing_subscriptions where asaas_subscription_id='sub_R0014'),'yearly/49900','Anual: gravado com o valor e o ciclo da contratação');

-- Tratamento financeiro por operador (após conferir no painel do Asaas): libera, com justificativa e auditoria; nunca cria assinatura
insert into auth.users(id,email,email_confirmed_at) values ('2c000000-0000-4000-8000-0000000000f1','operador@example.test',now());
insert into private.platform_operators(user_id,role) values ('2c000000-0000-4000-8000-0000000000f1','owner');
set local role authenticated;
select set_config('request.jwt.claim.sub','2c000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.billing_operator_release_intent('00000000-0000-4000-8000-000000000000','justificativa suficiente')$$,'42501',null,'Usuário comum (dono da organização) não libera intenção');
select set_config('request.jwt.claim.sub','2c000000-0000-4000-8000-0000000000f1',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select public.billing_operator_release_intent('00000000-0000-4000-8000-000000000000','justificativa suficiente')$$,'42501',null,'Operador sem a segunda etapa não libera');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.billing_operator_release_intent('00000000-0000-4000-8000-000000000000','curta')$$,'22023',null,'Sem justificativa suficiente, não libera');
select is(public.billing_operator_release_intent(current_setting('t.w')::uuid,'Conferido no painel do Asaas: nenhuma assinatura paga localizada'),true,'Operador com 2 etapas e justificativa libera a intenção em revisão');
select is(public.billing_operator_release_intent(current_setting('t.w')::uuid,'Conferido no painel do Asaas: nenhuma assinatura paga localizada'),false,'Repetir não faz nada');
reset role;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from private.billing_audit_log where agency_id='2caaaaaa-0000-4000-8000-000000000007' and action='intent.released_by_operator' and actor_type='operator'),1,'A liberação fica na auditoria com o operador como ator');
select is((select count(*)::int from private.billing_subscriptions where agency_id='2caaaaaa-0000-4000-8000-000000000007'),0,'A liberação nunca cria assinatura');
select lives_ok($$select public.billing_create_intent('2caaaaaa-0000-4000-8000-000000000007','2c000000-0000-4000-8000-000000000001','2cccccc0-0000-4000-8000-000000000001','monthly','chave-g-0003','sandbox')$$,'Depois da liberação auditada, a nova contratação é permitida');

-- Organização antiga, sem assinatura nem intenção: intocada pelas rotinas
select public.billing_run_maintenance();
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2caaaaaa-0000-4000-8000-000000000010'),0,'Organização sem contratação não recebe plano nem restrição');
select is(public.agency_billing_restricted('2caaaaaa-0000-4000-8000-000000000010'),false,'Organização antiga continua sem restrição');

select * from finish();
rollback;
