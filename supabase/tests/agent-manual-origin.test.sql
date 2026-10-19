begin;
set local search_path=public,extensions;
select no_plan();

-- Dados sinteticos; transacao sempre revertida, nunca Meta real.
insert into auth.users(id,email) values ('f1000000-0000-4000-8000-000000000001','manual-owner@example.test');
insert into agencies(id,name) values ('f2000000-0000-4000-8000-000000000001','Manual A');
insert into agency_users(agency_id,user_id,role)
 values ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','owner');
insert into clients(id,agency_id,name)
 values('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Cliente manual ficticio');
insert into integrations(id,agency_id,provider)
 values('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','meta');
insert into meta_connections(id,agency_id,integration_id,scopes)
 values('f5000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',array['ads_read','ads_management']);
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
 values('f6000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','act_888','Teste manual','BRL','America/Sao_Paulo','100002');
insert into client_ad_accounts(agency_id,client_id,ad_account_id)
 values('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001');

-- IA continua exigindo delegacao.
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale)
 values('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',
 null,'manual-origin-key-ai-0001','pause_campaign','777',now(),'Pausa de IA sem delegacao.')$$,'23514',null,
 'Job da IA sem delegacao e rejeitado');

-- Manual: sem delegacao, mas com solicitante.
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,execution_origin)
 values('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',
 null,'manual-origin-key-man-0001','pause_campaign','777',now(),'Pausa manual sem solicitante.','manual')$$,'23514',null,
 'Job manual sem solicitante e rejeitado');

insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
values('f8000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
 'f3000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',null,
 'manual-origin-key-man-0002','pause_campaign','777',now(),'Pausa manual pelo usuario.','manual',
 'f1000000-0000-4000-8000-000000000001');

update agent_action_jobs set status='authorized' where id='f8000000-0000-4000-8000-000000000001';
update agent_action_jobs set status='queued' where id='f8000000-0000-4000-8000-000000000001';
select is((select status from agent_action_jobs where id='f8000000-0000-4000-8000-000000000001'),'queued',
 'Job manual vai de proposto a fila sem aprovacao de IA');
select is((select approved_by from agent_action_jobs where id='f8000000-0000-4000-8000-000000000001'),null,
 'Job manual nao registra aprovacao de IA');
select throws_ok($$update agent_action_jobs set execution_origin='ai'
  where id='f8000000-0000-4000-8000-000000000001'$$,'23514',null,'Origem do job e imutavel');

-- A trava de uma mutacao por conta tambem vale para o manual.
insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
values('f8000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001',
 'f3000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',null,
 'manual-origin-key-man-0003','pause_campaign','778',now(),'Segunda pausa manual na conta.','manual',
 'f1000000-0000-4000-8000-000000000001');
update agent_action_jobs set status='authorized' where id='f8000000-0000-4000-8000-000000000002';
select throws_ok($$update agent_action_jobs set status='queued' where id='f8000000-0000-4000-8000-000000000002'$$,
 '23505',null,'Segunda mutacao na mesma conta nao entra na fila');

select * from finish();
rollback;
