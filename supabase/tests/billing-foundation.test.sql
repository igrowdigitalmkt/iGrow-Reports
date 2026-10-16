begin;
set local search_path=public,extensions;
select no_plan();

-- Fixtures (papel de banco).
insert into auth.users(id,email,email_confirmed_at) values
('fb000000-0000-4000-8000-000000000001','operador@example.test',now()),
('fb000000-0000-4000-8000-000000000002','dono-a@example.test',now()),
('fb000000-0000-4000-8000-000000000003','dono-b@example.test',now()),
('fb000000-0000-4000-8000-000000000004','editor-a@example.test',now()),
('fb000000-0000-4000-8000-000000000005','dono-c@example.test',now()),
('fb000000-0000-4000-8000-000000000006','dono-d@example.test',now()),
('fb000000-0000-4000-8000-000000000007','dono-ef@example.test',now()),
('fb000000-0000-4000-8000-000000000008','admin-a@example.test',now());
insert into agencies(id,name) values
('fbaaaaaa-0000-4000-8000-000000000001','Org A'),('fbaaaaaa-0000-4000-8000-000000000002','Org B'),('fbaaaaaa-0000-4000-8000-000000000003','Org C'),
('fbaaaaaa-0000-4000-8000-000000000004','Org D'),('fbaaaaaa-0000-4000-8000-000000000005','Org E'),('fbaaaaaa-0000-4000-8000-000000000006','Org F'),
('fbaaaaaa-0000-4000-8000-000000000007','Org legada sem plano');
insert into agency_users(agency_id,user_id,role) values
('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','owner'),
('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000004','editor'),
('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000008','admin'),
('fbaaaaaa-0000-4000-8000-000000000002','fb000000-0000-4000-8000-000000000003','owner'),
('fbaaaaaa-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000005','owner'),
('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','owner'),
('fbaaaaaa-0000-4000-8000-000000000005','fb000000-0000-4000-8000-000000000007','owner'),
('fbaaaaaa-0000-4000-8000-000000000006','fb000000-0000-4000-8000-000000000007','owner');
insert into private.platform_operators(user_id,role) values ('fb000000-0000-4000-8000-000000000001','owner');

-- Planos de teste (catálogo da etapa 2.1; publicados direto como dono do banco).
insert into private.plans(id,key,name,sellable) values
('fbb00000-0000-4000-8000-000000000001','pago','Plano pago',true),
('fbb00000-0000-4000-8000-000000000002','fechado','Plano fora de venda',false),
('fbb00000-0000-4000-8000-000000000003','teste','Plano do teste gratuito',false);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values
('fbc00000-0000-4000-8000-000000000001','fbb00000-0000-4000-8000-000000000001',1,4990,49900),
('fbc00000-0000-4000-8000-000000000002','fbb00000-0000-4000-8000-000000000002',1,1000,10000),
('fbc00000-0000-4000-8000-000000000003','fbb00000-0000-4000-8000-000000000003',1,null,null);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values
('fbc00000-0000-4000-8000-000000000001','clients',3),('fbc00000-0000-4000-8000-000000000003','clients',1);
insert into private.plan_version_entitlements(plan_version_id,key,enabled) values ('fbc00000-0000-4000-8000-000000000001','ai_assistant',true);
update private.plan_versions set status='published',published_at=now();
update private.plans set current_version_id=(select id from private.plan_versions where plan_id=plans.id);

-- Montador de retratos (o que o servidor leria na API do Asaas).
create function public.zz_snap(p_id text,p_sub text,p_cust text,p_value numeric,p_due date,p_status text,p_type text,p_observed text)
returns jsonb language sql as $$
  select jsonb_build_object('id',p_id,'subscription',p_sub,'customer',p_cust,'value',p_value,'dueDate',p_due,'status',p_status,'billingType',p_type,'observedAt',p_observed,'invoiceUrl','https://example.test/fatura/'||p_id);
$$;
-- Desde a correção de recuperação (0004) só o identificador do checkout ativa. O helper simula o Asaas: a assinatura nasce do checkout da
-- intenção em aberto do cliente (se a intenção ainda não tem checkout, ele é gravado aqui, como se o Asaas o tivesse criado antes).
create function public.zz_sub(p_id text,p_cust text,p_value numeric,p_cycle text,p_status text default 'ACTIVE',p_type text default 'CREDIT_CARD')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session text; v_intent uuid;
begin
  select i.id, i.asaas_checkout_id into v_intent, v_session from private.billing_checkout_intents i
    join private.billing_customers bc on bc.agency_id = i.agency_id and bc.environment = i.environment
    where bc.asaas_customer_id = p_cust and i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') limit 1;
  if v_intent is not null and v_session is null then
    v_session := 'chk_zz_' || replace(p_cust, ' ', '');
    update private.billing_checkout_intents set asaas_checkout_id = v_session where id = v_intent;
  end if;
  return jsonb_build_object('id',p_id,'customer',p_cust,'value',p_value,'cycle',p_cycle,'status',p_status,'billingType',p_type,'checkoutSession',v_session);
end $$;

