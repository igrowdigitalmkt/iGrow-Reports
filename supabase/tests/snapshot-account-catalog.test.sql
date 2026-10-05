begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000201','catalog-client@example.test'),
('10000000-0000-4000-8000-000000000202','catalog-owner@example.test'),
('10000000-0000-4000-8000-000000000203','catalog-other@example.test');
insert into agencies(id,name) values('aaaaaaaa-0000-4000-8000-000000000201','Catalog A'),('aaaaaaaa-0000-4000-8000-000000000203','Catalog B');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000202','owner'),
('aaaaaaaa-0000-4000-8000-000000000203','10000000-0000-4000-8000-000000000203','owner');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000201','aaaaaaaa-0000-4000-8000-000000000201','Client A'),
('11111111-0000-4000-8000-000000000202','aaaaaaaa-0000-4000-8000-000000000201','Client A2');
insert into client_users(agency_id,client_id,user_id) values('aaaaaaaa-0000-4000-8000-000000000201','11111111-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000201');
insert into integrations(id,agency_id,provider,connection_status) values('30000000-0000-4000-8000-000000000201','aaaaaaaa-0000-4000-8000-000000000201','meta','disconnected');
insert into meta_connections(id,agency_id,integration_id,client_id) values('40000000-0000-4000-8000-000000000201','aaaaaaaa-0000-4000-8000-000000000201','30000000-0000-4000-8000-000000000201','11111111-0000-4000-8000-000000000201');
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values
('50000000-0000-4000-8000-000000000201','aaaaaaaa-0000-4000-8000-000000000201','40000000-0000-4000-8000-000000000201','act_201','Account A','BRL','America/Sao_Paulo','100201');
insert into client_ad_accounts(agency_id,client_id,ad_account_id) values
('aaaaaaaa-0000-4000-8000-000000000201','11111111-0000-4000-8000-000000000201','50000000-0000-4000-8000-000000000201');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000201',true);
select is((select count(*) from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),1::bigint,'Cliente consulta catálogo autorizado mesmo desconectado');
select is((select external_id from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),'act_201','Catálogo preserva ID externo');
select is((select connection_id::text from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),'40000000-0000-4000-8000-000000000201','Catálogo identifica conexão exata');
select throws_ok($q$select * from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000202')$q$,'42501',null,'Cliente não consulta outro cliente da agência');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000202',true);
select is((select count(*) from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),1::bigint,'Owner consulta cliente da própria agência');
select is((select count(*) from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000202')),0::bigint,'Cliente sem conexão retorna catálogo vazio');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000203',true);
select throws_ok($q$select * from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')$q$,'42501',null,'Outra agência não consulta catálogo');
reset role;
update client_ad_accounts set active=false where client_id='11111111-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000201',true);
select is((select count(*) from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),0::bigint,'Vínculo de conta revogado remove conta do catálogo');
reset role;
update client_ad_accounts set active=true where client_id='11111111-0000-4000-8000-000000000201';
update meta_ad_accounts set archived_at=now() where external_id='act_201';
set local role authenticated;
select is((select count(*) from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')),0::bigint,'Conta arquivada fica oculta');
reset role;
update client_users set active=false where user_id='10000000-0000-4000-8000-000000000201';
set local role authenticated;
select throws_ok($q$select * from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')$q$,'42501',null,'Acesso de cliente revogado bloqueia catálogo');
reset role;
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000202',true);
select throws_ok($q$select * from list_client_snapshot_accounts('11111111-0000-4000-8000-000000000201')$q$,'42501',null,'Cliente arquivado não libera catálogo');
reset role;
select ok(not has_function_privilege('anon','public.list_client_snapshot_accounts(uuid)','execute'),'Visitante não consulta catálogo');
select * from finish();
rollback;
