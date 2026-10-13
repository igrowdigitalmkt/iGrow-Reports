begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
  ('c1000000-0000-4000-8000-000000000001','rs-owner@example.test',now()),
  ('c1000000-0000-4000-8000-000000000002','rs-editor@example.test',now()),
  ('c1000000-0000-4000-8000-000000000003','rs-outro@example.test',now());
insert into agencies(id,name) values ('c1aaaaaa-0000-4000-8000-000000000001','Espaço RS'),('c1aaaaaa-0000-4000-8000-000000000002','Outro RS');
insert into agency_users(agency_id,user_id,role) values
  ('c1aaaaaa-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner'),
  ('c1aaaaaa-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','editor'),
  ('c1aaaaaa-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000003','owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select lives_ok($$insert into report_settings(agency_id,pdf_layout,updated_by) values ('c1aaaaaa-0000-4000-8000-000000000001','modern','c1000000-0000-4000-8000-000000000001')$$,'Dono escolhe o layout novo');
select lives_ok($$update report_settings set pdf_layout='classic' where agency_id='c1aaaaaa-0000-4000-8000-000000000001'$$,'Dono volta ao layout clássico');
select throws_ok($$update report_settings set pdf_layout='outro' where agency_id='c1aaaaaa-0000-4000-8000-000000000001'$$,'23514',null,'Layout desconhecido é recusado');
select throws_ok($$insert into report_settings(agency_id,pdf_layout) values ('c1aaaaaa-0000-4000-8000-000000000002','modern')$$,'42501',null,'Dono não configura outra organização');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from report_settings),1,'Editor lê a preferência da organização');
select lives_ok($$update report_settings set pdf_layout='modern'$$,'Editor tenta alterar sem efeito (RLS filtra as linhas)');
reset role;
select is((select pdf_layout from report_settings where agency_id='c1aaaaaa-0000-4000-8000-000000000001'),'classic','Nada foi alterado pelo editor');

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from report_settings),0,'Outra organização não vê a preferência');
reset role;
set local role anon;
select throws_ok($$select count(*) from report_settings$$,'42501',null,'Anônimo não acessa preferências');
reset role;
select * from finish();
rollback;