-- Estrutura e permissões
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.billing_settings'::regclass,'private.billing_customers'::regclass,'private.billing_checkout_intents'::regclass,'private.billing_subscriptions'::regclass,'private.billing_payments'::regclass,'private.billing_trials'::regclass,'private.billing_events'::regclass,'private.billing_audit_log'::regclass)),'RLS ativa em todas as tabelas financeiras');
select ok(not has_table_privilege('authenticated','private.billing_subscriptions','select') and not has_table_privilege('anon','private.billing_payments','select')
  and not has_table_privilege('service_role','private.billing_events','select') and not has_table_privilege('service_role','private.billing_audit_log','insert'),'Tabelas financeiras sem acesso direto pela API (nem pelo servidor)');
select ok(has_function_privilege('service_role','public.billing_create_intent(uuid,uuid,uuid,text,text,text)','execute') and has_function_privilege('service_role','public.billing_apply_payment(text,jsonb,bigint,text)','execute')
  and not has_function_privilege('authenticated','public.billing_create_intent(uuid,uuid,uuid,text,text,text)','execute') and not has_function_privilege('anon','public.billing_apply_payment(text,jsonb,bigint,text)','execute')
  and not has_function_privilege('authenticated','public.billing_apply_subscription(text,jsonb,bigint)','execute') and not has_function_privilege('authenticated','public.billing_run_maintenance()','execute'),'Mudanças financeiras são só do servidor');
select ok(has_function_privilege('authenticated','public.get_agency_billing(uuid)','execute') and not has_function_privilege('anon','public.get_agency_billing(uuid)','execute')
  and not has_function_privilege('service_role','public.platform_billing_overview(uuid)','execute'),'Leituras: só usuários autenticados (e conferem papel/operador)');
select ok(not has_function_privilege('authenticated','private.billing_sync_access(uuid)','execute') and not has_function_privilege('service_role','private.billing_audit(text,uuid,uuid,uuid,text,jsonb)','execute'),'Funções internas não são chamáveis pela API');
select is((select count(*)::int from private.billing_subscriptions)+(select count(*)::int from private.billing_trials)+(select count(*)::int from private.billing_checkout_intents)+(select count(*)::int from private.billing_payments),0,'A migration não cria assinatura, teste, intenção nem pagamento');
select is((select trial_days||'/'||past_due_grace_days||'/'||live_enabled::text||'/'||downgrade_timing from private.billing_settings),'7/7/false/next_cycle','Padrões aprovados: teste 7 dias, tolerância 7 dias, produção desligada');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000007','clients')),'unmanaged','Organização legada continua sem restrição comercial');

-- Contratação: dono, preço do servidor, idempotência e duplicidade
set local role service_role;
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000004','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','sandbox')$$,'42501',null,'Editor não contrata');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000008','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','sandbox')$$,'42501',null,'Administrador também não contrata (só o proprietário)');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000003','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','sandbox')$$,'42501',null,'Dono de outra organização não contrata aqui');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','production')$$,'42501',null,'Produção do Asaas é recusada pelo banco enquanto não liberada');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000002','monthly','chave-a-0001','sandbox')$$,'22023',null,'Plano fora de venda não é contratável');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','quinzenal','chave-a-0001','sandbox')$$,'22023',null,'Ciclo inválido é recusado');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','monthly','curta','sandbox')$$,'22023',null,'Chave de idempotência curta é recusada');
select set_config('t.i1',(public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','sandbox'))::text,true);
select is((current_setting('t.i1')::jsonb ->> 'amount_cents')::int,4990,'Valor mensal vem do plano no servidor');
select is((current_setting('t.i1')::jsonb ->> 'reused')::boolean,false,'Primeira solicitação cria a intenção');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0001','sandbox') ->> 'intent_id'),current_setting('t.i1')::jsonb ->> 'intent_id','Reenvio da mesma solicitação devolve a mesma intenção');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','yearly','chave-a-0002','sandbox') ->> 'intent_id'),current_setting('t.i1')::jsonb ->> 'intent_id','Segunda aba com outra chave reaproveita a intenção em andamento (nunca cria duas)');
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','yearly','chave-a-0001','sandbox')$$,'22023',null,'Mesma chave com outro ciclo é recusada');
select throws_ok($$select public.billing_mark_intent((current_setting('t.i1')::jsonb ->> 'intent_id')::uuid,'completed')$$,'22023',null,'Intenção não pode ser dada como concluída pelo servidor');
select throws_ok($$select public.billing_mark_intent((current_setting('t.i1')::jsonb ->> 'intent_id')::uuid,'awaiting_payment','chk_AAAA0001')$$,'22023',null,'Não se pode pular o registro do envio ao Asaas (criada → aguardando pagamento)');
select is((public.billing_mark_intent((current_setting('t.i1')::jsonb ->> 'intent_id')::uuid,'dispatching') ->> 'status'),'dispatching','O envio ao Asaas é registrado ANTES da chamada');
select is((public.billing_mark_intent((current_setting('t.i1')::jsonb ->> 'intent_id')::uuid,'awaiting_payment','chk_AAAA0001','https://sandbox.example.test/checkout/chk_AAAA0001') ->> 'status'),'awaiting_payment','Checkout criado: aguardando pagamento');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','monthly','chave-a-0003','sandbox') ->> 'asaas_checkout_id'),'chk_AAAA0001','Nova solicitação durante o pagamento devolve o checkout existente');
reset role;
select throws_ok($$insert into private.billing_checkout_intents(agency_id,environment,plan_version_id,cycle,amount_cents,request_key,expires_at) values ('fbaaaaaa-0000-4000-8000-000000000001','sandbox','fbc00000-0000-4000-8000-000000000001','monthly',4990,'chave-x-9999',now()+interval '1 hour')$$,'23505',null,'Índice único: no máximo uma contratação em andamento por organização');

