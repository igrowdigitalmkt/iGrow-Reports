begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000051','invite-owner@example.test',now()),
('10000000-0000-4000-8000-000000000052','invite-editor@example.test',now()),
('10000000-0000-4000-8000-000000000053','invite-new@example.test',null),
('10000000-0000-4000-8000-000000000054','invite-existing@example.test',now()),
('10000000-0000-4000-8000-000000000055','invite-other-owner@example.test',now()),
('10000000-0000-4000-8000-000000000056','invite-late@example.test',now());

insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000051','Agência convites A'),
('bbbbbbbb-0000-4000-8000-000000000052','Agência convites B');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051','owner'),
('aaaaaaaa-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000052','editor'),
('bbbbbbbb-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000055','owner');
insert into clients(id,agency_id,name,archived_at) values
('11111111-0000-4000-8000-000000000051','aaaaaaaa-0000-4000-8000-000000000051','Cliente convites A',null),
('11111111-0000-4000-8000-000000000053','aaaaaaaa-0000-4000-8000-000000000051','Cliente arquivado',now()),
('22222222-0000-4000-8000-000000000052','bbbbbbbb-0000-4000-8000-000000000052','Cliente convites B',null);

set local role authenticated;

-- Owner invites a new address and an existing confirmed account.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select is(
  (select existing_account from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051',' Invite-New@Example.test ')),
  false,'Convite para e-mail sem conta confirmada'
);
select is(
  (select existing_account from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','invite-existing@example.test')),
  true,'Convite reconhece conta confirmada existente'
);
select is(
  (select count(*) from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','invite-new@example.test')),
  1::bigint,'Reenvio substitui o convite pendente'
);
select is(
  (select count(*) from list_client_portal_invitations('aaaaaaaa-0000-4000-8000-000000000051')),
  2::bigint,'Somente um convite pendente por e-mail'
);
select is(
  (select email from list_client_portal_invitations('aaaaaaaa-0000-4000-8000-000000000051') order by email desc limit 1),
  'invite-new@example.test','E-mail do convite é normalizado'
);
select throws_ok(
  $$select * from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000053','x@example.test')$$,
  '22023',null,'Cliente arquivado não recebe convite'
);
select throws_ok(
  $$select * from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','22222222-0000-4000-8000-000000000052','x@example.test')$$,
  '22023',null,'Cliente de outra agência não recebe convite'
);
select throws_ok(
  $$select * from client_portal_invitations$$,
  '42501',null,'Tabela de convites não é exposta diretamente'
);

-- Editors and other agencies cannot invite, list or revoke.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000052',true);
select throws_ok(
  $$select * from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','x@example.test')$$,
  '42501',null,'Editor não convida'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000055',true);
select throws_ok(
  $$select * from list_client_portal_invitations('aaaaaaaa-0000-4000-8000-000000000051')$$,
  '42501',null,'Outra agência não lista convites'
);

-- An unconfirmed account accepts nothing; once confirmed it accepts its invitation.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000053',true);
select is((select count(*) from accept_client_portal_invitations()),0::bigint,'Conta sem e-mail confirmado não aceita convite');
reset role;
update auth.users set email_confirmed_at = now() where id = '10000000-0000-4000-8000-000000000053';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000053',true);
select is(
  (select array_agg(c) from accept_client_portal_invitations() c),
  array['11111111-0000-4000-8000-000000000051'::uuid],'Conta criada pelo convite recebe o acesso'
);
select is((select count(*) from list_client_portal_clients()),1::bigint,'Convite aceito libera a Área do Cliente');
select is((select count(*) from accept_client_portal_invitations()),0::bigint,'Convite aceito não é reaplicado');

-- Existing account accepts, and the owner then sees no pending invitations for it.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000054',true);
select is((select count(*) from accept_client_portal_invitations()),1::bigint,'Conta existente aceita pelo link');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select is((select count(*) from list_client_portal_invitations('aaaaaaaa-0000-4000-8000-000000000051')),0::bigint,'Convites aceitos saem da lista de pendentes');
select is(
  (select already_active from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','invite-existing@example.test')),
  true,'Acesso já ativo não gera novo convite'
);

-- Revoked and expired invitations are not accepted.
select is(
  (select count(*) from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','invite-late@example.test')),
  1::bigint,'Convite para revogação'
);
select lives_ok(
  $$select revoke_client_portal_invitation('aaaaaaaa-0000-4000-8000-000000000051',(select id from list_client_portal_invitations('aaaaaaaa-0000-4000-8000-000000000051') limit 1))$$,
  'Owner revoga convite pendente'
);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000056',true);
select is((select count(*) from accept_client_portal_invitations()),0::bigint,'Convite revogado não é aceito');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000051',true);
select is(
  (select count(*) from invite_client_portal_user('aaaaaaaa-0000-4000-8000-000000000051','11111111-0000-4000-8000-000000000051','invite-late@example.test')),
  1::bigint,'Novo convite após revogação'
);
reset role;
update client_portal_invitations set created_at = now() - interval '9 days', expires_at = now() - interval '2 days'
where email = 'invite-late@example.test' and revoked_at is null;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000056',true);
select is((select count(*) from accept_client_portal_invitations()),0::bigint,'Convite expirado não é aceito');

reset role;
select is(
  (select count(*) from audit_logs where agency_id = 'aaaaaaaa-0000-4000-8000-000000000051' and action = 'client_user.granted'),
  2::bigint,'Aceites ficam auditados'
);
select is(
  (select created_by from client_users where user_id = '10000000-0000-4000-8000-000000000053'),
  '10000000-0000-4000-8000-000000000051'::uuid,'Vínculo registra quem convidou'
);

select * from finish();
rollback;
