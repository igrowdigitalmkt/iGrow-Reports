begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('b0000000-0000-4000-8000-000000000001','msg-owner@example.test',now()),
('b0000000-0000-4000-8000-000000000002','msg-other@example.test',now());
insert into agencies(id,name) values ('baaaaaaa-0000-4000-8000-000000000001','Agência Msg A'),('bbbbbbbb-0000-4000-8000-000000000002','Agência Msg B');
insert into agency_users(agency_id,user_id,role) values
('baaaaaaa-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','owner'),
('bbbbbbbb-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','owner');
insert into clients(id,agency_id,name) values ('b1111111-0000-4000-8000-000000000001','baaaaaaa-0000-4000-8000-000000000001','Cliente Msg');
insert into report_automations(id,agency_id,client_id,name,message_template) values ('b2222222-0000-4000-8000-000000000001','baaaaaaa-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000001','Diário','Olá');
insert into report_automation_runs(id,agency_id,automation_id,scheduled_for,status) values ('b3333333-0000-4000-8000-000000000001','baaaaaaa-0000-4000-8000-000000000001','b2222222-0000-4000-8000-000000000001',now(),'sent');

select lives_ok($$insert into automation_messages(agency_id,run_id,automation_id,client_id,destination_label,message_id) values ('baaaaaaa-0000-4000-8000-000000000001','b3333333-0000-4000-8000-000000000001','b2222222-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000001','Maria','3EB0ABC')$$,'Servidor registra a mensagem enviada');
select throws_ok($$insert into automation_messages(agency_id,run_id,automation_id,client_id,destination_label,message_id) values ('baaaaaaa-0000-4000-8000-000000000001','b3333333-0000-4000-8000-000000000001','b2222222-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000001','Maria','3EB0ABC')$$,'23505',null,'Mesmo identificador do WhatsApp não duplica');
select throws_ok($$update automation_messages set status='lida' where message_id='3EB0ABC'$$,'23514',null,'Situação desconhecida é recusada');

set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from automation_messages),1,'Agência vê as próprias mensagens');
select throws_ok($$update automation_messages set status='read' where message_id='3EB0ABC'$$,'42501',null,'Usuário não altera confirmações');
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from automation_messages),0,'Outra agência não vê mensagens');
reset role;
select * from finish();
rollback;
