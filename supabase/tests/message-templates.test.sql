begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('90000000-0000-4000-8000-000000000001','tpl-editor@example.test',now()),
('90000000-0000-4000-8000-000000000002','tpl-viewer@example.test',now()),
('90000000-0000-4000-8000-000000000003','tpl-other@example.test',now());
insert into agencies(id,name) values ('9aaaaaaa-0000-4000-8000-000000000001','Agência Tpl A'),('9bbbbbbb-0000-4000-8000-000000000002','Agência Tpl B');
insert into agency_users(agency_id,user_id,role) values
('9aaaaaaa-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','editor'),
('9aaaaaaa-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','viewer'),
('9bbbbbbb-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000003','owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select lives_ok($$insert into message_templates(agency_id,name,segment,body) values ('9aaaaaaa-0000-4000-8000-000000000001','Vendas da loja','vendas','Olá, {{nome}}! Compras: {{compras}}')$$,'Editor salva template');
select throws_ok($$insert into message_templates(agency_id,name,segment,body) values ('9aaaaaaa-0000-4000-8000-000000000001','Vendas da loja','vendas','Outro texto')$$,'23505',null,'Nome repetido no mesmo espaço é recusado');
select throws_ok($$insert into message_templates(agency_id,name,segment,body) values ('9aaaaaaa-0000-4000-8000-000000000001','Outro','astrologia','Texto')$$,'23514',null,'Segmento desconhecido é recusado');
select lives_ok($$update message_templates set body='Novo texto', updated_at=now() where name='Vendas da loja'$$,'Editor atualiza template');

select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from message_templates),1,'Leitor vê os templates do espaço');
select throws_ok($$insert into message_templates(agency_id,name,body) values ('9aaaaaaa-0000-4000-8000-000000000001','Leitor','Texto')$$,'42501',null,'Leitor não cria template');

select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from message_templates),0,'Outra agência não vê templates');
reset role;
select is((select column_default from information_schema.columns where table_name='report_automation_runs' and column_name='trigger'),'''schedule''::text','Execução sem origem informada conta como agendada');
select * from finish();
rollback;
