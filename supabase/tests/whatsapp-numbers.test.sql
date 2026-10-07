begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('a1000000-0000-4000-8000-000000000001','num-owner-a@example.test',now()),
('a1000000-0000-4000-8000-000000000002','num-owner-b@example.test',now());
insert into agencies(id,name) values ('a1aaaaaa-0000-4000-8000-000000000001','Espaço Números A'),('a1bbbbbb-0000-4000-8000-000000000002','Espaço Números B');
insert into agency_users(agency_id,user_id,role) values
('a1aaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner'),
('a1bbbbbb-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','owner');
insert into clients(id,agency_id,name) values ('a1111111-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','Cliente Números');
insert into integrations(id,agency_id,provider) values
('a1333333-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','whatsapp'),
('a1333333-0000-4000-8000-000000000002','a1bbbbbb-0000-4000-8000-000000000002','whatsapp');

select lives_ok($$insert into whatsapp_connections(id,agency_id,integration_id,waba_id,phone_number_id,label)
  values ('a1555555-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','a1333333-0000-4000-8000-000000000001','1100158515497239','991218314063731','Relatórios')$$,'Primeiro número oficial');
select lives_ok($$insert into whatsapp_connections(id,agency_id,integration_id,waba_id,phone_number_id,coexistence)
  values ('a1555555-0000-4000-8000-000000000002','a1aaaaaa-0000-4000-8000-000000000001','a1333333-0000-4000-8000-000000000001','1100158515497239','991218314063732',true)$$,'Segundo número no mesmo espaço');
select throws_ok($$insert into whatsapp_connections(agency_id,integration_id,waba_id,phone_number_id)
  values ('a1bbbbbb-0000-4000-8000-000000000002','a1333333-0000-4000-8000-000000000002','1100158515497239','991218314063731')$$,'23505',null,'O mesmo número não entra em dois espaços');

insert into report_automations(id,agency_id,client_id,name,message_template,sender,whatsapp_connection_id)
  values ('a1444444-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','PDF semanal','Relatório','official','a1555555-0000-4000-8000-000000000001');
select is((select sender from report_automations where id='a1444444-0000-4000-8000-000000000001'),'official','Agendamento guarda o número de envio');
insert into report_automations(id,agency_id,client_id,name,message_template)
  values ('a1444444-0000-4000-8000-000000000002','a1aaaaaa-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','Texto','Olá');
select is((select sender from report_automations where id='a1444444-0000-4000-8000-000000000002'),'qr','Agendamento sem escolha usa o QR Code');
select throws_ok($$update report_automations set sender='sms' where id='a1444444-0000-4000-8000-000000000002'$$,'23514',null,'Remetente desconhecido é recusado');
select throws_ok($$insert into report_automations(agency_id,client_id,name,message_template,sender,whatsapp_connection_id)
  values ('a1aaaaaa-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','Outro espaço','Olá','official','a1555555-0000-4000-8000-000000000099')$$,'23503',null,'Número inexistente ou de outro espaço é recusado');

insert into report_automation_runs(id,agency_id,automation_id,scheduled_for)
  values ('a1666666-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','a1444444-0000-4000-8000-000000000001',now());
insert into client_recipients(id,agency_id,client_id,name,phone) values
('a1222222-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','Pessoa','+5511988887777');
select lives_ok($$insert into report_deliveries(agency_id,client_id,recipient_id,template_name,template_language,automation_run_id,whatsapp_connection_id)
  values ('a1aaaaaa-0000-4000-8000-000000000001','a1111111-0000-4000-8000-000000000001','a1222222-0000-4000-8000-000000000001','relatorio_desempenho','pt_BR','a1666666-0000-4000-8000-000000000001','a1555555-0000-4000-8000-000000000001')$$,'Envio de agendamento sem PDF salvo é registrado');

delete from whatsapp_connections where id='a1555555-0000-4000-8000-000000000001';
select is((select whatsapp_connection_id from report_automations where id='a1444444-0000-4000-8000-000000000001'),null,'Remover o número deixa o agendamento sem remetente');
select is((select sender from report_automations where id='a1444444-0000-4000-8000-000000000001'),'official','O agendamento continua marcado como oficial');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from whatsapp_connections),0,'Outro espaço não vê os números');
select throws_ok($$select public.delete_integration_secret('a1aaaaaa-0000-4000-8000-000000000001','a1333333-0000-4000-8000-000000000001','whatsapp:access_token')$$,'42501',null,'Só o servidor apaga credenciais');
reset role;
select * from finish();
rollback;
