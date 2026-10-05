begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000861','warm-owner@example.test',now()),
('10000000-0000-4000-8000-000000000862','warm-client@example.test',now()),
('10000000-0000-4000-8000-000000000863','warm-other@example.test',now());
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000861','Warm A');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000861','10000000-0000-4000-8000-000000000861','owner');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000861','aaaaaaaa-0000-4000-8000-000000000861','Analytics Cliente'),
('11111111-0000-4000-8000-000000000862','aaaaaaaa-0000-4000-8000-000000000861','Outro Cliente');
insert into client_users(agency_id,client_id,user_id,active) values
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','10000000-0000-4000-8000-000000000862',true);
insert into integrations(id,agency_id,provider,connection_status) values
('30000000-0000-4000-8000-000000000861','aaaaaaaa-0000-4000-8000-000000000861','meta','connected');
insert into meta_connections(id,agency_id,integration_id,client_id) values
('40000000-0000-4000-8000-000000000861','aaaaaaaa-0000-4000-8000-000000000861','30000000-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861'),
('40000000-0000-4000-8000-000000000862','aaaaaaaa-0000-4000-8000-000000000861','30000000-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000862');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id,archived_at) values
('50000000-0000-4000-8000-000000000861','aaaaaaaa-0000-4000-8000-000000000861','40000000-0000-4000-8000-000000000861','act_8601','Conta BRL','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000862','aaaaaaaa-0000-4000-8000-000000000861','40000000-0000-4000-8000-000000000861','act_8602','Conta USD','USD','America/New_York','100',null),
('50000000-0000-4000-8000-000000000863','aaaaaaaa-0000-4000-8000-000000000861','40000000-0000-4000-8000-000000000862','act_8603','Conta de outro cliente','BRL','America/Sao_Paulo','100',null),
('50000000-0000-4000-8000-000000000864','aaaaaaaa-0000-4000-8000-000000000861','40000000-0000-4000-8000-000000000861','act_8604','Conta arquivada','BRL','America/Sao_Paulo',null,now());
insert into client_ad_accounts(agency_id,client_id,ad_account_id,active) values
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861',true),
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000862',false),
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000863',true),
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000864',true);
insert into client_metric_mappings(agency_id,client_id,primary_metric_key,primary_action_type,revenue_action_type) values
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','leads','lead','omni_purchase');
insert into meta_daily_insights(agency_id,ad_account_id,insight_date,level,external_entity_id,entity_name,spend,impressions,reach,link_clicks,api_version,metadata) values
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-29','account','act_8601','Conta BRL',100,10000,9000,50,'v26.0','{"clicks":70}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','account','act_8601','Conta BRL',200,10000,9500,50,'v26.0','{"clicks":80}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-26','account','act_8601','Conta BRL',50,1000,900,10,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-29','campaign','campaign861','Campanha real',100,10000,9000,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','campaign','campaign861','Campanha real',200,10000,9500,50,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','ad','ad861','Anúncio real',999,999,999,999,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000864','2026-09-30','account','act_8604','Conta arquivada',777,777,777,777,'v26.0','{}'),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000863','2026-09-30','account','act_8603','Outra conta',9999,9999,9999,9999,'v26.0','{}');
insert into meta_daily_actions(agency_id,ad_account_id,insight_date,level,external_entity_id,action_type,action_value,value_amount) values
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-29','account','act_8601','lead',10,null),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','account','act_8601','lead',20,null),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-29','account','act_8601','landing_page_view',70,null),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','account','act_8601','landing_page_view',60,null),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','account','act_8601','omni_purchase',3,1200),
('aaaaaaaa-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-30','campaign','campaign861','lead',20,null);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels) values
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-28','2026-09-30','complete',4,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-22','2026-09-24','complete',0,array['account','campaign']),
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-25','2026-09-27','complete',1,array['account','campaign']);
insert into meta_collection_runs(agency_id,client_id,ad_account_id,date_from,date_to,status,insight_count,levels)
values('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861',
  (now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date,'complete',0,array['account','campaign']);
insert into meta_period_insights(agency_id,client_id,ad_account_id,date_from,date_to,reach,frequency,unique_clicks,api_version) values
('aaaaaaaa-0000-4000-8000-000000000861','11111111-0000-4000-8000-000000000861','50000000-0000-4000-8000-000000000861','2026-09-28','2026-09-30',12000,1.6667,85,'v26.0');



-- Fixture derived from analytics.test.sql with isolated identifiers.
select is((select count(*) from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000861'),0::bigint,'Nada guardado antes do aquecimento');
set local role service_role;
select is(warm_client_analytics('11111111-0000-4000-8000-000000000861','2026-09-28','2026-09-30'),true,'Chave de serviço pré-calcula o período');
select is(current_setting('request.jwt.claim.sub',true),'','Identidade é restaurada após o aquecimento');
select is(warm_client_analytics('11111111-0000-4000-8000-000000000862','2026-09-28','2026-09-30'),true,'Cliente sem contas também é aquecido');
reset role;
select is((select count(*) from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000861' and accounts_key like '%|all'),1::bigint,'Período padrão fica guardado com todas as contas');
select set_config('test.warmed_at',(select computed_at::text from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000861' and accounts_key like '%|all'),true);
-- Distinguish a recomputation from the stored row even within one transaction.
update private.client_analytics_cache set computed_at=computed_at-interval '1 minute' where client_id='11111111-0000-4000-8000-000000000861';

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000861',true);
select set_config('test.owner_read',(get_client_analytics('11111111-0000-4000-8000-000000000861','2026-09-28','2026-09-30',null)-'coverage')::text,true);
select throws_ok($$select warm_client_analytics('11111111-0000-4000-8000-000000000861','2026-09-28','2026-09-30')$$,'42501',null,'Usuário autenticado não aciona o aquecimento');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000863',true);
select throws_ok($$select get_client_analytics('11111111-0000-4000-8000-000000000861','2026-09-28','2026-09-30',null)$$,'42501',null,'Aquecimento não libera acesso a quem não tem vínculo');
reset role;
select is((select computed_at from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000861' and accounts_key like '%|all'),
  current_setting('test.warmed_at')::timestamptz-interval '1 minute','Leitura do dono usa o resultado pré-calculado sem recalcular');
select is(current_setting('test.owner_read')::jsonb->'summary'->>'spend',
  (select payload->'summary'->>'spend' from private.client_analytics_cache where client_id='11111111-0000-4000-8000-000000000861' and accounts_key like '%|all'),
  'Dono vê os valores do resultado pré-calculado');
set local role anon;
select throws_ok($$select warm_client_analytics('11111111-0000-4000-8000-000000000861','2026-09-28','2026-09-30')$$,'42501',null,'Visitante não aciona o aquecimento');
reset role;
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000862';
set local role service_role;
select is(warm_client_analytics('11111111-0000-4000-8000-000000000862','2026-09-28','2026-09-30'),false,'Cliente arquivado não é aquecido');
reset role;

select * from finish();
rollback;
