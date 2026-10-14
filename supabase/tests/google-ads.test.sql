begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
  ('d1000000-0000-4000-8000-000000000001','ga-owner@example.test',now()),
  ('d1000000-0000-4000-8000-000000000002','ga-editor@example.test',now()),
  ('d1000000-0000-4000-8000-000000000003','ga-viewer@example.test',now()),
  ('d1000000-0000-4000-8000-000000000004','ga-outro@example.test',now());
insert into agencies(id,name) values ('d1aaaaaa-0000-4000-8000-000000000001','Espaço GA'),('d1aaaaaa-0000-4000-8000-000000000002','Outro GA');
insert into agency_users(agency_id,user_id,role) values
  ('d1aaaaaa-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','owner'),
  ('d1aaaaaa-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','editor'),
  ('d1aaaaaa-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','viewer'),
  ('d1aaaaaa-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000004','owner');
insert into clients(id,agency_id,name) values ('d1cccccc-0000-4000-8000-000000000001','d1aaaaaa-0000-4000-8000-000000000001','Cliente GA');
insert into integrations(id,agency_id,provider,connection_status) values ('d1111111-0000-4000-8000-000000000001','d1aaaaaa-0000-4000-8000-000000000001','google','connected');
insert into google_connections(id,agency_id,integration_id,login_customer_id) values ('d1222222-0000-4000-8000-000000000001','d1aaaaaa-0000-4000-8000-000000000001','d1111111-0000-4000-8000-000000000001','1234567890');
insert into google_ad_accounts(id,agency_id,google_connection_id,customer_id,name) values ('d1333333-0000-4000-8000-000000000001','d1aaaaaa-0000-4000-8000-000000000001','d1222222-0000-4000-8000-000000000001','2223334444','Conta Google');

select throws_ok($$insert into google_ad_accounts(agency_id,google_connection_id,customer_id,name) values ('d1aaaaaa-0000-4000-8000-000000000001','d1222222-0000-4000-8000-000000000001','123','Curta')$$,'23514',null,'Número de conta precisa ter 10 dígitos');
select throws_ok($$update google_ad_accounts set login_customer_id='12' where id='d1333333-0000-4000-8000-000000000001'$$,'23514',null,'Gerente da conta precisa ter 10 dígitos');
select throws_ok($$insert into google_connections(agency_id,integration_id,login_customer_id) values ('d1aaaaaa-0000-4000-8000-000000000001','d1111111-0000-4000-8000-000000000001','abc')$$,'23514',null,'Conta de gerente inválida é recusada');

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from google_ad_accounts),1,'Editor lê as contas Google da organização');
select lives_ok($$insert into client_google_accounts(agency_id,client_id,google_ad_account_id) values ('d1aaaaaa-0000-4000-8000-000000000001','d1cccccc-0000-4000-8000-000000000001','d1333333-0000-4000-8000-000000000001')$$,'Editor vincula a conta ao cliente');
select throws_ok($$insert into google_ad_accounts(agency_id,google_connection_id,customer_id,name) values ('d1aaaaaa-0000-4000-8000-000000000001','d1222222-0000-4000-8000-000000000001','9998887777','Nova')$$,'42501',null,'Contas Google só entram pelo servidor');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from client_google_accounts),1,'Leitor vê o vínculo');
select lives_ok($$update client_google_accounts set active=false$$,'Leitor tenta alterar sem efeito (RLS filtra as linhas)');
select is((select active from client_google_accounts),true,'Vínculo continua ativo');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from google_ad_accounts),0,'Outra organização não vê as contas');
select is((select count(*)::int from google_connections),0,'Outra organização não vê a conexão');
reset role;
select * from finish();
rollback;
