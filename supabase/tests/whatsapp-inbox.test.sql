begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('b1000000-0000-4000-8000-000000000001','inbox-owner@example.test',now()),
('b1000000-0000-4000-8000-000000000002','inbox-editor@example.test',now()),
('b1000000-0000-4000-8000-000000000003','inbox-limited@example.test',now()),
('b1000000-0000-4000-8000-000000000004','inbox-other@example.test',now());
insert into agencies(id,name) values ('b1aaaaaa-0000-4000-8000-000000000001','Espaço Caixa A'),('b1bbbbbb-0000-4000-8000-000000000002','Espaço Caixa B');
insert into agency_users(agency_id,user_id,role) values
('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner'),
('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','editor'),
('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','editor'),
('b1bbbbbb-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','owner');
insert into agency_member_permissions(agency_id,user_id,modules) values
('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','{clientes}');
select lives_ok($$insert into agency_member_permissions(agency_id,user_id,modules) values ('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','{whatsapp,clientes}')$$,'WhatsApp é uma área liberável na equipe');
insert into clients(id,agency_id,name) values ('b1111111-0000-4000-8000-000000000001','b1aaaaaa-0000-4000-8000-000000000001','Colégio Crescer');
insert into client_recipients(agency_id,client_id,name,phone) values ('b1aaaaaa-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000001','Maria','+5586999990000');

set local role service_role;
select results_eq($$select inserted, needs_title from record_whatsapp_message('b1aaaaaa-0000-4000-8000-000000000001',null,'558699990000',false,'Maria Souza','MSG1','in','text','Oi, recebi o relatório',null,null,null,null,'2026-10-07 10:00+00')$$,
  $$values (true,false)$$,'Mensagem recebida cria a conversa com o nome do contato');
select results_eq($$select inserted from record_whatsapp_message('b1aaaaaa-0000-4000-8000-000000000001',null,'558699990000',false,null,'MSG1','in','text','Oi, recebi o relatório',null,null,null,null,'2026-10-07 10:00+00')$$,
  $$values (false)$$,'A mesma mensagem não é gravada duas vezes');
select is((select unread_count from whatsapp_conversations where remote_id='558699990000'),1,'Conta uma não lida');
select is((select client_id from whatsapp_conversations where remote_id='558699990000'),'b1111111-0000-4000-8000-000000000001'::uuid,'Número sem o nono dígito é ligado ao cliente');
select lives_ok($$select record_whatsapp_message('b1aaaaaa-0000-4000-8000-000000000001',null,'558699990000',false,null,'MSG2','out','document',null,'Relatorio.pdf','application/pdf',null,'sent','2026-10-07 10:05+00')$$,'Envio da plataforma entra na conversa');
select is((select last_message_preview||'|'||last_message_direction||'|'||last_message_status from whatsapp_conversations where remote_id='558699990000'),'Relatorio.pdf|out|sent','Resumo mostra a última mensagem');
select is((select update_whatsapp_message_status('b1aaaaaa-0000-4000-8000-000000000001','MSG2','read')),1,'Lida atualiza a mensagem');
select is((select update_whatsapp_message_status('b1aaaaaa-0000-4000-8000-000000000001','MSG2','delivered')),0,'Status não volta de lida para entregue');
select is((select last_message_status from whatsapp_conversations where remote_id='558699990000'),'read','Lista mostra a confirmação de leitura');
select results_eq($$select needs_title from record_whatsapp_message('b1aaaaaa-0000-4000-8000-000000000001',null,'120363000000000001@g.us',true,null,'MSG3','in','text','Bom dia','',null,'João',null,'2026-10-07 09:00+00')$$,
  $$values (true)$$,'Grupo novo pede o nome do grupo');
select lives_ok($$select set_whatsapp_conversation_title((select id from whatsapp_conversations where is_group),'Diretoria')$$,'Servidor grava o nome do grupo');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from whatsapp_conversations),2,'Editor com a área WhatsApp vê as conversas');
select is((select count(*)::int from whatsapp_messages),3,'E as mensagens');
select lives_ok($$select mark_whatsapp_conversation_read((select id from whatsapp_conversations where remote_id='558699990000'))$$,'Abre a conversa e marca como lida');
select throws_ok($$update whatsapp_conversations set unread_count=0$$,'42501',null,'Não altera conversas diretamente');
select throws_ok($$select record_whatsapp_message('b1aaaaaa-0000-4000-8000-000000000001',null,'1',false,null,'X','in','text','x',null,null,null,null,now())$$,'42501',null,'Não grava mensagens');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from whatsapp_conversations),0,'Membro sem a área WhatsApp não vê conversas');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from whatsapp_messages),0,'Outro espaço não vê mensagens');
reset role;
select is((select unread_count from whatsapp_conversations where remote_id='558699990000'),0,'Conversa ficou lida');
select * from finish();
rollback;
