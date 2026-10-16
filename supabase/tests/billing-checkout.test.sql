begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('2b000000-0000-4000-8000-000000000001','dono@example.test',now()),
('2b000000-0000-4000-8000-000000000002','admin@example.test',now()),
('2b000000-0000-4000-8000-000000000003','editor@example.test',now()),
('2b000000-0000-4000-8000-000000000004','outro@example.test',now()),
('2b000000-0000-4000-8000-000000000005','dono-b@example.test',now());
insert into agencies(id,name) values ('2baaaaaa-0000-4000-8000-000000000001','Org A'),('2baaaaaa-0000-4000-8000-000000000002','Org B'),('2baaaaaa-0000-4000-8000-000000000003','Org C');
insert into agency_users(agency_id,user_id,role) values
('2baaaaaa-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','owner'),
('2baaaaaa-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000002','admin'),
('2baaaaaa-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000003','editor'),
('2baaaaaa-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000004','owner'),
('2baaaaaa-0000-4000-8000-000000000003','2b000000-0000-4000-8000-000000000005','owner');

-- Catálogo: um plano oferecido e quatro que NÃO podem aparecer (privado, fora de venda, sem preço, sem versão publicada)
insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values
('2bbbbbbb-0000-4000-8000-000000000001','pro','Profissional','Para equipes','public',true,true,10),
('2bbbbbbb-0000-4000-8000-000000000002','interno','Interno','x','private',true,false,20),
('2bbbbbbb-0000-4000-8000-000000000003','fora','Fora de venda','x','public',false,false,30),
('2bbbbbbb-0000-4000-8000-000000000004','semprec','Sem preço','x','public',true,false,40),
('2bbbbbbb-0000-4000-8000-000000000005','rascunho','Só rascunho','x','public',true,false,50);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values
('2bcccccc-0000-4000-8000-000000000001','2bbbbbbb-0000-4000-8000-000000000001',1,4990,49900),
('2bcccccc-0000-4000-8000-000000000002','2bbbbbbb-0000-4000-8000-000000000002',1,1000,10000),
('2bcccccc-0000-4000-8000-000000000003','2bbbbbbb-0000-4000-8000-000000000003',1,1000,10000),
('2bcccccc-0000-4000-8000-000000000004','2bbbbbbb-0000-4000-8000-000000000004',1,null,null),
('2bcccccc-0000-4000-8000-000000000005','2bbbbbbb-0000-4000-8000-000000000005',1,1000,10000);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('2bcccccc-0000-4000-8000-000000000001','clients',10);
insert into private.plan_version_entitlements(plan_version_id,key,enabled) values ('2bcccccc-0000-4000-8000-000000000001','ai_assistant',true);
update private.plan_versions set status='published',published_at=now() where id in ('2bcccccc-0000-4000-8000-000000000001','2bcccccc-0000-4000-8000-000000000002','2bcccccc-0000-4000-8000-000000000003','2bcccccc-0000-4000-8000-000000000004');
update private.plans set current_version_id='2bcccccc-0000-4000-8000-000000000001' where id='2bbbbbbb-0000-4000-8000-000000000001';
update private.plans set current_version_id='2bcccccc-0000-4000-8000-000000000002' where id='2bbbbbbb-0000-4000-8000-000000000002';
update private.plans set current_version_id='2bcccccc-0000-4000-8000-000000000003' where id='2bbbbbbb-0000-4000-8000-000000000003';
update private.plans set current_version_id='2bcccccc-0000-4000-8000-000000000004' where id='2bbbbbbb-0000-4000-8000-000000000004';

