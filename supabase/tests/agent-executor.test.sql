begin;
set local search_path=public,extensions;
select no_plan();

-- Todos os dados abaixo sao FICTICIOS; transacao sempre revertida.
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','agent-owner-1@example.test'),
 ('b1000000-0000-4000-8000-000000000002','agent-owner-2@example.test'),
 ('b1000000-0000-4000-8000-000000000003','agent-viewer@example.test');
insert into agencies(id,name) values
 ('b2000000-0000-4000-8000-000000000001','Organizacao de teste A'),
 ('b2000000-0000-4000-8000-000000000002','Organizacao de teste B');
insert into agency_users(agency_id,user_id,role) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner'),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','viewer'),
 ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','owner');
insert into clients(id,agency_id,name) values
 ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Cliente ficticio A'),
 ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','Cliente ficticio B');
insert into integrations(id,agency_id,provider) values
 ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','meta'),
 ('b4000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','meta');
insert into meta_connections(id,agency_id,integration_id,scopes) values
 ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',array['ads_read','ads_management']),
 ('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000002',array['ads_read','ads_management']);
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id) values
 ('b6000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','act_111','Test Meta A','BRL','America/Sao_Paulo','918001'),
 ('b6000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000002','act_222','Test Meta B','BRL','America/Sao_Paulo','918002');
insert into client_ad_accounts(agency_id,client_id,ad_account_id) values
 ('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001'),
 ('b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000002');

insert into agent_delegations(id,agency_id,client_id,ad_account_id,granted_by,currency,enabled,
  allowed_actions,max_account_daily_budget_minor,max_entity_daily_budget_minor,
  max_increase_minor_per_action,max_increase_percent_per_action,expires_at)
values
 ('b7000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','BRL',true,
  array['pause_campaign','resume_campaign'],20000,10000,5000,20,now()+interval '1 day'),
 ('b7000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','BRL',true,
  array['pause_campaign'],20000,10000,5000,20,now()+interval '1 day');

select ok(not has_table_privilege('authenticated','public.agent_delegations','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.agent_action_jobs','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.agent_action_events','INSERT,UPDATE,DELETE'),
 'Usuarios autenticados nao escrevem delegacoes, jobs nem eventos');
select ok(not has_function_privilege('authenticated','private.agent_claim_action(uuid,uuid)','EXECUTE'),
 'Worker claim inacessivel a authenticated');
select ok(not has_table_privilege('anon','public.agent_delegations','SELECT'),
 'Anon nao acessa delegacoes');

-- RLS efetiva: dono da organizacao A ve somente A, viewer nao ve.
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from agent_delegations),1,'Dono A ve somente delegacao A');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from agent_delegations),1,'Dono B ve somente delegacao B');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from agent_delegations),0,'Viewer nao ve delegacoes');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Testes historicos de transicoes exercitam agora modo MANUAL:
-- o motor IA nao recebe autorizacao automatica para a mesma acao.
insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
values
 ('b8000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',
 'b7000000-0000-4000-8000-000000000001','test-action-idempotency-key-1',
 'pause_campaign','111',now(),'Pausar campanha ficticia que excedeu as metas.',
 'manual','b1000000-0000-4000-8000-000000000001');

select is((select count(*)::integer from agent_action_events where job_id='b8000000-0000-4000-8000-000000000001'),1,
 'Insercao cria evento automatico de auditoria');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale)
 values('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
 'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'test-action-idempotency-key-1','pause_campaign','111',now(),'Repetir acao ficticia registrada no banco.')$$,
 '23505',null,'Idempotency key duplicada falha');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale)
 values('b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002',
 'b6000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000001',
 'test-action-idempotency-key-2','pause_campaign','111',now(),'Tentar executar na organizacao errada.')$$,
 '23503',null,'Foreign key barra delegacao de outra organizacao');

update agent_action_jobs set status='authorized' where id='b8000000-0000-4000-8000-000000000001';
update agent_action_jobs set status='queued' where id='b8000000-0000-4000-8000-000000000001';
select is(private.agent_claim_action('b2000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001'),true,
 'Claim adquire job enfileirado');
select is(private.agent_claim_action('b2000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001'),false,
 'Claim duplicado nao reexecuta');
select is((select status from agent_action_jobs where id='b8000000-0000-4000-8000-000000000001'),'executing',
 'Job tem um executor');
select is((select count(*)::integer from agent_action_events where job_id='b8000000-0000-4000-8000-000000000001'),4,
 'Eventos refletem proposta, autorizacao, fila e execucao');
select throws_ok($$update agent_action_jobs set action_type='resume_campaign'
 where id='b8000000-0000-4000-8000-000000000001'$$,'23514',null,'Acao e identidade imutaveis');
select throws_ok($$update agent_action_jobs set status='verified'
 where id='b8000000-0000-4000-8000-000000000001'$$,'23514',null,
 'Nao pode pular verificacao do provedor');

update agent_action_jobs set status='needs_verification'
where id='b8000000-0000-4000-8000-000000000001';
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,status)
 values('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
 'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'test-action-idempotency-key-3','pause_campaign','112',now(),
 'Tentar criar trabalho diretamente na fila sem autorizar a proposta.','queued')$$,
 '23514',null,'Novo job nao pode ser inserido diretamente como queued');
insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
 action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
values('b8000000-0000-4000-8000-000000000002',
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
 'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'test-action-idempotency-key-3','pause_campaign','112',now(),
 'Segunda proposta ficticia enquanto a primeira ainda e incerta.',
 'manual','b1000000-0000-4000-8000-000000000001');
update agent_action_jobs set status='authorized'
where id='b8000000-0000-4000-8000-000000000002';
select throws_ok($$update agent_action_jobs set status='queued'
 where id='b8000000-0000-4000-8000-000000000002'$$,
 '23505',null,'Uma unica mutacao nao reconciliada por conta');
update agent_action_jobs set status='verifying' where id='b8000000-0000-4000-8000-000000000001';
update agent_action_jobs set status='verified' where id='b8000000-0000-4000-8000-000000000001';
select ok((select verified_at is not null and finished_at is not null from agent_action_jobs
 where id='b8000000-0000-4000-8000-000000000001'), 'Resultado verificado encerra acao');
update agent_action_jobs set status='queued' where id='b8000000-0000-4000-8000-000000000002';
select is(private.agent_claim_action('b2000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000002'),true,
 'Liberou a conta somente depois de verificar a primeira acao');
select throws_ok($$update agent_action_jobs set status='queued'
 where id='b8000000-0000-4000-8000-000000000001'$$,'23514',null,
 'Acao terminal nao pode retornar para fila');

-- RLS dos jobs e da trilha.
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from agent_action_jobs),2,'Dono A acessa somente seus jobs');
select ok((select count(*) from agent_action_events where agency_id='b2000000-0000-4000-8000-000000000001')>=6,
 'Dono A consulta trilha de auditoria da propria organizacao');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from agent_action_jobs),0,'Dono B nao acessa jobs da A');
reset role;

select * from finish();
rollback;
