begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('c0000000-0000-4000-8000-000000000001','dono@example.test',now(),'{"full_name":"Dona Ana"}'),
('c0000000-0000-4000-8000-000000000002','editor@example.test',now(),'{}'),
('c0000000-0000-4000-8000-000000000003','fora@example.test',now(),'{}');
insert into agencies(id,name) values ('caaaaaaa-0000-4000-8000-000000000001','Agência Equipe');
insert into agency_users(agency_id,user_id,role) values
('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','owner'),
('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','editor');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.list_agency_members('caaaaaaa-0000-4000-8000-000000000001')),2,'Proprietário lista a equipe');
select is((select full_name from public.list_agency_members('caaaaaaa-0000-4000-8000-000000000001') where role='owner'),'Dona Ana','Lista traz o nome');
select lives_ok($$select public.set_agency_member_modules('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',array['clientes','relatorios'])$$,'Proprietário limita módulos do editor');
select throws_ok($$select public.set_agency_member_modules('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',array['clientes'])$$,'22023',null,'Proprietário não pode ser limitado');
select throws_ok($$select public.set_agency_member_modules('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',array['financeiro'])$$,'23514',null,'Módulo desconhecido é recusado');
select lives_ok($$select * from public.issue_agency_invitation('caaaaaaa-0000-4000-8000-000000000001','novo@example.test','viewer')$$,'Proprietário convida');
select is((select count(*)::int from public.list_agency_invitations('caaaaaaa-0000-4000-8000-000000000001')),1,'Convite pendente aparece na lista');

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
select is((select modules from agency_member_permissions where user_id='c0000000-0000-4000-8000-000000000002'),array['clientes','relatorios'],'Editor lê as próprias permissões');
select throws_ok($$select public.set_agency_member_modules('caaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',null)$$,'42501',null,'Editor não altera permissões');
select throws_ok($$select * from public.list_agency_invitations('caaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Editor não lista convites');

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.list_agency_members('caaaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Quem não é da agência não lista a equipe');
select is(public.accept_pending_agency_invitations(),0,'Sem convite para o e-mail, nada muda');
reset role;
insert into auth.users(id,email,email_confirmed_at) values ('c0000000-0000-4000-8000-000000000004','novo@example.test',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true);
select is(public.accept_pending_agency_invitations(),1,'Convidado entra na equipe ao acessar com o e-mail confirmado');
select is((select count(*)::int from agency_users where user_id='c0000000-0000-4000-8000-000000000004'),1,'Convidado vira membro com o papel do convite');
select is(public.accept_pending_agency_invitations(),0,'Convite não é aceito duas vezes');
reset role;
select * from finish();
rollback;
