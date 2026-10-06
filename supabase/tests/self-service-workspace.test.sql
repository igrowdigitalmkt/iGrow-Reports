begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('a0000000-0000-4000-8000-000000000001','novo@example.test',now());

select throws_ok($$select public.create_own_agency('Sem sessão')$$,'42501',null,'Sem usuário identificado não cria agência');

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.create_own_agency(' x ')$$,'22023',null,'Nome curto é recusado');
select throws_ok($$select public.create_own_agency('Agência Nova','Lugar/Inexistente')$$,'22023',null,'Fuso inválido é recusado');
select lives_ok($$select public.create_own_agency('Agência Nova')$$,'Usuário cria a própria agência');
select is((select role::text from agency_users au join agencies a on a.id=au.agency_id where a.name='Agência Nova'),'owner','Quem cria vira proprietário');
select is((select count(*)::int from agencies),1,'Vê apenas a agência criada');
select lives_ok($$select public.create_own_agency('Segunda'); select public.create_own_agency('Terceira'); select public.create_own_agency('Quarta'); select public.create_own_agency('Quinta')$$,'Pode criar até cinco');
select throws_ok($$select public.create_own_agency('Sexta')$$,'23514',null,'Sexta agência é recusada');
reset role;
select is((select count(*)::int from audit_logs where action='agency.created'),5,'Cada criação fica na auditoria');
select * from finish();
rollback;
