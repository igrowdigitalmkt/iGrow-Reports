begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('bc000000-0000-4000-8000-000000000001','safe-owner@example.test',now()),
('bc000000-0000-4000-8000-000000000002','safe-viewer@example.test',now());
insert into agencies(id,name) values ('bcaaaaaa-0000-4000-8000-000000000001','Segurança WhatsApp');
insert into agency_users(agency_id,user_id,role) values
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','owner'),
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','viewer');
insert into whatsapp_conversations(id,agency_id,channel,channel_key,remote_id) values
('bc111111-0000-4000-8000-000000000001','bcaaaaaa-0000-4000-8000-000000000001','qr','qr','5586999990000');
insert into whatsapp_messages(id,agency_id,conversation_id,external_id,direction,sent_at) values
('bc222222-0000-4000-8000-000000000001','bcaaaaaa-0000-4000-8000-000000000001','bc111111-0000-4000-8000-000000000001','SAFE-IN','in',now()),
('bc222222-0000-4000-8000-000000000002','bcaaaaaa-0000-4000-8000-000000000001','bc111111-0000-4000-8000-000000000001','SAFE-OUT','out',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into whatsapp_message_user_actions(agency_id,user_id,message_id,hidden_at) values
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bc222222-0000-4000-8000-000000000001',now())$$,
'42501','new row violates row-level security policy "whatsapp_message_user_actions_sent_only" for table "whatsapp_message_user_actions"','Nem proprietário oculta mensagem recebida por INSERT direto');
select lives_ok($$insert into whatsapp_message_user_actions(agency_id,user_id,message_id,pinned_at) values
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bc222222-0000-4000-8000-000000000001',now())$$,'Fixar mensagem recebida continua permitido');
select throws_ok($$update whatsapp_message_user_actions set hidden_at=now() where message_id='bc222222-0000-4000-8000-000000000001'$$,
'42501','new row violates row-level security policy "whatsapp_message_user_actions_sent_only" for table "whatsapp_message_user_actions"','UPDATE direto não contorna a proteção de recebidas');
select lives_ok($$insert into whatsapp_message_user_actions(agency_id,user_id,message_id,hidden_at) values
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000001','bc222222-0000-4000-8000-000000000002',now())$$,'Mensagem enviada pode ser ocultada pelo proprietário');
select is((select hidden_at is null from whatsapp_message_user_actions where message_id='bc222222-0000-4000-8000-000000000001'),true,'Mensagem recebida permanece visível');
select is(has_table_privilege('authenticated','whatsapp_messages','DELETE'),false,'Cliente não pode excluir linhas de mensagens');
select is(has_table_privilege('authenticated','whatsapp_conversations','DELETE'),false,'Cliente não pode excluir conversas');
select throws_ok($$delete from whatsapp_messages where id='bc222222-0000-4000-8000-000000000001'$$,
'42501','permission denied for table whatsapp_messages','DELETE de mensagem recebida é negado');
select throws_ok($$delete from whatsapp_conversations where id='bc111111-0000-4000-8000-000000000001'$$,
'42501','permission denied for table whatsapp_conversations','DELETE de conversa é negado');
select set_config('request.jwt.claim.sub','bc000000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into whatsapp_message_user_actions(agency_id,user_id,message_id,hidden_at) values
('bcaaaaaa-0000-4000-8000-000000000001','bc000000-0000-4000-8000-000000000002','bc222222-0000-4000-8000-000000000002',now())$$,
'42501','new row violates row-level security policy "whatsapp_message_user_actions_sent_only" for table "whatsapp_message_user_actions"','Leitor não pode apagar nem mensagem enviada');
reset role;
select is((select count(*) from whatsapp_messages where conversation_id='bc111111-0000-4000-8000-000000000001'),2::bigint,'Todas as mensagens da fixture são preservadas');
select * from finish();
rollback;
