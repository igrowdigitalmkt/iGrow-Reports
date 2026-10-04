begin;
set local search_path=public,extensions;
select no_plan();
insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000094','Scope A'),('aaaaaaaa-0000-4000-8000-000000000095','Scope B');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000094','aaaaaaaa-0000-4000-8000-000000000094','Cliente A'),
('11111111-0000-4000-8000-000000000096','aaaaaaaa-0000-4000-8000-000000000094','Cliente A2'),
('11111111-0000-4000-8000-000000000095','aaaaaaaa-0000-4000-8000-000000000095','Cliente B');
insert into integrations(id,agency_id,provider,connection_status) values
('30000000-0000-4000-8000-000000000094','aaaaaaaa-0000-4000-8000-000000000094','meta','connected'),
('30000000-0000-4000-8000-000000000095','aaaaaaaa-0000-4000-8000-000000000095','meta','connected');
insert into meta_connections(id,agency_id,integration_id,client_id,connected_at) values
('40000000-0000-4000-8000-000000000094','aaaaaaaa-0000-4000-8000-000000000094','30000000-0000-4000-8000-000000000094','11111111-0000-4000-8000-000000000094',now()),
('40000000-0000-4000-8000-000000000095','aaaaaaaa-0000-4000-8000-000000000095','30000000-0000-4000-8000-000000000095','11111111-0000-4000-8000-000000000095',now());
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values
('50000000-0000-4000-8000-000000000094','aaaaaaaa-0000-4000-8000-000000000094','40000000-0000-4000-8000-000000000094','act_94','Conta A','BRL','America/Sao_Paulo','10094'),
('50000000-0000-4000-8000-000000000095','aaaaaaaa-0000-4000-8000-000000000095','40000000-0000-4000-8000-000000000095','act_95','Conta B','BRL','America/Sao_Paulo','10095');
insert into client_ad_accounts(agency_id,client_id,ad_account_id) values
('aaaaaaaa-0000-4000-8000-000000000094','11111111-0000-4000-8000-000000000094','50000000-0000-4000-8000-000000000094'),
('aaaaaaaa-0000-4000-8000-000000000095','11111111-0000-4000-8000-000000000095','50000000-0000-4000-8000-000000000095');
select ok(not has_function_privilege('authenticated','public.authorize_integration_collection_job(uuid,integer)','execute'),'Sessão de cliente não autoriza workers');
select ok(not has_function_privilege('anon','public.authorize_integration_collection_job(uuid,integer)','execute'),'Visitante não autoriza workers');

set local role service_role;
select throws_ok($q$insert into integration_collection_jobs(client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key) values('11111111-0000-4000-8000-000000000096','40000000-0000-4000-8000-000000000094','meta','act_94','2026-10-01','2026-10-03','campaign','v24.0','invalid-client')$q$,'42501',null,'Conexão de outro cliente da mesma agência não cria job');
select throws_ok($q$insert into integration_collection_jobs(client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key) values('11111111-0000-4000-8000-000000000094','40000000-0000-4000-8000-000000000095','meta','act_95','2026-10-01','2026-10-03','campaign','v24.0','invalid-agency')$q$,'42501',null,'Conexão de outra agência não cria job');
select throws_ok($q$insert into integration_collection_jobs(client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key) values('11111111-0000-4000-8000-000000000094','40000000-0000-4000-8000-000000000094','meta','act_95','2026-10-01','2026-10-03','campaign','v24.0','invalid-account')$q$,'42501',null,'Conta de outra conexão não cria job');
insert into integration_collection_jobs(id,client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key)
values('90000000-0000-4000-8000-000000000094','11111111-0000-4000-8000-000000000094','40000000-0000-4000-8000-000000000094','meta','act_94','2026-10-01','2026-10-03','campaign','v24.0','scope-job');
select is((select attempt_count from claim_integration_collection_job()),1,'Job autorizado entra na fila');
select is(authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)::text,'30000000-0000-4000-8000-000000000094','Autorização retorna integração em vez da conexão Meta');
select is((record_integration_provider_health(authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1),'meta',true)).status,'healthy','Saúde é gravada na integração autorizada');
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',2)$q$,'40001',null,'Outra tentativa não autoriza coleta');
select throws_ok($q$update integration_collection_jobs set client_id='11111111-0000-4000-8000-000000000096'$q$,'42501',null,'Job não pode ser movido para cliente sem conexão');

update client_ad_accounts set active=false where client_id='11111111-0000-4000-8000-000000000094';
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)$q$,'42501',null,'Vínculo revogado após enfileirar impede coleta');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000094',1,'confirmed','[]','{}','[{"endpoint":"insights","payload":{}}]')$q$,'42501',null,'Vínculo revogado durante coleta impede snapshot');
select is((select count(*) from integration_raw_payloads),0::bigint,'Revogação desfaz payloads brutos da transação');
update client_ad_accounts set active=true where client_id='11111111-0000-4000-8000-000000000094';
update meta_ad_accounts set archived_at=now() where external_id='act_94';
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)$q$,'42501',null,'Conta arquivada não autoriza coleta');
update meta_ad_accounts set archived_at=null where external_id='act_94';
update integrations set connection_status='disconnected' where id='30000000-0000-4000-8000-000000000094';
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)$q$,'42501',null,'Integração desconectada não autoriza coleta');
update integrations set connection_status='connected' where id='30000000-0000-4000-8000-000000000094';
update meta_connections set connected_at=null where id='40000000-0000-4000-8000-000000000094';
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)$q$,'42501',null,'Conexão ainda não autorizada impede coleta');
update meta_connections set connected_at=now() where id='40000000-0000-4000-8000-000000000094';
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000094';
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000094',1)$q$,'42501',null,'Cliente arquivado não autoriza coleta');
select lives_ok($q$select finish_integration_collection_job('90000000-0000-4000-8000-000000000094',1,'failed',null,'collection_scope_invalid')$q$,'Revogação ainda permite registrar a falha terminal');
insert into integration_collection_jobs(id,client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key)
values('90000000-0000-4000-8000-000000000096','11111111-0000-4000-8000-000000000096','40000000-0000-4000-8000-000000000096','google','synthetic','2026-10-01','2026-10-03','campaign','v-test','synthetic-provider');
select is((select attempt_count from claim_integration_collection_job()),1,'Fundação da fila permite fixture de provedor futuro');
select throws_ok($q$select authorize_integration_collection_job('90000000-0000-4000-8000-000000000096',1)$q$,'42501',null,'Provedor sem modelo de autorização não inicia coleta');
reset role;
select * from finish();
rollback;