create function public.zz_sub3(p_id text,p_cust text,p_value numeric,p_cycle text,p_session text default null,p_ext text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id',p_id,'customer',p_cust,'value',p_value,'cycle',p_cycle,'status','ACTIVE','billingType','CREDIT_CARD','checkoutSession',p_session,'externalReference',p_ext);
$$;

-- Estrutura
select ok(has_function_privilege('authenticated','public.billing_list_offers(uuid)','execute') and not has_function_privilege('anon','public.billing_list_offers(uuid)','execute') and not has_function_privilege('service_role','public.billing_list_offers(uuid)','execute'),'Ofertas: só usuários autenticados (e conferem o papel)');
select ok(has_function_privilege('service_role','public.billing_close_intent(text,text,text)','execute') and has_function_privilege('service_role','public.billing_intent_by_checkout(text,text)','execute')
  and not has_function_privilege('authenticated','public.billing_close_intent(text,text,text)','execute') and not has_function_privilege('authenticated','public.billing_intent_by_checkout(text,text)','execute') and not has_function_privilege('anon','public.billing_close_intent(text,text,text)','execute'),'Fechar intenção e buscar pelo checkout: só o servidor');

-- Ofertas
set local role authenticated;
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001')),1,'Só o plano público, à venda, publicado e com preço é oferecido');
select is((public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001') -> 0 ->> 'name'),'Profissional','Plano oferecido');
select is(((public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001') -> 0 ->> 'price_monthly_cents')::int)||'/'||((public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001') -> 0 ->> 'price_yearly_cents')::int),'4990/49900','Preços do servidor (mensal e anual integral)');
select is(jsonb_array_length(public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001') -> 0 -> 'entitlements'),2,'Funcionalidades e limites da versão exata');
select is((public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001') -> 0 ->> 'plan_version_id'),'2bcccccc-0000-4000-8000-000000000001','Devolve a versão comercial atual');
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000002',true);
select is(jsonb_array_length(public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001')),1,'Administrador consulta as ofertas');
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Editor não vê as ofertas');
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.billing_list_offers('2baaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Dono de outra organização não vê');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Contratação (como o servidor): intenção → envio → checkout
set local role service_role;
select set_config('t.i',(public.billing_create_intent('2baaaaaa-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','2bcccccc-0000-4000-8000-000000000001','yearly','chave-a-0001','sandbox') ->> 'intent_id'),true);
select public.billing_mark_intent(current_setting('t.i')::uuid,'dispatching');
select public.billing_mark_intent(current_setting('t.i')::uuid,'awaiting_payment','chk_2B0001','https://sandbox.example.test/checkout/chk_2B0001');
select public.billing_set_customer('2baaaaaa-0000-4000-8000-000000000001','sandbox','cus_2B0001');
select is((public.billing_intent_by_checkout('sandbox','chk_2B0001') ->> 'asaas_customer_id'),'cus_2B0001','Busca a intenção pelo checkout, com o cliente financeiro');
select is((public.billing_intent_by_checkout('sandbox','chk_2B0001') ->> 'agency_id'),'2baaaaaa-0000-4000-8000-000000000001','... e a organização dona dela');
select is(public.billing_intent_by_checkout('sandbox','chk_NAO_EXISTE'),'null'::jsonb,'Checkout desconhecido não casa com nenhuma intenção');
select is(public.billing_intent_by_checkout('production','chk_2B0001'),'null'::jsonb,'Nem em outro ambiente');
reset role;

-- Tela: dono vê o endereço do checkout; administrador não
set local role authenticated;
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000001',true);
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') ->> 'can_contract')::boolean,true,'Proprietário pode contratar');
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'pending_checkout' ->> 'checkout_url'),'https://sandbox.example.test/checkout/chk_2B0001','Proprietário recebe o endereço do checkout em andamento');
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'pending_checkout' ->> 'status'),'awaiting_payment','Estado: aguardando pagamento');
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000002',true);
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') ->> 'can_contract')::boolean,false,'Administrador só consulta');
select ok((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'pending_checkout' ->> 'checkout_url') is null,'Administrador não recebe o endereço do checkout');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Eventos de checkout fecham só o que está em aberto
set local role service_role;
select is(public.billing_close_intent('sandbox','chk_NAO_EXISTE','expired'),'unknown_checkout','Fechar checkout desconhecido não faz nada');
select throws_ok($$select public.billing_close_intent('sandbox','chk_2B0001','completed')$$,'22023',null,'Só é possível cancelar ou expirar');
select is(public.billing_close_intent('sandbox','chk_2B0001','canceled'),'closed','CHECKOUT_CANCELED encerra a intenção em aberto');
select is(public.billing_close_intent('sandbox','chk_2B0001','expired'),'noop','Evento repetido não altera nada');
reset role;
select is((select status from private.billing_checkout_intents where id=current_setting('t.i')::uuid),'canceled','Intenção cancelada');
set local role authenticated;
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000001',true);
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'last_intent' ->> 'status'),'canceled','A tela explica o que houve (cancelado)');
select is(public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'pending_checkout','null'::jsonb,'Sem checkout em andamento depois do cancelamento');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Vínculo checkout ↔ assinatura (Org A: nova tentativa com checkout próprio)
set local role service_role;
select set_config('t.i2',(public.billing_create_intent('2baaaaaa-0000-4000-8000-000000000001','2b000000-0000-4000-8000-000000000001','2bcccccc-0000-4000-8000-000000000001','monthly','chave-a-0002','sandbox') ->> 'intent_id'),true);
select public.billing_mark_intent(current_setting('t.i2')::uuid,'dispatching');
select public.billing_mark_intent(current_setting('t.i2')::uuid,'awaiting_payment','chk_2B0002','https://sandbox.example.test/checkout/chk_2B0002');
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0001','cus_2B0001',49.90,'MONTHLY','chk_OUTRO0001')),'mismatch','Assinatura de OUTRO checkout não casa com esta intenção');
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0001','cus_2B0001',49.90,'MONTHLY',null,'7a7a7a7a-0000-4000-8000-000000000001')),'mismatch','externalReference de OUTRA intenção não casa');
select is(public.billing_close_intent('sandbox','chk_2B0001','expired'),'noop','Intenção antiga (cancelada) continua intocada');
reset role;
select is((select count(*)::int from private.billing_subscriptions where agency_id='2baaaaaa-0000-4000-8000-000000000001'),0,'Nenhuma assinatura foi criada por vínculo divergente');
select is((select count(*)::int from private.billing_audit_log where action='subscription.checkout_mismatch'),2,'Divergências ficam na auditoria');
set local role service_role;
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0001','cus_2B0001',49.90,'MONTHLY','chk_2B0002','externo-qualquer-coisa')),'created','Checkout e identificador conferem (referência que não é nossa é ignorada): assinatura registrada');
reset role;
select is((select (metadata ->> 'checkout_confirmed')::boolean from private.billing_audit_log where action='subscription.created' and agency_id='2baaaaaa-0000-4000-8000-000000000001'),true,'Auditoria registra que o checkout foi confirmado');
select is((select status from private.billing_checkout_intents where id=current_setting('t.i2')::uuid),'completed','Intenção concluída');
select is((select status from private.billing_subscriptions where asaas_subscription_id='sub_2B0001'),'pending','Assinatura nasce pendente: o pagamento ainda precisa ser confirmado');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2baaaaaa-0000-4000-8000-000000000001'),0,'O checkout concluído NÃO libera direitos antes do pagamento confirmado');
set local role service_role;
select is(public.billing_close_intent('sandbox','chk_2B0002','expired'),'already_completed','CHECKOUT_EXPIRED tardio não desfaz uma contratação concluída');
reset role;

-- Intenção de resultado desconhecido aprende o checkout pela própria assinatura (Org B)
set local role service_role;
select set_config('t.b',(public.billing_create_intent('2baaaaaa-0000-4000-8000-000000000002','2b000000-0000-4000-8000-000000000004','2bcccccc-0000-4000-8000-000000000001','monthly','chave-b-0001','sandbox') ->> 'intent_id'),true);
select public.billing_mark_intent(current_setting('t.b')::uuid,'dispatching');
select public.billing_mark_intent(current_setting('t.b')::uuid,'unknown',null,null,'timeout');
select public.billing_set_customer('2baaaaaa-0000-4000-8000-000000000002','sandbox','cus_2B0002');
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0002','cus_2B0002',49.90,'MONTHLY','chk_APRENDE01')),'unlinked_candidate','Resultado desconhecido + assinatura só coincidente (sem identificador que case): NÃO ativa; vai para revisão financeira');
reset role;
select is((select asaas_checkout_id from private.billing_checkout_intents where id=current_setting('t.b')::uuid),null,'A intenção NÃO inventa o identificador do checkout');
select ok((select review_required_at is not null and status='unknown' from private.billing_checkout_intents where id=current_setting('t.b')::uuid),'... a intenção é preservada e marcada para revisão (sem nova cobrança)');

-- Isolamento: assinatura de cliente de outra organização não atravessa
set local role service_role;
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0003','cus_2B0001',49.90,'MONTHLY','chk_2B0002')),'duplicate_subscription','Cliente da Org A não cria segunda assinatura nela');
select is(public.billing_apply_subscription('sandbox',public.zz_sub3('sub_2B0004','cus_DESCONHECIDO',49.90,'MONTHLY','chk_2B0002')),'unattributed','Cliente desconhecido nunca é atribuído, mesmo com checkout conhecido');
reset role;
select is((select count(*)::int from private.agency_plan_assignments where agency_id='2baaaaaa-0000-4000-8000-000000000003'),0,'Organização sem contratação segue como antes');

-- Situação depois do pagamento (Org A)
set local role service_role;
select is(public.billing_apply_payment('sandbox','{"id":"pay_2B0001","subscription":"sub_2B0001","customer":"cus_2B0001","value":49.90,"dueDate":"2026-10-15","status":"CONFIRMED","billingType":"CREDIT_CARD","observedAt":"2026-10-15T10:00:00Z"}'::jsonb),'activated','Pagamento confirmado ativa o plano contratado');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000002',true);
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'current_plan' ->> 'name')||'/'||(public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'current_plan' ->> 'kind'),'Profissional/subscription','A tela mostra o plano atual e que é assinatura paga');
select is((public.get_agency_billing('2baaaaaa-0000-4000-8000-000000000001') -> 'last_subscription' ->> 'activated')::boolean,true,'Última assinatura foi ativada');
reset role;

select * from finish();
rollback;