-- Timeout (resultado desconhecido) bloqueia nova contratação até o checkout vencer; recusa definitiva libera
set local role service_role;
select set_config('t.d1',(public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','yearly','chave-d-0001','sandbox') ->> 'intent_id'),true);
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','yearly','chave-d-0001','sandbox') ->> 'status'),'creating','Intenção é gravada ANTES da chamada ao Asaas');
select lives_ok($$select public.billing_mark_intent(current_setting('t.d1')::uuid,'dispatching')$$,'Intenção D: envio registrado');
select is((public.billing_mark_intent(current_setting('t.d1')::uuid,'unknown',null,null,'timeout') ->> 'status'),'unknown','Timeout deixa a intenção como desconhecida');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','monthly','chave-d-0002','sandbox') ->> 'intent_id'),current_setting('t.d1'),'Com resultado desconhecido, nenhuma segunda criação é permitida');
reset role;
select is((select extract(epoch from expires_at - dispatched_at)::int from private.billing_checkout_intents where id=current_setting('t.d1')::uuid),1920,'Bloqueio por resultado desconhecido = prazo do checkout (30 min) + 2 min, não mais que isso');
update private.billing_checkout_intents set expires_at=now()-interval '3 minutes' where id=current_setting('t.d1')::uuid;
set local role service_role;
select is((public.billing_run_maintenance() ->> 'intents_expired')::int,1,'Manutenção expira intenção vencida');
-- Etapa 2.2B (correção): intenção expirada com checkout já enviado só libera nova contratação depois de conferida no Asaas.
select throws_ok($$select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','monthly','chave-d-0002','sandbox')$$,'55000',null,'Expirada e ainda não conferida no Asaas: nova contratação aguarda a conferência');
select is(public.billing_mark_intent_verified(current_setting('t.d1')::uuid),true,'Conferida no Asaas (sem assinatura): liberada');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','monthly','chave-d-0002','sandbox') ->> 'reused')::boolean,false,'Depois do prazo a organização pode tentar de novo');
select is((public.billing_mark_intent((select (public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','monthly','chave-d-0002','sandbox') ->> 'intent_id')::uuid),'failed',null,null,'recusado') ->> 'status'),'failed','Recusa definitiva marca a intenção como falha');
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000004','fb000000-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000001','monthly','chave-d-0004','sandbox') ->> 'reused')::boolean,false,'Após falha definitiva é possível tentar novamente');

-- Cliente financeiro
select is(public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000001','sandbox','cus_AAAA0001'),'cus_AAAA0001','Cliente financeiro registrado');
select is(public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000001','sandbox','cus_OUTRO0002'),'cus_AAAA0001','Já existente: mantém o primeiro (não duplica)');
select throws_ok($$select public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000002','sandbox','cus_AAAA0001')$$,'23505',null,'Um cliente do Asaas não pertence a duas organizações');
select throws_ok($$select public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000001','production','cus_PROD0001')$$,'42501',null,'Cliente de produção é recusado enquanto não liberado');

-- Assinatura: só nasce de fato verificado e casada com a intenção
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_DESCONHECIDO',49.90,'MONTHLY')),'unattributed','Assinatura de cliente desconhecido não é atribuída');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_AAAA0001',10.00,'MONTHLY')),'mismatch','Valor diferente do contratado é recusado');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_AAAA0001',49.90,'YEARLY')),'mismatch','Ciclo diferente do contratado é recusado');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_AAAA0001',49.90,'MONTHLY','ACTIVE','BOLETO')),'mismatch','Só cartão de crédito é aceito');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_AAAA0001',49.90,'MONTHLY')),'created','Assinatura verificada é registrada');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0001','cus_AAAA0001',49.90,'MONTHLY')),'noop','Evento repetido da assinatura não faz nada');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_AAAA0002','cus_AAAA0001',49.90,'MONTHLY')),'duplicate_subscription','Segunda assinatura da mesma organização é detectada e não ativada');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'pending','Assinatura nasce pendente (ainda sem pagamento confirmado)');
select is((select status from private.billing_checkout_intents where id=(current_setting('t.i1')::jsonb ->> 'intent_id')::uuid),'completed','Intenção vinculada à assinatura');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),0,'Assinatura pendente não concede plano nem direitos');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','clients')),'unmanaged','Sem pagamento confirmado, a organização segue como antes');
select throws_ok($$insert into private.billing_subscriptions(agency_id,environment,plan_version_id,cycle,amount_cents,asaas_subscription_id,asaas_customer_id) values ('fbaaaaaa-0000-4000-8000-000000000001','sandbox','fbc00000-0000-4000-8000-000000000001','monthly',4990,'sub_XXXX9999','cus_AAAA0001')$$,'23505',null,'Índice único: uma assinatura viva por organização');
select throws_ok($$insert into private.billing_subscriptions(agency_id,environment,plan_version_id,cycle,amount_cents,asaas_subscription_id,asaas_customer_id) values ('fbaaaaaa-0000-4000-8000-000000000002','sandbox','fbc00000-0000-4000-8000-000000000001','monthly',4990,'sub_XXXX9998','cus_AAAA0001')$$,'23503',null,'Assinatura não pode usar o cliente financeiro de outra organização');

-- Pagamentos: confirmação, duplicidade, fora de ordem, divergências
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',49.90,current_date,'PENDING','CREDIT_CARD','2026-10-15T09:00:00Z')),'recorded_only','Cobrança pendente não ativa nada');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'pending','Pagamento pendente mantém a assinatura pendente');
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',49.90,current_date,'CONFIRMED','BOLETO','2026-10-15T10:00:00Z')),'mismatch','Pagamento que não é de cartão não ativa');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',10.00,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:01:00Z')),'mismatch','Valor divergente não ativa');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_DESCONHECIDO',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:02:00Z')),'mismatch','Cliente divergente não ativa');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_NAO_EXISTE','cus_AAAA0001',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:03:00Z')),'unknown_subscription','Assinatura desconhecida é sinalizada ao servidor');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001',null,'cus_AAAA0001',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:04:00Z')),'ignored_no_subscription','Cobrança avulsa (sem assinatura) é ignorada');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'pending','Nenhuma tentativa indevida ativou a assinatura');
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:10:00Z'),1),'activated','Cartão confirmado e verificado ativa a assinatura');
reset role;
select is((select status||'/'||(current_period_end is not null)::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'active/true','Assinatura ativa com período pago');
select is((select kind||'/'||access_state||'/'||plan_version_id::text from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'subscription/full/fbc00000-0000-4000-8000-000000000001','Plano da versão contratada é ativado como assinatura');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','clients')),'plan','Direitos passam a vir do plano contratado');
select is((select limit_value from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','clients')),3,'Limites da versão exata contratada');
select is((select count(*)::int from private.billing_payments where asaas_payment_id='pay_AAAA0001' and status='CONFIRMED'),1,'Pagamento espelhado');
select is((select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),((current_date::timestamp at time zone 'America/Sao_Paulo')+interval '1 month')::text,'Período pago: um mês a partir do vencimento');
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-15T10:20:00Z'),2),'noop_duplicate','Evento duplicado não renova duas vezes');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0001','sub_AAAA0001','cus_AAAA0001',49.90,current_date,'PENDING','CREDIT_CARD','2026-10-15T09:30:00Z')),'stale_snapshot','Retrato antigo (evento fora de ordem) não desfaz o que é mais novo');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0002','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '1 month')::date,'CONFIRMED','CREDIT_CARD','2026-11-15T10:00:00Z'),3),'activated','Renovação mensal confirmada estende o período');
reset role;
select is((select current_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),((((current_date+interval '1 month')::date)::timestamp at time zone 'America/Sao_Paulo')+interval '1 month')::text,'Período avançou mais um mês');
select throws_ok($$update private.billing_subscriptions set plan_version_id='fbc00000-0000-4000-8000-000000000002' where asaas_subscription_id='sub_AAAA0001'$$,'42501',null,'Plano contratado não muda por atualização direta');
select throws_ok($$update private.billing_subscriptions set status='pending' where asaas_subscription_id='sub_AAAA0001'$$,'22023',null,'Máquina de estados recusa transição inválida (ativa → pendente)');

