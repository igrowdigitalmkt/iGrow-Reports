begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('a0000000-0000-4000-8000-000000000001','novo@example.test',now());
-- Organização ANTIGA (criada sem passar pelo cadastro): sem plano atribuído, continua com tudo liberado.
insert into agencies(id,name) values ('a0aaaaaa-0000-4000-8000-000000000001','Organização antiga');

select throws_ok($$select public.create_own_agency('Sem sessão')$$,'42501',null,'Sem usuário identificado não cria agência');

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.create_own_agency(' x ')$$,'22023',null,'Nome curto é recusado');
select throws_ok($$select public.create_own_agency('Agência Nova','Lugar/Inexistente')$$,'22023',null,'Fuso inválido é recusado');
-- Sem nenhum plano publicado no catálogo, NÃO se cria organização (nunca uma organização ilimitada).
select throws_ok($$select public.create_own_agency('Sem catálogo')$$,'55000',null,'Sem catálogo comercial a criação é recusada');
reset role;
select is((select count(*)::int from agencies where name='Sem catálogo'),0,'... e nada fica criado');

-- Catálogo com um plano publicado, mas SEM plano de teste configurado.
insert into private.plans(id,key,name,description,visibility,sellable,recommended,sort_order) values ('a0bbbbbb-0000-4000-8000-000000000001','pro','Profissional','x','public',true,true,10);
insert into private.plan_versions(id,plan_id,version,price_monthly_cents,price_yearly_cents) values ('a0cccccc-0000-4000-8000-000000000001','a0bbbbbb-0000-4000-8000-000000000001',1,4990,49900);
insert into private.plan_version_entitlements(plan_version_id,key,limit_value) values ('a0cccccc-0000-4000-8000-000000000001','clients',10);
update private.plan_versions set status='published',published_at=now() where id='a0cccccc-0000-4000-8000-000000000001';
update private.plans set current_version_id='a0cccccc-0000-4000-8000-000000000001' where id='a0bbbbbb-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.create_own_agency('Agência Nova')$$,'Usuário cria a própria agência');
select is((select role::text from agency_users au join agencies a on a.id=au.agency_id where a.name='Agência Nova'),'owner','Quem cria vira proprietário');
select is((select count(*)::int from agencies where name <> 'Organização antiga'),1,'Vê apenas a agência criada');
reset role;
select is((select kind||'/'||access_state from private.agency_plan_assignments a join agencies g on g.id=a.agency_id where g.name='Agência Nova'),'trial/restricted','Plano de teste NÃO configurado: a organização nova nasce RESTRITA (nunca ilimitada)');
select is((select source from private.resolve_entitlement((select id from agencies where name='Agência Nova'),'clients')),'billing_restricted','... com limites zerados e recursos pagos desligados');
select is((select (private.resolve_entitlement((select id from agencies where name='Agência Nova'),'ai_assistant')).enabled),false,'... IA e demais recursos pagos desligados');
select is((select metadata ->> 'reason' from private.billing_audit_log where action='trial.not_granted' order by id desc limit 1),'trial_not_configured','O motivo fica na auditoria');

-- Plano de teste configurado: a próxima organização recebe o teste de 7 dias, uma vez por pessoa.
update private.billing_settings set trial_plan_version_id='a0cccccc-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.create_own_agency('Segunda')$$,'Com o plano de teste configurado, cria normalmente');
reset role;
select is((select kind||'/'||access_state from private.agency_plan_assignments a join agencies g on g.id=a.agency_id where g.name='Segunda'),'trial/full','Recebe o teste gratuito');
select is((select round(extract(epoch from (ends_at - now()))/86400)::int from private.billing_trials t join agencies g on g.id=t.agency_id where g.name='Segunda'),7,'... de 7 dias, sem cartão');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.create_own_agency('Terceira'); select public.create_own_agency('Quarta'); select public.create_own_agency('Quinta')$$,'Pode criar até 5');
select throws_ok($$select public.create_own_agency('Sexta')$$,'23514',null,'Sexta agência é recusada');
reset role;
select is((select kind||'/'||access_state from private.agency_plan_assignments a join agencies g on g.id=a.agency_id where g.name='Terceira'),'trial/restricted','Segunda organização da mesma pessoa NÃO ganha novo teste: nasce restrita');
select is((select count(*)::int from private.billing_trials),1,'Só um teste por pessoa');
select is((select count(*)::int from private.agency_plan_assignments a join agencies g on g.id=a.agency_id where g.name in ('Agência Nova','Segunda','Terceira','Quarta','Quinta') and a.access_state='full'),1,'Das cinco organizações novas, só a do teste está liberada');
select is((select source from private.resolve_entitlement('a0aaaaaa-0000-4000-8000-000000000001','clients')),'unmanaged','Organização ANTIGA continua sem plano e com tudo liberado');
select is((select count(*)::int from private.agency_plan_assignments where agency_id='a0aaaaaa-0000-4000-8000-000000000001'),0,'... e nenhum plano foi atribuído a ela');
select is((select count(*)::int from audit_logs where action='agency.created'),5,'Cada criação fica na auditoria');
select ok(not has_function_privilege('authenticated','private.billing_init_new_workspace(uuid,uuid)','execute'),'A função de início não é chamável por usuários');
select * from finish();
rollback;
