begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('70000000-0000-4000-8000-000000000001','auto-owner-a@example.test',now()),
('70000000-0000-4000-8000-000000000002','auto-viewer-a@example.test',now()),
('70000000-0000-4000-8000-000000000003','auto-owner-b@example.test',now());
insert into agencies(id,name) values ('7aaaaaaa-0000-4000-8000-000000000001','Agência Auto A'),('7bbbbbbb-0000-4000-8000-000000000002','Agência Auto B');
insert into agency_users(agency_id,user_id,role) values
('7aaaaaaa-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','owner'),
('7aaaaaaa-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','viewer'),
('7bbbbbbb-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003','owner');
insert into clients(id,agency_id,name) values ('71111111-0000-4000-8000-000000000001','7aaaaaaa-0000-4000-8000-000000000001','Cliente Auto A');
insert into client_recipients(id,agency_id,client_id,name,phone) values
('72222222-0000-4000-8000-000000000001','7aaaaaaa-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','Pessoa','+5511988887777');

-- WhatsApp connection keeps a real template name (regression: {1,512} broke every save).
insert into integrations(id,agency_id,provider) values ('73333333-0000-4000-8000-000000000001','7aaaaaaa-0000-4000-8000-000000000001','whatsapp');
select lives_ok($$insert into whatsapp_connections(agency_id,integration_id,waba_id,phone_number_id,template_name,template_language)
  values ('7aaaaaaa-0000-4000-8000-000000000001','73333333-0000-4000-8000-000000000001','1100158515497239','991218314063731','relatorio_desempenho','pt_BR')$$,'Conexão do WhatsApp grava o nome da mensagem modelo');
select throws_ok($$update whatsapp_connections set template_name='Relatorio Inválido' where agency_id='7aaaaaaa-0000-4000-8000-000000000001'$$,'23514',null,'Nome de modelo fora do padrão é recusado');

set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
select lives_ok($$insert into report_automations(id,agency_id,client_id,name,message_template,period_key,frequency,weekdays,send_time)
  values ('74444444-0000-4000-8000-000000000001','7aaaaaaa-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','Semanal','Olá! Investimento: {{investimento}}','last_7d','weekly','{1,4}','08:30')$$,'Dono cria automação');
select lives_ok($$insert into report_automation_targets(agency_id,automation_id,client_id,recipient_id)
  values ('7aaaaaaa-0000-4000-8000-000000000001','74444444-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','72222222-0000-4000-8000-000000000001')$$,'Destinatário do cliente vira alvo');
select lives_ok($$insert into report_automation_targets(agency_id,automation_id,client_id,group_id,group_name)
  values ('7aaaaaaa-0000-4000-8000-000000000001','74444444-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','120363000000000000@g.us','Grupo do cliente')$$,'Grupo do WhatsApp vira alvo');
select throws_ok($$insert into report_automation_targets(agency_id,automation_id,client_id)
  values ('7aaaaaaa-0000-4000-8000-000000000001','74444444-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001')$$,'23514',null,'Alvo precisa ser destinatário ou grupo');
select throws_ok($$insert into report_automations(agency_id,client_id,name,message_template,weekdays)
  values ('7aaaaaaa-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','Inválida','Texto','{7}')$$,'23514',null,'Dia da semana fora de 0 a 6 é recusado');
select throws_ok($$insert into report_automation_runs(agency_id,automation_id,scheduled_for) values ('7aaaaaaa-0000-4000-8000-000000000001','74444444-0000-4000-8000-000000000001',now())$$,'42501',null,'Usuário não grava execuções');

select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from report_automations),1,'Leitor vê as automações do espaço');
select throws_ok($$insert into report_automations(agency_id,client_id,name,message_template) values ('7aaaaaaa-0000-4000-8000-000000000001','71111111-0000-4000-8000-000000000001','Leitor','Texto')$$,'42501',null,'Leitor não cria automação');

select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from report_automations),0,'Outra agência não vê automações');
select is((select count(*)::int from report_automation_targets),0,'Outra agência não vê alvos');
reset role;
select * from finish();
rollback;