-- Concessão do Super Admin não vira nem substitui assinatura paga; operador não confirma pagamento
set local role authenticated;
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_assign_plan('fbaaaaaa-0000-4000-8000-000000000001','fbc00000-0000-4000-8000-000000000001','tentativa de sobrescrever assinatura')$$,'22023',null,'Concessão administrativa não sobrescreve assinatura paga');
select throws_ok($$select public.billing_apply_payment('sandbox','{}'::jsonb)$$,'42501',null,'Super Admin não confirma pagamento (função só do servidor)');
select lives_ok($$select public.platform_billing_overview()$$,'Super Admin consulta a situação financeira');
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.platform_billing_overview()$$,'42501',null,'Quem não é operador não consulta o painel financeiro');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Atraso, tolerância de 7 dias e suspensão
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0003','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '2 months')::date,'OVERDUE','CREDIT_CARD','2026-12-16T10:00:00Z'),4),'past_due','Renovação em atraso: assinatura fica em atraso');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'past_due','Estado em atraso');
select is((select grace_ends_at::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),((((current_date+interval '2 months')::date+8)::timestamp) at time zone 'America/Sao_Paulo')::text,'Tolerância: vencimento + 7 dias, até o fim desse dia');
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'full','Durante a tolerância o acesso é preservado');
set local role service_role;
select is((public.billing_run_maintenance() ->> 'subscriptions_suspended')::int,0,'Dentro da tolerância não suspende');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0003','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '2 months')::date,'PENDING','CREDIT_CARD','2026-12-15T10:00:00Z')),'stale_snapshot','Evento antigo de atraso não reabre a cobrança');
reset role;
update private.billing_subscriptions set grace_ends_at=now()-interval '1 minute' where asaas_subscription_id='sub_AAAA0001';
set local role service_role;
select is((public.billing_run_maintenance() ->> 'subscriptions_suspended')::int,1,'Tolerância esgotada: suspende');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'suspended','Estado suspenso');
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'restricted','Suspensão restringe o acesso');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','clients')),'billing_restricted','Direitos refletem a suspensão');
select is((select enabled from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','ai_assistant')),false,'Funcionalidades pagas ficam desligadas');
select throws_ok($$insert into clients(agency_id,name) values ('fbaaaaaa-0000-4000-8000-000000000001','Novo cliente bloqueado')$$,'53400',null,'Suspensa: novos cadastros são bloqueados');
select cmp_ok((select count(*)::int from clients where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'>=',0,'Suspensa: os dados existentes continuam legíveis e nada foi apagado');
set local role authenticated;
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000002',true);
select is((public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000001') -> 'subscription' ->> 'status'),'suspended','Área da assinatura continua acessível e mostra a suspensão');
reset role;
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0003','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '2 months')::date,'CONFIRMED','CREDIT_CARD','2026-12-17T10:00:00Z'),5),'activated','Regularização: pagamento confirmado reativa');
reset role;
select is((select status||'/'||coalesce(grace_ends_at::text,'-')||'/'||coalesce(overdue_due_date::text,'-') from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'active/-/-','Reativada sem pendências de atraso');
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'full','Acesso restaurado');
select lives_ok($$insert into clients(agency_id,name) values ('fbaaaaaa-0000-4000-8000-000000000001','Cliente liberado')$$,'Regularizada: novos cadastros voltam a funcionar');

-- Falha de captura do cartão, estorno e demais situações
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0004','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '3 months')::date,'PENDING','CREDIT_CARD','2027-01-16T10:00:00Z'),6,'capture_refused'),'past_due','Cartão recusado na renovação: em atraso (não suspende na hora)');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0004','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '3 months')::date,'CONFIRMED','CREDIT_CARD','2027-01-17T10:00:00Z'),7),'activated','Recuperação da cobrança volta a ativa');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_AAAA0002','sub_AAAA0001','cus_AAAA0001',49.90,(current_date+interval '1 month')::date,'REFUNDED','CREDIT_CARD','2027-01-18T10:00:00Z'),8),'needs_review','Estorno pede revisão humana');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'active','Estorno não bloqueia nem libera sozinho');
select ok((select attention_reason is not null from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'Estorno fica sinalizado para revisão');

-- Cancelamento: período pago preservado; Asaas é avisado depois
set local role service_role;
select throws_ok($$select public.billing_request_cancel('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000004')$$,'42501',null,'Só o proprietário cancela');
select is((public.billing_request_cancel('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002') ->> 'remote_cancel_pending')::boolean,true,'Cancelamento pedido: aviso ao Asaas fica pendente e repetível');
select is((public.billing_reconcile_work() -> 'remote_cancel' -> 0 ->> 'asaas_subscription_id'),'sub_AAAA0001','Cancelamentos pendentes aparecem para a rotina de reconciliação');
select is((public.billing_run_maintenance() ->> 'subscriptions_canceled')::int,0,'Dentro do período pago nada é encerrado');
reset role;
select is((select status||'/'||cancel_at_period_end::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'active/true','Continua ativa até o fim do período');
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'full','Acesso do período pago preservado');
select set_config('t.suba',(select id::text from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),true);
set local role service_role;
select lives_ok($$select public.billing_confirm_remote_cancel(current_setting('t.suba')::uuid)$$,'Aviso ao Asaas confirmado');
reset role;
update private.billing_subscriptions set current_period_end=now()-interval '1 minute' where asaas_subscription_id='sub_AAAA0001';
set local role service_role;
select is((public.billing_run_maintenance() ->> 'subscriptions_canceled')::int,1,'Fim do período pago: encerra');
reset role;
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_AAAA0001'),'canceled','Assinatura encerrada');
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000001'),'restricted','Depois do período pago o acesso fica restrito, nunca liberado');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000001','clients')),'billing_restricted','Encerrada não volta a "sem plano"');
select throws_ok($$update private.billing_subscriptions set status='active' where asaas_subscription_id='sub_AAAA0001'$$,'22023',null,'Assinatura encerrada não é reativada (reativar = nova assinatura)');
set local role service_role;
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000002','fbc00000-0000-4000-8000-000000000001','yearly','chave-a-0010','sandbox') ->> 'amount_cents')::int,49900,'Nova contratação anual permitida após o encerramento (valor anual do servidor, sem parcelamento)');
reset role;

