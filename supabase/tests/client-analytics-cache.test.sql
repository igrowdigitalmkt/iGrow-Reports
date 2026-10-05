begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000961','cache-owner@example.test',now()),
('10000000-0000-4000-8000-000000000962','cache-client@example.test',now()),
('10000000-0000-4000-8000-000000000963','cache-other@example.test',now());
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000961','Cache A');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000961','owner');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000961','aaaaaaaa-0000-4000-8000-000000000961','Analytics Cliente'),
('11111111-0000-4000-8000-000000000962','aaaaaaaa-0000-4000-8000-000000000961','Outro Cliente');
insert into client_users(agency_id,client_id,user_id,active) values
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','10000000-0000-4000-8000-000000000962',true);
insert into integrations(id,agency_id,provider,connection_status) values
('30000000-0000-4000-8000-000000000961','aaaaaaaa-0000-4000-8000-000000000961','meta','connected');
insert into meta_connections(id,agency_id,integration_id,client_id) values
('40000000-0000-4000-8000-000000000961','aaaaaaaa-0000-4000-8000-000000000961','30000000-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961'),
('40000000-0000-4000-8000-000000000962','aaaaaaaa-0000-4000-8000-000000000961','30000000-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000962');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id,archived_at) values
('50000000-0000-4000-8000-000000000961','aaaaaaaa-0000-4000-8000-000000000961','40000000-0000-4000-8000-000000000961','act_9601','Conta BRL','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000962','aaaaaaaa-0000-4000-8000-000000000961','40000000-0000-4000-8000-000000000961','act_9602','Conta USD','USD','America/New_York','100',null),
('50000000-0000-4000-8000-000000000963','aaaaaaaa-0000-4000-8000-000000000961','40000000-0000-4000-8000-000000000962','act_9603','Conta de outro cliente','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000964','aaaaaaaa-0000-4000-8000-000000000961','40000000-0000-4000-8000-000000000961','act_9604','Conta arquivada','BRL','America/Sao_Paulo',null,now());
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active) values
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961',true),
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000962',false),
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000963',true),
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000964',true);
insert into client_metric_mappings(agency_id,client_id,primary_metric_key,primary_action_type,revenue_action_type) values
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','leads','lead','omni_purchase');
insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,entity_name,spend,impressions,reach,link_clicks,api_version,metadata) values
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-29','account','act_9601','Conta BRL',100,10000,9000,50,'v26.0','{"clicks":70}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','account','act_9601','Conta BRL',200,10000,9500,50,'v26.0','{"clicks":80}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-26','account','act_9601','Conta BRL',50,1000,900,10,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-29','campaign','campaign961','Campanha real',100,10000,9000,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','campaign','campaign961','Campanha real',200,10000,9500,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','ad','ad961','Anúncio real',999,999,999,999,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000964','2026-09-30','account','act_9604','Conta arquivada',777,777,777,777,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000963','2026-09-30','account','act_9603','Outra conta',9999,9999,9999,9999,'v26.0','{}');
insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount) values
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-29','account','act_9601','lead',10,null),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','account','act_9601','lead',20,null),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-29','account','act_9601','landing_page_view',70,null),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','account','act_9601','landing_page_view',60,null),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','account','act_9601','omni_purchase',3,1200),
('aaaaaaaa-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-30','campaign','campaign961','lead',20,null);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels) values
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-28','2026-09-30','complete',4,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-22','2026-09-24','complete',0,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-25','2026-09-27','complete',1,array['account','campaign']);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels)
values('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961',
  (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date,'complete',0,array['account','campaign']);
insert into meta_period_insights(agency_id,client_id,ad_account_id,date_from,date_to,reach,frequency,unique_clicks,api_version) values
('aaaaaaaa-0000-4000-8000-000000000961','11111111-0000-4000-8000-000000000961','50000000-0000-4000-8000-000000000961','2026-09-28','2026-09-30',12000,1.6667,85,'v26.0');


-- Fixture derived from analytics.test.sql with isolated identifiers.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000961',true);

create temp table cache_results(step text primary key, payload jsonb) on commit drop;
grant all on cache_results to authenticated;
insert into cache_results values('first',get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null));
reset role;
select is((select count(*) from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000961'),1::bigint,'Período calculado fica guardado');
select is((select payload-'coverage' from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000961'),
  private.client_analytics_compute('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null)-'coverage','Resultado guardado é o mesmo do cálculo direto');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000961',true);
insert into cache_results values('second',get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null));
select is((select payload from cache_results where step='second'),(select payload from cache_results where step='first'),'Segunda leitura devolve o mesmo resultado');

-- A change inside the same transaction must be seen.
reset role;
update meta_daily_insights set spend=300 where ad_account_id='50000000-0000-4000-8000-000000000961' and insight_date='2026-09-30' and level='account';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000961',true);
insert into cache_results values('after_update',get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null));
select is(((select payload from cache_results where step='after_update')->'summary'->>'spend')::numeric,
  ((select payload from cache_results where step='first')->'summary'->>'spend')::numeric+100,'Alteração de valor recalcula o período');

reset role;
delete from meta_daily_actions where ad_account_id='50000000-0000-4000-8000-000000000961' and insight_date='2026-09-30' and level='account' and action_type='lead';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000961',true);
insert into cache_results values('after_delete',get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null));
select isnt((select payload from cache_results where step='after_delete')->'summary'->'action:lead',
  (select payload from cache_results where step='after_update')->'summary'->'action:lead','Ação removida recalcula o período');

reset role;
update client_metric_mappings set primary_action_type='landing_page_view' where client_id='11111111-0000-4000-8000-000000000961';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000961',true);
insert into cache_results values('after_mapping',get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null));
select is((select payload->>'primaryActionType' from cache_results where step='after_mapping'),'landing_page_view','Configuração do cliente recalcula o período');

-- Authorization is checked before any stored period is read.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000963',true);
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null)$$,
  '42501',null,'Usuário sem vínculo não recebe período guardado');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000962',true);
select is(get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',null)->'summary',
  (select payload->'summary' from cache_results where step='after_mapping'),'Cliente autorizado lê o mesmo resultado');
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000961','2026-09-28','2026-09-30',array['50000000-0000-4000-8000-000000000963']::uuid[])$$,
  '42501',null,'Conta de outro cliente continua rejeitada');
select throws_ok($$select count(*) from private.client_analytics_cache$$,'42501',null,'Tabela de resultados guardados não é exposta');
reset role;

select * from finish();
rollback;
