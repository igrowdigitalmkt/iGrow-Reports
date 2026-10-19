begin;
set local search_path=public,extensions;
select no_plan();

-- Dados sinteticos; transacao sempre revertida.
insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','analysis-owner@example.test'),
 ('d1000000-0000-4000-8000-000000000002','analysis-other@example.test');
insert into agencies(id,name) values
 ('d2000000-0000-4000-8000-000000000001','Analysis A'),
 ('d2000000-0000-4000-8000-000000000002','Analysis B');
insert into agency_users(agency_id,user_id,role) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','owner'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','owner');
insert into clients(id,agency_id,name)
 values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Cliente analise ficticio');
insert into integrations(id,agency_id,provider)
 values('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','meta');
insert into meta_connections(id,agency_id,integration_id,scopes)
 values('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',array['ads_read']);
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
 values('d6000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','act_777','Teste analise','BRL','America/Sao_Paulo','100003');
insert into client_ad_accounts(agency_id,client_id,ad_account_id)
 values('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001');

insert into agent_analysis_runs(agency_id,client_id,ad_account_id,origin,summary,observations,proposals,rejected,rejected_reasons)
values('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
 'manual','Sem alteracoes recomendadas.','[{"name":"Campanha X","level":"campaign","rationale":"Estavel."}]'::jsonb,0,1,array['unverified_numbers']);

select throws_ok($$insert into agent_analysis_runs(agency_id,client_id,ad_account_id,origin,summary,observations)
 values('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
 'manual','x','{"nao":"array"}'::jsonb)$$,'23514',null,'Observacoes precisam ser um array');
select throws_ok($$insert into agent_analysis_runs(agency_id,client_id,ad_account_id,origin,summary)
 values('d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
 'manual','Conta de outra organizacao')$$,'23503',null,'Cliente e conta precisam pertencer a mesma organizacao');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from agent_analysis_runs),1,'Equipe da organizacao le a analise');
select throws_ok($$insert into agent_analysis_runs(agency_id,client_id,ad_account_id,origin,summary)
 values('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',
 'manual','Escrita direta pelo usuario')$$,'42501',null,'Usuario autenticado nao escreve direto');

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from agent_analysis_runs),0,'Outra organizacao nao ve a analise');

select * from finish();
rollback;
