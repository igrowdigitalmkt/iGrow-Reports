begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000031','portal-admin-owner@example.test',now()),
('10000000-0000-4000-8000-000000000032','portal-admin-admin@example.test',now()),
('10000000-0000-4000-8000-000000000033','portal-admin-editor@example.test',now()),
('10000000-0000-4000-8000-000000000034','portal-admin-client@example.test',now()),
('10000000-0000-4000-8000-000000000035','portal-admin-unconfirmed@example.test',null),
('10000000-0000-4000-8000-000000000036','portal-admin-other-owner@example.test',now());

insert into agencies(id,name) values
('aaaaaaaa-0000-4000-8000-000000000031','Agência admin portal A'),
('bbbbbbbb-0000-4000-8000-000000000032','Agência admin portal B');

insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031','owner'),
('aaaaaaaa-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000032','admin'),
('aaaaaaaa-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000033','editor'),
('bbbbbbbb-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000036','owner');

insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000031','aaaaaaaa-0000-4000-8000-000000000031','Cliente admin A'),
('22222222-0000-4000-8000-000000000032','bbbbbbbb-0000-4000-8000-000000000032','Cliente admin B');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000031',true);

select is(
  set_client_user_access_by_email(
    'aaaaaaaa-0000-4000-8000-000000000031',
    '11111111-0000-4000-8000-000000000031',
    ' PORTAL-ADMIN-CLIENT@EXAMPLE.TEST ',
    true
  ),
  '10000000-0000-4000-8000-000000000034'::uuid,
  'Owner concede acesso por email normalizado'
);
select is(
  (select count(*) from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031')),
  1::bigint,
  'Owner lista vínculos da agência'
);
select is(
  (select email from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031') limit 1),
  'portal-admin-client@example.test',
  'Listagem administrativa retorna email normalizado'
);
select ok(
  (select active from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031') limit 1),
  'Novo vínculo aparece ativo'
);
select throws_ok(
  $$select set_client_user_access_by_email(
    'aaaaaaaa-0000-4000-8000-000000000031',
    '11111111-0000-4000-8000-000000000031',
    'portal-admin-unconfirmed@example.test',
    true
  )$$,
  '22023',null,'Conta não confirmada não pode ser liberada por email'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000032',true);
select lives_ok(
  $$select set_client_user_access_by_email(
    'aaaaaaaa-0000-4000-8000-000000000031',
    '11111111-0000-4000-8000-000000000031',
    'portal-admin-client@example.test',
    false
  )$$,
  'Administrador revoga acesso por email'
);
select is(
  (select active from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031') limit 1),
  false,
  'Revogação permanece visível como vínculo inativo'
);
select lives_ok(
  $$select set_client_user_access_by_email(
    'aaaaaaaa-0000-4000-8000-000000000031',
    '11111111-0000-4000-8000-000000000031',
    'portal-admin-client@example.test',
    true
  )$$,
  'Administrador reativa acesso por email'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000033',true);
select throws_ok(
  $$select * from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031')$$,
  '42501',null,'Editor não lista acessos do cliente'
);
select throws_ok(
  $$select set_client_user_access_by_email(
    'aaaaaaaa-0000-4000-8000-000000000031',
    '11111111-0000-4000-8000-000000000031',
    'portal-admin-client@example.test',
    false
  )$$,
  '42501',null,'Editor não altera acesso por email'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000036',true);
select throws_ok(
  $$select * from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031')$$,
  '42501',null,'Outra agência não lista acessos'
);

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000034',true);
select throws_ok(
  $$select * from list_agency_client_portal_accesses('aaaaaaaa-0000-4000-8000-000000000031')$$,
  '42501',null,'Usuário da Área do Cliente não consulta listagem administrativa'
);
select is(
  (select count(*) from list_client_portal_clients()),
  1::bigint,
  'Acesso concedido por email funciona no portal autenticado'
);

reset role;
select * from finish();
rollback;
