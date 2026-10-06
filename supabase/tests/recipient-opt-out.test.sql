begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values ('80000000-0000-4000-8000-000000000001','optout-owner@example.test',now());
insert into agencies(id,name) values ('8aaaaaaa-0000-4000-8000-000000000001','Agência Opt A'),('8bbbbbbb-0000-4000-8000-000000000002','Agência Opt B');
insert into agency_users(agency_id,user_id,role) values ('8aaaaaaa-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','owner');
insert into clients(id,agency_id,name) values
('81111111-0000-4000-8000-000000000001','8aaaaaaa-0000-4000-8000-000000000001','Cliente 1'),
('81111111-0000-4000-8000-000000000002','8aaaaaaa-0000-4000-8000-000000000001','Cliente 2'),
('81111111-0000-4000-8000-000000000003','8bbbbbbb-0000-4000-8000-000000000002','Cliente B');
insert into client_recipients(id,agency_id,client_id,name,phone,consent_status,consent_at,consent_source) values
('82222222-0000-4000-8000-000000000001','8aaaaaaa-0000-4000-8000-000000000001','81111111-0000-4000-8000-000000000001','Maria','+5586994037823','granted',now()-interval '1 day','Formulário'),
('82222222-0000-4000-8000-000000000002','8aaaaaaa-0000-4000-8000-000000000001','81111111-0000-4000-8000-000000000002','Maria','+5586994037823','granted',now()-interval '1 day','Formulário'),
('82222222-0000-4000-8000-000000000003','8bbbbbbb-0000-4000-8000-000000000002','81111111-0000-4000-8000-000000000003','Maria','+5586994037823','granted',now()-interval '1 day','Formulário');

set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.service_recipient_opt_out('8aaaaaaa-0000-4000-8000-000000000001','+5586994037823','Resposta PARAR')$$,'42501',null,'Usuário não executa descadastro de servidor');
reset role;

set local role service_role;
select is(public.service_recipient_opt_out('8aaaaaaa-0000-4000-8000-000000000001','+5586994037823','Resposta PARAR no WhatsApp'),2,'Descadastra o telefone em todos os clientes da agência');
select is(public.service_recipient_opt_out('8aaaaaaa-0000-4000-8000-000000000001','+5586994037823','Resposta PARAR no WhatsApp'),0,'Repetir não duplica registro');
select throws_ok($$select public.service_recipient_opt_out('8aaaaaaa-0000-4000-8000-000000000001','86994037823','x x')$$,'22023',null,'Telefone fora do padrão é recusado');
reset role;
select is((select count(*)::int from client_recipients where agency_id='8aaaaaaa-0000-4000-8000-000000000001' and consent_status='revoked' and unsubscribed_at is not null),2,'Destinatários ficam revogados');
select is((select consent_status from client_recipients where id='82222222-0000-4000-8000-000000000003'),'granted','Outra agência não é afetada');
select is((select count(*)::int from recipient_consent_events where agency_id='8aaaaaaa-0000-4000-8000-000000000001' and event_type='revoked'),2,'Cada descadastro fica no histórico');
select * from finish();
rollback;
