begin;
set local search_path=public,extensions;
select no_plan();
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000091','Workers');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000091','aaaaaaaa-0000-4000-8000-000000000091','Cliente A');
insert into integration_collection_jobs(id,client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,idempotency_key,next_attempt_at)
values('90000000-0000-4000-8000-000000000091','11111111-0000-4000-8000-000000000091','40000000-0000-4000-8000-000000000091','google','account-a','2026-10-01','2026-10-03','campaign','v-test','lease-test',now()-interval '1 hour');

select ok(not has_function_privilege('authenticated','public.claim_integration_collection_job(timestamptz)','execute'),'Usuário não reivindica jobs');
select ok(not has_function_privilege('anon','public.persist_integration_collection_result(uuid,integer,text,jsonb,jsonb,jsonb)','execute'),'Visitante não grava resultados');
select ok(not has_function_privilege('authenticated','public.finish_integration_collection_job(uuid,integer,text,timestamptz,text,text,timestamptz)','execute'),'Usuário não finaliza jobs');
select ok(not has_function_privilege('anon','public.record_integration_provider_health(uuid,text,boolean,text,integer)','execute'),'Visitante não escreve saúde');
select ok(not has_function_privilege('service_role','private.finish_integration_collection_job(uuid,integer,text,timestamptz,text,text,timestamptz)','execute'),'Worker usa a RPC pública restrita');

set local role service_role;
select is((select attempt_count from claim_integration_collection_job(now()-interval '16 minutes')),1,'Primeira reivindicação incrementa a tentativa');
select throws_ok($q$select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',1,'confirmed')$q$,'40001',null,'Claim expirado não finaliza mesmo antes da retomada');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',1,'confirmed','[]','{}','[]')$q$,'40001',null,'Claim expirado não grava resultados');
select is((select attempt_count from claim_integration_collection_job()),2,'Job abandonado é retomado com outra tentativa');
select is((select count(*) from claim_integration_collection_job()),0::bigint,'Job com claim vigente não é reivindicado de novo');
select throws_ok($q$select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',1,'failed')$q$,'40001',null,'Worker antigo não finaliza a tentativa retomada');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',1,'confirmed','[]','{}','[]')$q$,'40001',null,'Worker antigo não grava snapshot na tentativa retomada');
select is((select count(*) from integration_snapshots),0::bigint,'Workers antigos não deixam snapshots');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',2,'confirmed','[]','{"confirmed":false}','[]')$q$,'22023',null,'Reconciliação negativa não confirma snapshot');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',2,'confirmed','[]','{}','[{"endpoint":"first","payload":{}},{"payload":{}}]')$q$,'23502',null,'Falha em payload desfaz a transação inteira');
select is((select count(*) from integration_raw_payloads),0::bigint,'Falha transacional não deixa payloads parciais');
select lives_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',2,'confirmed','[]','{}','[{"endpoint":"insights","payload":{"rows":[]},"httpStatus":200}]')$q$,'Tentativa atual grava resultado');
select lives_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',2,'confirmed','[]','{}','[{"endpoint":"insights","payload":{"rows":[]}}]')$q$,'Repetição da gravação é idempotente');
select is((select count(*) from integration_snapshots),1::bigint,'Uma tentativa cria um único snapshot');
select is((select count(*) from integration_raw_payloads),1::bigint,'Repetição não duplica payloads');
select is((select provider from integration_raw_payloads limit 1),'google','Payload usa provedor do job');
select is((select client_id::text from integration_snapshots limit 1),'11111111-0000-4000-8000-000000000091','Snapshot usa cliente do job');
select is((select status from integration_collection_jobs limit 1),'collecting','Persistência mantém claim até a finalização');
select lives_ok($q$select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',2,'confirmed')$q$,'Worker atual finaliza job');
select ok((select completed_at is not null from integration_collection_jobs limit 1),'Confirmação registra conclusão');
select is((select count(*) from claim_integration_collection_job(now()+interval '1 hour')),0::bigint,'Job confirmado nunca é retomado');
select throws_ok($q$select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',2,'failed')$q$,'40001',null,'Finalização repetida não sobrescreve confirmação');
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000091',2,'confirmed','[]','{}','[]')$q$,'40001',null,'Job finalizado não recebe novos resultados');
update integration_collection_jobs set status='collecting',started_at=now()-interval '15 minutes';
select is((select attempt_count from claim_integration_collection_job()),3,'Expiração no limite de quinze minutos permite retomada');
select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',3,'partial',now()+interval '1 hour');
select is((select count(*) from claim_integration_collection_job()),0::bigint,'Retry futuro respeita horário agendado');
update integration_collection_jobs set next_attempt_at=now();
select is((select attempt_count from claim_integration_collection_job()),4,'Retry vencido inicia outra tentativa');
select finish_integration_collection_job('90000000-0000-4000-8000-000000000091',4,'failed');
select is((select count(*) from claim_integration_collection_job(now()+interval '1 hour')),0::bigint,'Falha terminal não é retomada');
select ok((select completed_at is null from integration_collection_jobs limit 1),'Retry e falha removem conclusão antiga');
update integration_collection_jobs set status='collecting',started_at=null,updated_at=now()-interval '16 minutes';
select is((select attempt_count from claim_integration_collection_job()),5,'Job legado sem início usa updated_at para recuperar');
reset role;

insert into auth.users(id,email) values('10000000-0000-4000-8000-000000000091','worker-client-a@example.test');
insert into clients(id,agency_id,name) values('11111111-0000-4000-8000-000000000092','aaaaaaaa-0000-4000-8000-000000000091','Cliente B');
insert into client_users(agency_id,client_id,user_id,active) values
('aaaaaaaa-0000-4000-8000-000000000091','11111111-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091',true);
insert into integration_snapshots(job_id,client_id,provider,external_account_id,date_from,date_to,entity_level,status)
values('90000000-0000-4000-8000-000000000091','11111111-0000-4000-8000-000000000092','google','account-b','2026-10-01','2026-10-03','campaign','confirmed');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000091',true);
select is((select count(*) from integration_snapshots),1::bigint,'Cliente lê somente snapshot do próprio vínculo');
select throws_ok($q$select * from integration_raw_payloads$q$,'42501',null,'Cliente não recebe acesso a payloads brutos');
reset role;
update integration_snapshots set status='partial' where client_id='11111111-0000-4000-8000-000000000091';
set local role authenticated;
select is((select count(*) from integration_snapshots),0::bigint,'Cliente não recebe snapshot parcial');
reset role;
update integration_snapshots set status='confirmed' where client_id='11111111-0000-4000-8000-000000000091';
update client_users set active=false where user_id='10000000-0000-4000-8000-000000000091';
set local role authenticated;
select is((select count(*) from integration_snapshots),0::bigint,'Revogação do vínculo retira acesso ao snapshot');
reset role;
update client_users set active=true where user_id='10000000-0000-4000-8000-000000000091';
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000091';
set local role authenticated;
select is((select count(*) from integration_snapshots),0::bigint,'Cliente arquivado não recebe snapshots');
reset role;
select * from finish();
rollback;
