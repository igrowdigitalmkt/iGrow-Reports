begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000097','read-client@example.test'),
('10000000-0000-4000-8000-000000000098','read-owner@example.test'),
('10000000-0000-4000-8000-000000000099','read-other@example.test');
insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000097','Read A'),('aaaaaaaa-0000-4000-8000-000000000099','Read B');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000098','owner'),
('aaaaaaaa-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000099','owner');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000097','aaaaaaaa-0000-4000-8000-000000000097','Read A'),
('11111111-0000-4000-8000-000000000098','aaaaaaaa-0000-4000-8000-000000000097','Read A2');
insert into client_users(agency_id,client_id,user_id) values
('aaaaaaaa-0000-4000-8000-000000000097','11111111-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000097');
insert into integration_collection_jobs(id,client_id,connection_id,provider,external_account_id,date_from,date_to,entity_level,api_version,contract_version,idempotency_key,status)
values('90000000-0000-4000-8000-000000000097','11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','v-test',1,'read-job','failed');
insert into integration_snapshots(id,job_id,client_id,provider,external_account_id,date_from,date_to,entity_level,status,payload,collected_at) values
('70000000-0000-4000-8000-000000000097','90000000-0000-4000-8000-000000000097','11111111-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','confirmed','{"metrics":[]}',now()-interval '2 hours'),
('70000000-0000-4000-8000-000000000098','90000000-0000-4000-8000-000000000097','11111111-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','confirmed','{"metrics":[]}',now()-interval '1 hour'),
('70000000-0000-4000-8000-000000000099','90000000-0000-4000-8000-000000000097','11111111-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','partial','{"metrics":[]}',now());
create temporary view read_test_snapshot as select get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','v-test',1) as payload;
grant select on read_test_snapshot to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000097',true);
select is((select payload->>'snapshotId' from read_test_snapshot),'70000000-0000-4000-8000-000000000098','Cliente recebe o último confirmado apesar de retry parcial e job falho');
select ok(not ((select payload from read_test_snapshot) ? 'rawPayloads'),'DTO não expõe payloads brutos');
select ok((select payload from read_test_snapshot) ? 'collectedAt','DTO identifica atualização');
select is(get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','other-api',1),null::jsonb,'Outra API não reutiliza snapshot');
select is(get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','v-test',2),null::jsonb,'Outro contrato não reutiliza snapshot');
select is(get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000098','google','account-97','2026-10-01','2026-10-03','campaign','v-test',1),null::jsonb,'Outra conexão não reutiliza snapshot');
select is(get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-02','campaign','v-test',1),null::jsonb,'Outro período não reutiliza snapshot');
select is(get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000097','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','ad','v-test',1),null::jsonb,'Outro nível não reutiliza snapshot');
select throws_ok($q$select get_confirmed_collection_snapshot('11111111-0000-4000-8000-000000000098','40000000-0000-4000-8000-000000000097','google','account-97','2026-10-01','2026-10-03','campaign','v-test',1)$q$,'42501',null,'Cliente não consulta outro cliente da mesma agência');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000098',true);
select is((select payload->>'snapshotId' from read_test_snapshot),'70000000-0000-4000-8000-000000000098','Owner consulta o confirmado da própria agência');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
select throws_ok($q$select * from read_test_snapshot$q$,'42501',null,'Outra agência não consulta snapshot');
reset role;
update client_users set active=false where user_id='10000000-0000-4000-8000-000000000097';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000097',true);
select throws_ok($q$select * from read_test_snapshot$q$,'42501',null,'Vínculo revogado perde acesso à RPC');
reset role;
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000097';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000098',true);
select throws_ok($q$select * from read_test_snapshot$q$,'42501',null,'Cliente arquivado não gera DTO');
reset role;
select ok(not has_function_privilege('anon','public.get_confirmed_collection_snapshot(uuid,uuid,text,text,date,date,text,text,integer)','execute'),'Visitante não consulta RPC');
select * from finish();
rollback;
