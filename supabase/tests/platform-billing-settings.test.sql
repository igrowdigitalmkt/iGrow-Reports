begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('e1000000-0000-4000-8000-000000000001','operador@example.test',now()),
('e1000000-0000-4000-8000-000000000002','dono@example.test',now());
insert into agencies(id,name) values ('e1aaaaaa-0000-4000-8000-000000000001','Org A');
insert into agency_users(agency_id,user_id,role) values ('e1aaaaaa-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','owner');
insert into private.platform_operators(user_id,role) values ('e1000000-0000-4000-8000-000000000001','owner');
-- Planos: teste (privado, não vendável), público vendável e uma versão ainda em rascunho.
insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values
 ('e1bbbbbb-0000-4000-8000-000000000001','teste','Teste gratuito','x','private',false,false,1),
 ('e1bbbbbb-0000-4000-8000-000000000002','pro','Pro','x','public',true,true,2),
 ('e1bbbbbb-0000-4000-8000-000000000003','teste2','Teste rascunho','x','private',false,false,3);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values
 ('e1cccccc-0000-4000-8000-000000000001','e1bbbbbb-0000-4000-8000-000000000001',1,null,null),
 ('e1cccccc-0000-4000-8000-000000000002','e1bbbbbb-0000-4000-8000-000000000002',1,14990,149900),
 ('e1cccccc-0000-4000-8000-000000000003','e1bbbbbb-0000-4000-8000-000000000003',1,null,null);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('e1cccccc-0000-4000-8000-000000000001','clients',3);
update private.plan_versions set status='published',published_at=now() where id in ('e1cccccc-0000-4000-8000-000000000001','e1cccccc-0000-4000-8000-000000000002');
update private.plans set current_version_id='e1cccccc-0000-4000-8000-000000000001' where id='e1bbbbbb-0000-4000-8000-000000000001';
update private.billing_settings set live_enabled=false, trial_plan_version_id='e1cccccc-0000-4000-8000-000000000001', trial_days=7;

-- Permissões
select ok(has_function_privilege('authenticated','public.platform_update_billing_settings(integer,uuid,integer,integer)','execute')
  and not has_function_privilege('anon','public.platform_update_billing_settings(integer,uuid,integer,integer)','execute')
  and not has_function_privilege('service_role','public.platform_billing_dashboard(text)','execute')
  and not has_function_privilege('anon','public.platform_get_billing_settings()','execute'),'Funções: só usuários autenticados (e conferem o operador)');
select ok(not has_table_privilege('authenticated','private.billing_settings','update') and not has_table_privilege('authenticated','private.billing_subscriptions','select'),'Sem acesso direto às tabelas financeiras');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select throws_ok($$select public.platform_get_billing_settings()$$,'42501',null,'Proprietário de organização não lê as configurações');
select throws_ok($$select public.platform_update_billing_settings(10,null,7,30)$$,'42501',null,'Proprietário de organização não altera as configurações');
select throws_ok($$select public.platform_billing_dashboard('sandbox')$$,'42501',null,'Proprietário de organização não vê o acompanhamento financeiro');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select throws_ok($$select public.platform_update_billing_settings(10,null,7,30)$$,'42501',null,'Operador sem MFA não altera');
select throws_ok($$select public.platform_billing_dashboard('sandbox')$$,'42501',null,'Operador sem MFA não vê o acompanhamento');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);

-- Validações
select throws_ok($$select public.platform_update_billing_settings(0,'e1cccccc-0000-4000-8000-000000000001',7,30)$$,'22023',null,'Duração do teste fora de 1 a 90 é recusada');
select throws_ok($$select public.platform_update_billing_settings(7,'e1cccccc-0000-4000-8000-000000000001',61,30)$$,'22023',null,'Tolerância acima de 60 dias é recusada');
select throws_ok($$select public.platform_update_billing_settings(7,'e1cccccc-0000-4000-8000-000000000001',7,5)$$,'22023',null,'Validade de checkout abaixo de 10 minutos é recusada');
select throws_ok($$select public.platform_update_billing_settings(7,'e1cccccc-0000-4000-8000-000000000002',7,30)$$,'22023',null,'Plano público/vendável NÃO pode ser o plano do teste (teria checkout)');
select throws_ok($$select public.platform_update_billing_settings(7,'e1cccccc-0000-4000-8000-000000000003',7,30)$$,'22023',null,'Versão não publicada não pode ser o plano do teste');
select throws_ok($$select public.platform_update_billing_settings(7,'e1cccccc-0000-4000-8000-0000000000ff',7,30)$$,'22023',null,'Versão inexistente é recusada');
select is((select (public.platform_get_billing_settings() ->> 'trial_days')::int),7,'Nada foi alterado pelas tentativas inválidas');

