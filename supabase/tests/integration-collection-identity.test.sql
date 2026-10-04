begin;
set local search_path=public,extensions;
select no_plan();
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000093','Identity');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000093','aaaaaaaa-0000-4000-8000-000000000093','Cliente A');
insert into integration_collection_jobs(id,client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,contract_version,idempotency_key)
values('90000000-0000-4000-8000-000000000093','11111111-0000-4000-8000-000000000093','40000000-0000-4000-8000-000000000093','meta','act_93','2026-10-01','2026-10-03','campaign','v24.0',11,'identity-test');
create temporary table identity_claim as select * from claim_integration_collection_job() with no data;
create temporary table identity_metric(payload jsonb);
insert into identity_metric values ('{"clientId":"11111111-0000-4000-8000-000000000093","connectionId":"40000000-0000-4000-8000-000000000093","provider":"meta","externalAccountId":"act_93","dateFrom":"2026-10-01","dateTo":"2026-10-03","level":"campaign","externalEntityId":"campaign-93","nativeKey":"spend","currency":"BRL","unit":"currency","value":"123.45","state":"available"}');
grant all on identity_claim,identity_metric to service_role;
set local role service_role;
insert into identity_claim select * from claim_integration_collection_job();
select is((select api_version from identity_claim),'v24.0','Claim preserva versão da API');
select is((select contract_version from identity_claim),11,'Claim preserva versão do contrato');

select throws_ok(format(
  'select persist_integration_collection_result(%L,1,''confirmed'',%L::jsonb,''{}'',''[{"endpoint":"insights","payload":{}}]'')',
  '90000000-0000-4000-8000-000000000093',
  jsonb_build_array(jsonb_set(payload,array[dimension],to_jsonb(wrong_value)))::text
),'22023',null,'Métrica fora do escopo é recusada: '||dimension)
from identity_metric cross join (values
  ('clientId','11111111-0000-4000-8000-000000000094'),
  ('connectionId','40000000-0000-4000-8000-000000000094'),
  ('provider','google'),('externalAccountId','act_other'),
  ('dateFrom','2026-09-01'),('dateTo','2026-10-04'),('level','ad')
) mismatches(dimension,wrong_value);
select throws_ok($q$select persist_integration_collection_result('90000000-0000-4000-8000-000000000093',1,'confirmed','[{}]','{}','[]')$q$,'22023',null,'Métrica sem identidade não passa pela validação');
select is((select count(*) from integration_raw_payloads),0::bigint,'Identidade inválida desfaz também os payloads brutos');
select is((select count(*) from integration_snapshots),0::bigint,'Identidade inválida não cria snapshot');
select throws_ok($q$insert into integration_snapshots(job_id,client_id,provider,external_account_id,date_from,date_to,entity_level,status) values('90000000-0000-4000-8000-000000000093','11111111-0000-4000-8000-000000000093','google','act_93','2026-10-01','2026-10-03','campaign','confirmed')$q$,'22023',null,'Escrita direta não altera provedor do job');
select lives_ok(format(
  'select persist_integration_collection_result(%L,1,''confirmed'',%L::jsonb,''{}'',''[{"endpoint":"insights","payload":{}}]'')',
  '90000000-0000-4000-8000-000000000093',jsonb_build_array(payload)::text
),'Métrica no escopo do job é persistida') from identity_metric;
select is((select payload->'metrics'->0->>'value' from integration_snapshots),'123.45','Persistência preserva precisão decimal');
select throws_ok($q$update integration_snapshots set external_account_id='act_other'$q$,'22023',null,'Snapshot existente não pode ser movido para outra conta');
select throws_ok($q$update integration_snapshots set payload='{"metrics":[{}]}'$q$,'22023',null,'Atualização não contorna identidade das métricas');
select finish_integration_collection_job('90000000-0000-4000-8000-000000000093',1,'partial',now());
truncate identity_claim;
insert into identity_claim select * from claim_integration_collection_job();
select is((select attempt_count from identity_claim),2,'Retry incrementa tentativa');
select is((select api_version from identity_claim),'v24.0','Retry preserva versão da API');
select is((select contract_version from identity_claim),11,'Retry preserva contrato original');
reset role;
select * from finish();
rollback;
