begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('ba000000-0000-4000-8000-000000000001','list-owner@example.test',now());
insert into agencies(id,name) values ('baaaaaaa-0000-4000-8000-000000000001','Teste listas');
insert into agency_users(agency_id,user_id,role) values ('baaaaaaa-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','owner');
set local role service_role;
select record_whatsapp_message('baaaaaaa-0000-4000-8000-000000000001',null,'558699990001',false,'Contato fictício','LIST-TEST','in','text','Teste',null,null,null,null,'2026-10-10 10:00+00');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',true);
insert into whatsapp_custom_lists(id,agency_id,user_id,channel_key,name,color) values
('ba111111-0000-4000-8000-000000000001','baaaaaaa-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','qr','Teste','#a3297b');
select is(has_table_privilege('authenticated','whatsapp_custom_list_members','UPDATE'),false,'Vínculos não concedem UPDATE');
select throws_ok($$insert into whatsapp_custom_list_members(agency_id,user_id,list_id,conversation_id)
  select 'baaaaaaa-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','ba111111-0000-4000-8000-000000000001',id
  from whatsapp_conversations where remote_id='558699990001'
  on conflict(list_id,conversation_id) do update set user_id=excluded.user_id$$,
  '42501','permission denied for table whatsapp_custom_list_members','Upsert padrão reproduz a falha de permissão');
select lives_ok($$insert into whatsapp_custom_list_members(agency_id,user_id,list_id,conversation_id)
  select 'baaaaaaa-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','ba111111-0000-4000-8000-000000000001',id
  from whatsapp_conversations where remote_id='558699990001'
  on conflict(list_id,conversation_id) do nothing$$,'Inclui vínculo sem UPDATE');
select lives_ok($$insert into whatsapp_custom_list_members(agency_id,user_id,list_id,conversation_id)
  select 'baaaaaaa-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001','ba111111-0000-4000-8000-000000000001',id
  from whatsapp_conversations where remote_id='558699990001'
  on conflict(list_id,conversation_id) do nothing$$,'Repetição é idempotente');
select is((select count(*) from whatsapp_custom_list_members where list_id='ba111111-0000-4000-8000-000000000001'),1::bigint,'Há apenas um vínculo');
select lives_ok($$delete from whatsapp_custom_list_members where list_id='ba111111-0000-4000-8000-000000000001'$$,'Desmarca pela exclusão autorizada');
select is((select count(*) from whatsapp_custom_list_members where list_id='ba111111-0000-4000-8000-000000000001'),0::bigint,'Vínculo removido');
reset role;
select * from finish();
rollback;
