begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000001','recipient-owner-a@example.test',now()),
('10000000-0000-4000-8000-000000000002','recipient-owner-b@example.test',now()),
('10000000-0000-4000-8000-000000000003','recipient-viewer@example.test',now());
insert into agencies(id,name) values ('aaaaaaaa-0000-4000-8000-000000000001','Agência A'),('bbbbbbbb-0000-4000-8000-000000000002','Agência B');
insert into agency_users(agency_id,user_id,role) values
('aaaaaaaa-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
('bbbbbbbb-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
('aaaaaaaa-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','viewer');
insert into clients(id,agency_id,name) values
('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Cliente A'),
('22222222-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','Cliente B');
create temp table target(id uuid);
grant all on target to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into target select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',null,'Pessoa fictícia','+5511999999999',true);
select is((select consent_status from client_recipients where id=(select id from target)),'pending','Cadastro não concede autorização');
select throws_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',null,'Duplicado','+5511999999999',true)$$,'23505',null,'Telefone duplicado no cliente é rejeitado');
select throws_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',null,'Inválido','11999999999',true)$$,'22023',null,'Telefone sem prefixo internacional é rejeitado');
select throws_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002',null,'Outra agência','+5511999999998',true)$$,'22023',null,'RPC rejeita cliente de outra agência');
select throws_ok($$update client_recipients set consent_status='granted'$$,'42501',null,'Consentimento não pode ser forjado via UPDATE direto');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'Formulário',now()+interval '1 day')$$,'22023',null,'Autorização futura é rejeitada');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'',now())$$,'22023',null,'Autorização exige origem');
select lives_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'Formulário teste',now()-interval '1 minute')$$,'Autorização explícita é registrada');
select is((select consent_status from client_recipients where id=(select id from target)),'granted','Destinatário autorizado');
select lives_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',false,'Solicitação de parada',null)$$,'Descadastro explícito é registrado');
select is((select consent_status from client_recipients where id=(select id from target)),'revoked','Descadastro revoga autorização');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'Evidência antiga',now()-interval '1 minute')$$,'22023',null,'Evidência anterior ao descadastro não reautoriza');
select lives_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'Pessoa fictícia','+5511999999999',false)$$,'Destinatário pode ser desativado');
select lives_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'Pessoa fictícia','+5511999999999',true)$$,'Destinatário pode ser reativado');
select is((select consent_status from client_recipients where id=(select id from target)),'revoked','Reativação não restaura autorização');
select lives_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'Pessoa fictícia','+5511999999998',true)$$,'Telefone pode ser alterado');
select is((select consent_status from client_recipients where id=(select id from target)),'pending','Telefone alterado exige nova autorização');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'Formulário antigo',now())$$,'22023',null,'Formulário aberto antes da troca de telefone é rejeitado');
select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'Pessoa fictícia','+5511999999999',true);
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',true,'Evidência anterior',now()-interval '1 minute')$$,'22023',null,'Retornar ao telefone antigo não apaga seu descadastro');
select throws_ok($$delete from recipient_consent_events$$,'42501',null,'Histórico não pode ser apagado pelo usuário');
select throws_ok($$insert into recipient_consent_events(agency_id,client_id,recipient_id,event_type,phone,source,occurred_at) values ('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'granted','+5511999999999','Forjado',now())$$,'42501',null,'Histórico não pode ser forjado pelo usuário');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select is((select count(*) from client_recipients),1::bigint,'Leitor consulta destinatários próprios');
select throws_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'Pessoa','+5511999999999',false)$$,'42501',null,'Leitor não altera destinatários');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',false,'Sem permissão',null)$$,'42501',null,'Leitor não altera consentimento');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select is((select count(*) from client_recipients),0::bigint,'Agência B não lê destinatários da A');
select is((select count(*) from recipient_consent_events),0::bigint,'Agência B não lê histórico da A');
select throws_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',false,'Outra agência',null)$$,'42501',null,'Outra agência não revoga consentimento');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
update clients set archived_at=now() where id='11111111-0000-4000-8000-000000000001';
select throws_ok($$select save_client_recipient('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',null,'Pessoa','+5511999999997',true)$$,'22023',null,'Cliente arquivado não recebe novo destinatário');
select lives_ok($$select set_recipient_consent('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',(select id from target),'+5511999999999',false,'Solicitação após arquivamento',null)$$,'Descadastro continua disponível para cliente arquivado');
set local role anon;
select throws_ok($$select * from client_recipients$$,'42501',null,'Visitante não consulta destinatários');
reset role;
select * from finish();
rollback;
