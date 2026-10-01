begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000011','portal-owner-a@example.test',now()),
('10000000-0000-4000-8000-000000000012','portal-owner-b@example.test',now()),
('10000000-0000-4000-8000-000000000013','portal-editor@example.test',now()),
('10000000-0000-4000-8000-000000000014','portal-client-a@example.test',now()),
('10000000-0000-4000-8000-000000000015','portal-client-b@example.test',now()),
('10000000-0000-4000-8000-000000000016','portal-unconfirmed@example.test',null);

insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000011','Agência portal A'),
('bbbbbbbb-0000-4000-8000-000000000012','Agência portal B');

insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','owner'),
('bbbbbbbb-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012','owner'),
('aaaaaaaa-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000013','editor');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000011','Cliente portal A1'),
('11111111-0000-4000-8000-000000000012','aaaaaaaa-0000-4000-8000-000000000011','Cliente portal A2'),
('22222222-0000-4000-8000-000000000013','bbbbbbbb-0000-4000-8000-000000000012','Cliente portal B');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',true);
select lives_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000014',true)$$,
  'Owner concede acesso à Área do Cliente'
);
select is((select count(*) from client_users where active),1::bigint,'Vínculo ativo é persistido');
select is((select count(*) from audit_logs where action='client_user.granted'),1::bigint,'Concessão é auditada');
select throws_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000016',true)$$,
  '22023',null,'Conta não confirmada não recebe acesso'
);
select throws_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','22222222-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000014',true)$$,
  '22023',null,'Cliente de outra agência não pode ser vinculado'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000013',true);
select throws_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000014',true)$$,
  '42501',null,'Editor não gerencia acessos do cliente'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000012',true);
select throws_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000015',true)$$,
  '42501',null,'Outra agência não gerencia o vínculo'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000014',true);
select is((select count(*) from clients),0::bigint,'Cliente não lê a linha administrativa de clients');
select is((select count(*) from client_users),0::bigint,'Cliente não lê a tabela interna de vínculos');
select is((select count(*) from list_client_portal_clients()),1::bigint,'RPC segura expõe somente o cliente vinculado');
select throws_ok($$select notes from list_client_portal_clients()$$,'42703',null,'DTO do portal não expõe notas internas');
select is((select count(*) from agencies),0::bigint,'Cliente não ganha acesso à administração da agência');
select is((select count(*) from agency_users),0::bigint,'Cliente não lê a equipe da agência');
select is((select count(*) from audit_logs),0::bigint,'Cliente não lê auditoria administrativa');
select results_eq(
  $$with changed as (update clients set name='Ataque' returning id) select count(*)::integer from changed$$,
  array[0],'Cliente autenticado não altera cadastro'
);
select throws_ok(
  $$update client_users set active=false$$,
  '42501',null,'Cliente não revoga ou altera o próprio vínculo diretamente'
);
select throws_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000014',false)$$,
  '42501',null,'Cliente não executa RPC administrativa'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000015',true);
select is((select count(*) from clients),0::bigint,'Usuário sem vínculo não lê nenhum cliente');
select is((select count(*) from client_users),0::bigint,'Usuário sem vínculo não lê vínculos de terceiros');
select is((select count(*) from list_client_portal_clients()),0::bigint,'RPC segura não retorna cliente sem vínculo');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',true);
select lives_ok(
  $$select set_client_user_access('aaaaaaaa-0000-4000-8000-000000000011','11111111-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000014',false)$$,
  'Owner revoga acesso'
);
select is((select count(*) from client_users where active),0::bigint,'Revogação preserva vínculo como inativo');
select is((select count(*) from audit_logs where action='client_user.revoked'),1::bigint,'Revogação é auditada');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000014',true);
select is((select count(*) from list_client_portal_clients()),0::bigint,'Revogação remove o cliente do contexto seguro em nova requisição');
select is((select count(*) from clients),0::bigint,'Revogação não amplia acesso à tabela administrativa');

set local role anon;
select throws_ok($$select * from client_users$$,'42501',null,'Visitante não consulta vínculos da Área do Cliente');

reset role;
select * from finish();
rollback;