-- Leitura e alteração válida
select is(public.platform_get_billing_settings() -> 'trial_plan' ->> 'plan_name','Teste gratuito','Leitura mostra o plano do teste');
select is(jsonb_array_length(public.platform_get_billing_settings() -> 'trial_candidates'),1,'Só planos privados, não vendáveis e publicados são candidatos');
select lives_ok($$select public.platform_update_billing_settings(10,'e1cccccc-0000-4000-8000-000000000001',9,45)$$,'Operador com MFA altera as regras');
select is((public.platform_get_billing_settings() ->> 'trial_days')::int || '/' || (public.platform_get_billing_settings() ->> 'past_due_grace_days') || '/' || (public.platform_get_billing_settings() ->> 'checkout_minutes'),'10/9/45','As regras ficaram persistidas');
select is((public.platform_get_billing_settings() ->> 'live_enabled')::boolean,false,'live_enabled continua desligado (e só aparece como indicador)');
reset role;
select is((select live_enabled from private.billing_settings),false,'A função não mexe em live_enabled');
select is((select count(*)::int from private.platform_audit_log where action='commercial.billing_settings_updated'),1,'A alteração ficou na auditoria (as tentativas inválidas não)');
select is((select metadata -> 'trial_days' from private.platform_audit_log where action='commercial.billing_settings_updated'),'[7, 10]'::jsonb,'A auditoria guarda o valor anterior e o novo');

-- Vale para o futuro: um teste já iniciado mantém o próprio vencimento e plano.
insert into private.billing_trials(agency_id,started_by,plan_version_id,ends_at) values ('e1aaaaaa-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e1cccccc-0000-4000-8000-000000000001',now()+interval '5 days');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select lives_ok($$select public.platform_update_billing_settings(30,null,7,30)$$,'Desativar o plano do teste e mudar a duração é permitido');
reset role;
select is((select round(extract(epoch from (ends_at - now()))/86400)::int from private.billing_trials where agency_id='e1aaaaaa-0000-4000-8000-000000000001'),5,'O teste já iniciado mantém o vencimento original');
select is((select plan_version_id from private.billing_trials where agency_id='e1aaaaaa-0000-4000-8000-000000000001'),'e1cccccc-0000-4000-8000-000000000001'::uuid,'... e o plano original');
select is((select trial_plan_version_id from private.billing_settings),null,'Sem plano de teste: novos testes não começam (a organização nova nasce restrita, nunca ilimitada)');

-- Acompanhamento financeiro: contagens, sem dados sensíveis
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select is((public.platform_billing_dashboard('sandbox') -> 'trials' ->> 'active')::int,1,'Testes em andamento são contados');
select ok(public.platform_billing_dashboard('sandbox') ? 'cron' and public.platform_billing_dashboard('sandbox') -> 'cron' ? 'flags','Traz a situação do cron financeiro');
select is(public.platform_billing_dashboard('sandbox') -> 'cron' ->> 'ok','false','Cron que nunca rodou NÃO aparece como saudável');
select ok(not (public.platform_billing_dashboard('sandbox')::text ~* '(asaas_|token|secret|api_key|card|cus_|sub_|pay_)'),'Nenhum identificador do Asaas, token ou dado de cartão no acompanhamento');
select throws_ok($$select public.platform_billing_dashboard('outro')$$,'22023',null,'Ambiente inválido é recusado');
reset role;
select * from finish();
rollback;
