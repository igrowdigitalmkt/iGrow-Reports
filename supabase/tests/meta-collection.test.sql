begin;
set local search_path=public,extensions;
select no_plan();

insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000061','Agencia coleta');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','Cliente coleta'),
('11111111-0000-4000-8000-000000000062','aaaaaaaa-0000-4000-8000-000000000061','Outro cliente');
insert into integrations(id,agency_id,provider) values
('30000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','meta');
insert into meta_connections(id,agency_id,integration_id,client_id) values
('40000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','30000000-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values
('50000000-0000-4000-8000-000000000061','aaaaaaaa-0000-4000-8000-000000000061','40000000-0000-4000-8000-000000000061','act_61','Conta coleta','BRL','America/Sao_Paulo','61');
insert into client_ad_accounts(agency_id,client_id,ad_account_id) values
('aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061');

create temporary table collection_fixture(insights jsonb,actions jsonb);
insert into collection_fixture values(
  '[{"agency_id":"aaaaaaaa-0000-4000-8000-000000000061","ad_account_id":"50000000-0000-4000-8000-000000000061","insight_date":"2026-09-10","level":"account","external_entity_id":"act_61","spend":10,"impressions":100,"reach":80,"link_clicks":5,"api_version":"v26.0"},
    {"agency_id":"aaaaaaaa-0000-4000-8000-000000000061","ad_account_id":"50000000-0000-4000-8000-000000000061","insight_date":"2026-09-10","level":"campaign","external_entity_id":"6100","spend":10,"impressions":100,"api_version":"v26.0"}]',
  '[{"agency_id":"aaaaaaaa-0000-4000-8000-000000000061","ad_account_id":"50000000-0000-4000-8000-000000000061","insight_date":"2026-09-10","level":"account","external_entity_id":"act_61","action_type":"lead","action_value":2}]'
);
grant select on collection_fixture to service_role;

select ok(not has_function_privilege('authenticated','public.persist_meta_insight_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)','execute'),'Usuario autenticado nao pode forjar coleta operacional');
select ok(not has_function_privilege('anon','public.persist_meta_insight_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)','execute'),'Anonimo nao pode executar persistencia');
select ok(has_function_privilege('service_role','public.persist_meta_insight_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)','execute'),'Service role persiste lotes');

set local role service_role;
select lives_ok($$select * from persist_meta_insight_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture),(select actions from collection_fixture))$$,'Lote completo persiste conta campanha e acoes');
select is((select count(*) from meta_daily_insights),2::bigint,'Dois niveis de insight persistidos');
select is((select count(*) from meta_daily_actions),1::bigint,'Acoes persistidas uma vez');
select is((select insight_count from meta_collection_runs),2,'Historico tem contagem do lote concluido');
select is((select status from meta_collection_runs),'complete','Historico confirma lote integral');

select lives_ok($$select * from persist_meta_insight_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture),(select actions from collection_fixture))$$,'Repeticao do lote e idempotente');
select is((select count(*) from meta_daily_actions),1::bigint,'Repeticao nao duplica acoes');

select throws_ok($$select * from persist_meta_insight_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000062','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture),(select actions from collection_fixture))$$,'22023',null,'Outro cliente nao pode reconciliar a conta');

select throws_ok($$select * from persist_meta_insight_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture),
 jsonb_set((select actions from collection_fixture),'{0,external_entity_id}','"act_999"'))$$,'23503',null,'Acao sem insight correspondente causa rollback integral');
select is((select sum(spend) from meta_daily_insights),20::numeric,'Falha atomica preserva insights anteriores');
select is((select sum(action_value) from meta_daily_actions),2::numeric,'Falha atomica preserva acoes anteriores');

select lives_ok($$select * from persist_meta_insight_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30','[]','[]')$$,'Resposta integral vazia reconcilia dados antigos');
select is((select count(*) from meta_daily_insights),0::bigint,'Reconciliacao vazia remove insights obsoletos');
select is((select count(*) from meta_daily_actions),0::bigint,'Reconciliacao vazia remove acoes obsoletas');
select is((select status from meta_collection_runs),'complete','Periodo sem entrega ainda tem cobertura confirmada');
select is((select insight_count from meta_collection_runs),0,'Zero linhas retornadas registrado explicitamente');


select ok(not has_function_privilege('authenticated','public.persist_meta_detailed_slice(uuid,uuid,uuid,date,date,jsonb,jsonb)','execute'),'Usuário não forja coleta granular');
select lives_ok($q$select * from persist_meta_detailed_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture)||
 '[{"agency_id":"aaaaaaaa-0000-4000-8000-000000000061","ad_account_id":"50000000-0000-4000-8000-000000000061","insight_date":"2026-09-10","level":"adset","external_entity_id":"611","parent_external_id":"6100","spend":10,"impressions":100,"api_version":"v26.0"},
 {"agency_id":"aaaaaaaa-0000-4000-8000-000000000061","ad_account_id":"50000000-0000-4000-8000-000000000061","insight_date":"2026-09-10","level":"ad","external_entity_id":"612","parent_external_id":"611","spend":10,"impressions":100,"api_version":"v26.0"}]'::jsonb,
 (select actions from collection_fixture))$q$,'Coleta granular persiste quatro níveis atomicamente');
select is((select count(*) from meta_daily_insights),4::bigint,'Quatro níveis ficam disponíveis');
select ok((select levels@>array['account','campaign','adset','ad'] from meta_collection_runs),'Histórico confirma detalhamento inclusive sem atividade');
select throws_ok($q$select * from persist_meta_detailed_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30',(select insights from collection_fixture),
 jsonb_set((select actions from collection_fixture),'{0,external_entity_id}','"act_999"'))$q$,'23503',null,'Falha no detalhamento reverte o lote inteiro');
select is((select count(*) from meta_daily_insights),4::bigint,'Rollback preserva anúncios e totais anteriores');
select lives_ok($q$select * from persist_meta_detailed_slice(
 'aaaaaaaa-0000-4000-8000-000000000061','11111111-0000-4000-8000-000000000061','50000000-0000-4000-8000-000000000061',
 '2026-09-01','2026-09-30','[]','[]')$q$,'Resposta vazia reconcilia todos os níveis');
select is((select count(*) from meta_daily_insights),0::bigint,'Reconciliação remove detalhamento obsoleto');

reset role;
select * from finish();
rollback;
