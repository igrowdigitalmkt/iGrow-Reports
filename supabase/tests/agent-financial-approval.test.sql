begin;
set local search_path=public,extensions;
select no_plan();

-- Dados sinteticos; transacao sempre revertida, nunca Meta real.
insert into auth.users(id,email) values
 ('e1000000-0000-4000-8000-000000000001','financial-owner@example.test'),
 ('e1000000-0000-4000-8000-000000000002','financial-viewer@example.test'),
 ('e1000000-0000-4000-8000-000000000003','financial-other@example.test');
insert into agencies(id,name) values
 ('e2000000-0000-4000-8000-000000000001','Financial A'),
 ('e2000000-0000-4000-8000-000000000002','Financial B');
insert into agency_users(agency_id,user_id,role) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','owner'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','viewer'),
 ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','owner');
insert into clients(id,agency_id,name)
 values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Cliente financeiro ficticio');
insert into integrations(id,agency_id,provider)
 values('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','meta');
insert into meta_connections(id,agency_id,integration_id,scopes)
 values('e5000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',array['ads_read','ads_management']);
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
 values('e6000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','act_999','Teste financeiro','BRL','America/Sao_Paulo','100001');
insert into client_ad_accounts(agency_id,client_id,ad_account_id)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001');
insert into agent_delegations(id,agency_id,client_id,ad_account_id,granted_by,currency,enabled,
 allowed_actions,max_account_daily_budget_minor,max_entity_daily_budget_minor,
 max_increase_minor_per_action,max_increase_percent_per_action,expires_at)
 values('e7000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001','BRL',true,ARRAY['pause_campaign','resume_campaign','set_campaign_daily_budget'],
 50000,20000,10000,30,now()+interval '1 day');

insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
  action_type,meta_entity_id,facts_collected_at,rationale,daily_budget_minor)
values('e8000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',
 'e7000000-0000-4000-8000-000000000001','financial-approval-key-001',
 'set_campaign_daily_budget','999',now(),'Ajustar verba em hipotese ficticia.',4500);

select is((select execution_origin from agent_action_jobs where id='e8000000-0000-4000-8000-000000000001'),
 'ai','Jobs novos sao IA por padrao');
select throws_ok($$update agent_action_jobs set status='authorized'
  where id='e8000000-0000-4000-8000-000000000001'$$,'23514',null,
  'IA nao pode contornar aprovacao pulando direto para authorized');
update agent_action_jobs set status='awaiting_approval'
  where id='e8000000-0000-4000-8000-000000000001';
select ok((select approval_expires_at between now() and now()+interval '16 minutes'
  from agent_action_jobs where id='e8000000-0000-4000-8000-000000000001'),
  'Solicitacao gera janela de aprovacao curta');
select throws_ok($$update agent_action_jobs set status='queued'
  where id='e8000000-0000-4000-8000-000000000001'$$,'23514',null,
  'IA sem aprovacao nao pode entrar na fila');
select throws_ok($$update agent_action_jobs set status='authorized',
 approved_at=now(), approved_by='e1000000-0000-4000-8000-000000000001'
 where id='e8000000-0000-4000-8000-000000000001'$$,'23514',null,
 'Servidor nao pode fabricar clique do usuario no ledger');
select is(private.agent_claim_action('e2000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000001'),false,
 'Claim nao adquire proposta sem aprovacao');

-- Fingerprint calculado pelo banco para simular os dados exibidos no frontend.
select set_config('test.approval_fingerprint',
 (select private.agent_approval_fingerprint(j) from agent_action_jobs j
  where id='e8000000-0000-4000-8000-000000000001'), true);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',
 current_setting('test.approval_fingerprint'),true)$$,'42501',null,
 'Viewer nao pode aprovar');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',
 current_setting('test.approval_fingerprint'),true)$$,'42501',null,
 'Owner de outra organizacao nao aprova');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',
 repeat('a',64),true)$$,'23514',null,
 'Aprovacao exige fingerprint da proposta exata');
select is(public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',
 current_setting('test.approval_fingerprint'),true),'queued',
 'Owner autenticado aprova um unico job financeiro');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select is((select approved_by from agent_action_jobs where id='e8000000-0000-4000-8000-000000000001'),
 'e1000000-0000-4000-8000-000000000001'::uuid,
 'Aprovador gravado no job');
select is((select status from agent_action_jobs where id='e8000000-0000-4000-8000-000000000001'),
 'queued','Aprovacao humana libera somente uma acao enfileirada');
select ok((select count(*) from agent_action_events
 where job_id='e8000000-0000-4000-8000-000000000001' and next_status='awaiting_approval')=1,
 'Historico registra etapa aguardando aprovacao');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001',
 current_setting('test.approval_fingerprint'),true)$$,'23514',null,
 'Aprovacao nao pode ser repetida');
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
-- Recusa tambem eh acao humana auditavel; nunca entra na fila.
insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,
 action_type,meta_entity_id,facts_collected_at,rationale)
values('e8000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',
 'e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',
 'e7000000-0000-4000-8000-000000000001','financial-approval-key-002',
 'pause_campaign','998',now(),'Pausa ficticia sujeita a recusa humana.');
update agent_action_jobs set status='awaiting_approval'
 where id='e8000000-0000-4000-8000-000000000002';
select set_config('test.rejection_fingerprint',
 (select private.agent_approval_fingerprint(j) from agent_action_jobs j
  where id='e8000000-0000-4000-8000-000000000002'),true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select is(public.agent_decide_financial_action(
 'e2000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000002',
 current_setting('test.rejection_fingerprint'),false),'rejected',
 'Usuario pode recusar proposta financeira IA');
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
select is((select failure_code from agent_action_jobs where id='e8000000-0000-4000-8000-000000000002'),
 'user_rejected','Recusa auditada no resultado terminal');
select ok((select approved_by is null and started_at is null
 from agent_action_jobs where id='e8000000-0000-4000-8000-000000000002'),
 'Recusa nao produz aprovacao ou execucao');

select * from finish();
rollback;