-- Primeira cobrança vencida: ativação falhou
set local role service_role;
select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000002','fb000000-0000-4000-8000-000000000003','fbc00000-0000-4000-8000-000000000001','monthly','chave-b-0001','sandbox');
select public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000002','sandbox','cus_BBBB0001');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_BBBB0001','cus_BBBB0001',49.90,'MONTHLY')),'created','Org B: assinatura criada');
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_BBBB0001','sub_BBBB0001','cus_BBBB0001',49.90,current_date,'OVERDUE','CREDIT_CARD','2026-10-20T10:00:00Z')),'activation_failed','Primeira cobrança vencida: ativação falhou');
reset role;
select is((select status||'/'||remote_cancel_pending::text from private.billing_subscriptions where asaas_subscription_id='sub_BBBB0001'),'canceled/true','Assinatura nunca ativada é cancelada e o Asaas será avisado');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000002'),0,'Org B nunca recebeu plano nem direitos');

-- Teste gratuito
set local role service_role;
select throws_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000005','fb000000-0000-4000-8000-000000000007')$$,'22023',null,'Sem plano de teste configurado, o teste não começa');
reset role;
update private.billing_settings set trial_plan_version_id='fbc00000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000005','fb000000-0000-4000-8000-000000000004')$$,'42501',null,'Só o proprietário inicia o teste');
select lives_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000005','fb000000-0000-4000-8000-000000000007')$$,'Proprietário inicia o teste');
select throws_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000005','fb000000-0000-4000-8000-000000000007')$$,'22023',null,'Mesma organização não reinicia o teste');
select throws_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000006','fb000000-0000-4000-8000-000000000007')$$,'23505',null,'Mesmo usuário não ganha um segundo teste em outra organização');
reset role;
select is((select kind||'/'||access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),'trial/full','Teste é um tipo próprio (não é concessão nem assinatura)');
select is((select extract(day from ends_at - started_at)::int from private.billing_trials where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),7,'Teste de 7 dias');
select is((select count(*)::int from private.billing_subscriptions where agency_id='fbaaaaaa-0000-4000-8000-000000000005')+(select count(*)::int from private.billing_checkout_intents where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),0,'Teste não cria cobrança nem exige cartão');
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000007',true);
select lives_ok($$insert into clients(agency_id,name) values ('fbaaaaaa-0000-4000-8000-000000000005','C1')$$,'Teste: o primeiro cliente cabe no limite');
select throws_ok($$insert into clients(agency_id,name) values ('fbaaaaaa-0000-4000-8000-000000000005','C2')$$,'53400',null,'Limites do teste protegem os custos (limite do plano de teste)');
select set_config('request.jwt.claim.sub','',true);
update private.billing_trials set started_at=now()-interval '8 days', ends_at=now()-interval '1 day' where agency_id='fbaaaaaa-0000-4000-8000-000000000005';
set local role service_role;
select is((public.billing_run_maintenance() ->> 'trials_expired')::int,1,'Teste vencido é encerrado pela manutenção');
reset role;
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),'restricted','Sem assinatura, o acesso fica restrito e os dados preservados');
select is((select count(*)::int from private.billing_subscriptions where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),0,'Teste vencido nunca vira cobrança sozinho');
update private.agency_plan_assignments set kind='administrative', note='cortesia de teste' where agency_id='fbaaaaaa-0000-4000-8000-000000000005';
select is((select access_state from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000005'),'full','Concessão administrativa não herda a restrição do teste vencido');

-- Caixa de entrada de eventos: duplicidade, reserva, nova tentativa
set local role service_role;
select is((public.billing_record_event('sandbox','evt_0001','PAYMENT_CONFIRMED','payment','pay_AAAA0001','{"event":"PAYMENT_CONFIRMED"}'::jsonb) ->> 'duplicate')::boolean,false,'Evento novo é gravado');
select set_config('t.e1',(public.billing_record_event('sandbox','evt_0001','PAYMENT_CONFIRMED','payment','pay_AAAA0001','{}'::jsonb) ->> 'id'),true);
select is((public.billing_record_event('sandbox','evt_0001','PAYMENT_CONFIRMED','payment','pay_AAAA0001','{"event":"PAYMENT_CONFIRMED"}'::jsonb) ->> 'duplicate')::boolean,true,'Evento duplicado é reconhecido sem nova linha');
select is(jsonb_array_length(public.billing_claim_events(10)),1,'Evento é reservado para processamento');
select is(jsonb_array_length(public.billing_claim_events(10)),0,'Evento reservado não é entregue a outro processo');
select lives_ok($$select public.billing_finish_event(current_setting('t.e1')::bigint,'retry','Asaas indisponível',1)$$,'Falha transitória agenda nova tentativa');
select is(jsonb_array_length(public.billing_claim_events(10)),0,'Nova tentativa só depois do prazo de espera');
reset role;
update private.billing_events set next_attempt_at=now()-interval '1 second' where asaas_event_id='evt_0001';
set local role service_role;
select is((public.billing_claim_events(10) -> 0 ->> 'attempts')::int,2,'Evento é reprocessado com contagem de tentativas');
select lives_ok($$select public.billing_finish_event(current_setting('t.e1')::bigint,'processed')$$,'Evento processado');
select is(jsonb_array_length(public.billing_claim_events(10)),0,'Evento processado não volta');
select is((public.billing_record_event('sandbox','evt_0001','PAYMENT_CONFIRMED','payment','pay_AAAA0001','{"event":"PAYMENT_CONFIRMED"}'::jsonb) ->> 'duplicate')::boolean,true,'Reentrega de evento já processado é duplicata');
select set_config('t.e2',(public.billing_record_event('sandbox','evt_0002','PAYMENT_OVERDUE','payment','pay_AAAA0003','{"event":"PAYMENT_OVERDUE"}'::jsonb) ->> 'id'),true);
select public.billing_claim_events(10);
reset role;
update private.billing_events set locked_until=now()-interval '1 second' where asaas_event_id='evt_0002';
set local role service_role;
select is((public.billing_claim_events(10) -> 0 ->> 'attempts')::int,2,'Reserva vencida (processo morreu): outro processo retoma');
reset role;
update private.billing_events set attempts=8 where asaas_event_id='evt_0002';
set local role service_role;
select lives_ok($$select public.billing_finish_event(current_setting('t.e2')::bigint,'retry','sempre falha')$$,'Tentativas esgotadas');
reset role;
select is((select status from private.billing_events where asaas_event_id='evt_0002'),'needs_review','Esgotadas as tentativas, vai para revisão humana (sem perda silenciosa)');
select throws_ok($$insert into private.billing_events(environment,asaas_event_id,event_type,resource_type,payload) values ('sandbox','evt_0001','EVENTO_X','payment','{}'::jsonb)$$,'23505',null,'Identificador do evento é único por ambiente');

-- Leituras e proteções
set local role authenticated;
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Outra organização não lê a situação financeira');
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Editor não lê a situação financeira');
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000008',true);
select lives_ok($$select public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000001')$$,'Administrador lê a situação financeira');
reset role;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$update private.billing_audit_log set action='x.alterado' where id=(select min(id) from private.billing_audit_log)$$,'42501',null,'Auditoria financeira não é alterada');
select throws_ok($$delete from private.billing_audit_log$$,'42501',null,'Auditoria financeira não é apagada');
select throws_ok($$delete from private.billing_subscriptions$$,'42501',null,'Assinaturas não são apagadas');
select throws_ok($$delete from private.billing_payments$$,'42501',null,'Pagamentos não são apagados');
select cmp_ok((select count(*)::int from private.billing_audit_log where action in ('subscription.activated','payment.renewed','subscription.past_due','subscription.suspended','subscription.reactivated','subscription.cancel_requested','subscription.canceled','trial.started','trial.expired','intent.created','subscription.created','payment.refunded')),'>=',12,'Eventos financeiros relevantes ficam na auditoria');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000007'),0,'Organização legada segue sem plano durante todo o fluxo');

-- Intenção que nunca foi enviada ao Asaas é liberada em poucos minutos; a que foi enviada continua protegida
set local role service_role;
select set_config('t.c1',(public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000005','fbc00000-0000-4000-8000-000000000001','monthly','chave-c-0001','sandbox') ->> 'intent_id'),true);
reset role;
update private.billing_checkout_intents set created_at=now()-interval '5 minutes' where id=current_setting('t.c1')::uuid;
set local role service_role;
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000005','fbc00000-0000-4000-8000-000000000001','monthly','chave-c-0002','sandbox') ->> 'reused')::boolean,false,'Intenção nunca enviada e parada há minutos é liberada (nada foi enviado ao Asaas)');
select is((public.billing_mark_intent((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000005','fbc00000-0000-4000-8000-000000000001','monthly','chave-c-0002','sandbox') ->> 'intent_id')::uuid,'dispatching') ->> 'status'),'dispatching','Intenção C enviada');
reset role;
update private.billing_checkout_intents set created_at=now()-interval '2 hours' where agency_id='fbaaaaaa-0000-4000-8000-000000000003' and status='dispatching';
set local role service_role;
select is((public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000003','fb000000-0000-4000-8000-000000000005','fbc00000-0000-4000-8000-000000000001','monthly','chave-c-0003','sandbox') ->> 'reused')::boolean,true,'Intenção já enviada ao Asaas continua protegida, por mais antiga que seja a criação');

-- Contratação com resultado desconhecido: o cliente vê "verificando" e a reconciliação recebe o trabalho
select set_config('t.b2',(public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000002','fb000000-0000-4000-8000-000000000003','fbc00000-0000-4000-8000-000000000001','monthly','chave-b-0002','sandbox') ->> 'intent_id'),true);
select public.billing_mark_intent(current_setting('t.b2')::uuid,'dispatching');
select public.billing_mark_intent(current_setting('t.b2')::uuid,'unknown',null,null,'timeout');
-- Etapa 2.2B (correção): a reconciliação só reivindica contratações enviadas há mais de 2 minutos (dá tempo ao webhook normal).
reset role;
update private.billing_checkout_intents set dispatched_at=now()-interval '5 minutes' where dispatched_at is not null and status in ('dispatching','unknown','awaiting_payment');
set local role service_role;
select is((public.billing_reconcile_work() -> 'intents' -> 0 ->> 'asaas_customer_id'),'cus_BBBB0001','Reconciliação recebe as contratações com resultado desconhecido para consultar o Asaas');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000003',true);
select is((public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000002') -> 'pending_checkout' ->> 'verifying')::boolean,true,'A organização vê que a contratação está sendo verificada');
select ok((public.get_agency_billing('fbaaaaaa-0000-4000-8000-000000000002') -> 'pending_checkout' ->> 'retry_after') is not null,'E vê a partir de quando pode tentar de novo');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Acesso restrito consultado na execução
set local role service_role;
select is(public.agency_billing_restricted('fbaaaaaa-0000-4000-8000-000000000001'),true,'Assinatura encerrada: execução deve ser barrada');
select is(public.agency_billing_restricted('fbaaaaaa-0000-4000-8000-000000000005'),false,'Concessão administrativa não é restrita');
select is(public.agency_billing_restricted('fbaaaaaa-0000-4000-8000-000000000007'),false,'Organização antiga sem plano nunca é restrita');
select is(public.agency_billing_restricted('fbaaaaaa-0000-4000-8000-000000000002'),false,'Contratação que nunca ativou não restringe');
select is(public.agency_billing_restricted(gen_random_uuid()),false,'Organização desconhecida não é restrita');
select ok(not has_function_privilege('authenticated','public.agency_ai_entitlement(uuid)','execute') and not has_function_privilege('anon','public.agency_ai_entitlement(uuid)','execute') and has_function_privilege('service_role','public.agency_billing_restricted(uuid)','execute') and not has_function_privilege('authenticated','public.agency_billing_restricted(uuid)','execute'),'Direito da IA e restrição de execução continuam só do servidor');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select is((select (public.agency_ai_entitlement('fbaaaaaa-0000-4000-8000-000000000001') ->> 'restricted')::boolean),true,'IA informa que a causa é a restrição financeira');
select is((select (public.agency_ai_entitlement('fbaaaaaa-0000-4000-8000-000000000007') ->> 'allowed')::boolean),true,'IA segue liberada para organização antiga sem plano');
select set_config('request.jwt.claim.role','',true);

-- Concessão gratuita de plano é substituída pela assinatura; concessões especiais de recursos/limites continuam valendo
insert into private.agency_plan_assignments(agency_id,plan_version_id,kind,note) values ('fbaaaaaa-0000-4000-8000-000000000006','fbc00000-0000-4000-8000-000000000003','administrative','cortesia de parceiro');
insert into private.entitlement_overrides(agency_id,key,limit_value,reason) values ('fbaaaaaa-0000-4000-8000-000000000006','clients',10,'ampliação especial combinada');
set local role service_role;
select public.billing_create_intent('fbaaaaaa-0000-4000-8000-000000000006','fb000000-0000-4000-8000-000000000007','fbc00000-0000-4000-8000-000000000001','monthly','chave-f-0001','sandbox');
select public.billing_set_customer('fbaaaaaa-0000-4000-8000-000000000006','sandbox','cus_FFFF0001');
select is(public.billing_apply_subscription('sandbox',public.zz_sub('sub_FFFF0001','cus_FFFF0001',49.90,'MONTHLY')),'created','Org F: assinatura criada');
reset role;
select is((select kind from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000006'),'administrative','Antes do pagamento confirmado a concessão continua como está');
set local role service_role;
select is(public.billing_apply_payment('sandbox',public.zz_snap('pay_FFFF0001','sub_FFFF0001','cus_FFFF0001',49.90,current_date,'CONFIRMED','CREDIT_CARD','2026-10-20T10:00:00Z')),'activated','Org F: pagamento confirmado');
reset role;
select is((select kind||'/'||plan_version_id::text from private.agency_plan_assignments where agency_id='fbaaaaaa-0000-4000-8000-000000000006'),'subscription/fbc00000-0000-4000-8000-000000000001','A assinatura substitui a concessão gratuita de plano');
select is((select count(*)::int from private.entitlement_overrides where agency_id='fbaaaaaa-0000-4000-8000-000000000006' and revoked_at is null),1,'Concessão especial de limite NÃO foi revogada');
select is((select source||'/'||limit_value::text from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000006','clients')),'override/10','Concessão especial segue valendo sobre o plano pago');
select is((select (metadata ->> 'overrides_preserved')::int from private.billing_audit_log where agency_id='fbaaaaaa-0000-4000-8000-000000000006' and action='access.concession_replaced'),1,'A substituição fica auditada, com o número de concessões especiais preservadas');
update private.billing_subscriptions set status='suspended' where asaas_subscription_id='sub_FFFF0001';
select private.billing_sync_access('fbaaaaaa-0000-4000-8000-000000000006');
select is((select source from private.resolve_entitlement('fbaaaaaa-0000-4000-8000-000000000006','clients')),'billing_restricted','Suspensa: a restrição financeira prevalece até a regularização (a concessão é preservada, não apagada)');
select is((select count(*)::int from private.entitlement_overrides where agency_id='fbaaaaaa-0000-4000-8000-000000000006' and revoked_at is null),1,'Concessão especial continua cadastrada durante a suspensão');

-- Permissões financeiras: só o proprietário altera; administrador só consulta
set local role service_role;
select throws_ok($$select public.billing_request_cancel('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000008')$$,'42501',null,'Administrador não cancela assinatura');
select throws_ok($$select public.billing_start_trial('fbaaaaaa-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000008')$$,'42501',null,'Administrador não inicia teste');
select throws_ok($$select public.billing_request_cancel('fbaaaaaa-0000-4000-8000-000000000006','fb000000-0000-4000-8000-000000000008')$$,'42501',null,'Administrador de outra organização também não cancela');
reset role;

select * from finish();
rollback;
