begin;
set local search_path=public,extensions;
select no_plan();

-- Dados sinteticos; transacao sempre revertida, nunca Meta real.
insert into auth.users(id,email) values ('e1000000-0000-4000-8000-000000000001','ext-owner@example.test');
insert into agencies(id,name) values ('e2000000-0000-4000-8000-000000000001','Extended A');
insert into agency_users(agency_id,user_id,role) values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','owner');
insert into clients(id,agency_id,name) values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Cliente estendido ficticio');
insert into integrations(id,agency_id,provider) values('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','meta');
insert into meta_connections(id,agency_id,integration_id,scopes)
 values('e5000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',array['ads_read','ads_management']);
insert into meta_ad_accounts(id,agency_id,meta_connection_id,external_id,name,currency,timezone_name,business_id)
 values('e6000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','act_777','Teste estendido','BRL','America/Sao_Paulo','100003');
insert into client_ad_accounts(agency_id,client_id,ad_account_id)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001');

-- Sonda de prontidao: somente servico; verdadeira com a coluna e a restricao presentes.
select throws_ok($$select public.agent_manual_extended_actions_supported()$$,'42501',null,'Sonda reservada ao servico');
set local role service_role;
select is(public.agent_manual_extended_actions_supported(), true, 'Banco com as novas acoes manuais responde pronto');
reset role;

-- As seis acoes anteriores continuam validas para a origem manual.
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,daily_budget_minor,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-old-action-key-0001','set_campaign_daily_budget','901',10000,now(),'Orcamento manual existente.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Acao anterior (orcamento) continua valida');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-old-action-key-0002','pause_adset','902',now(),'Pausa manual existente.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Acao anterior (pausar conjunto) continua valida');

-- Novas acoes manuais: aceitas com nome (renomear) e sem nome (pausar/retomar anuncio).
select lives_ok($$insert into agent_action_jobs(id,agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e8000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-rename-key-0000001','rename_campaign','910','Campanha renomeada',now(),'Renomear campanha pelo usuario.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Renomear campanha (manual) e aceito');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-rename-key-0000002','rename_adset','911','Conjunto renomeado',now(),'Renomear conjunto pelo usuario.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Renomear conjunto (manual) e aceito');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-rename-key-0000003','rename_ad','912','Anuncio renomeado',now(),'Renomear anuncio pelo usuario.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Renomear anuncio (manual) e aceito');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-ad-pause-key-00001','pause_ad','913',now(),'Pausar anuncio pelo usuario.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Pausar anuncio (manual) e aceito');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-ad-resume-key-0001','resume_ad','914',now(),'Retomar anuncio pelo usuario.','manual','e1000000-0000-4000-8000-000000000001')$$,
 'Retomar anuncio (manual) e aceito');

-- A IA NAO pode usar as novas acoes (nem com delegacao): o banco rejeita pela origem.
insert into agent_delegations(id,agency_id,client_id,ad_account_id,currency,enabled,expires_at,allowed_actions,
  max_account_daily_budget_minor,max_entity_daily_budget_minor,max_increase_minor_per_action,max_increase_percent_per_action,granted_by)
values('e7000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',
 'BRL',true,now()+interval '1 day',array['pause_campaign'],100000,50000,10000,50,'e1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001',
 'ext-ai-pause-ad-key-001','pause_ad','920',now(),'IA tentando pausar anuncio.')$$,'23514',null,'IA nao pode registrar pausa de anuncio');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001',
 'ext-ai-rename-key-0001','rename_campaign','921','Nome da IA',now(),'IA tentando renomear campanha.')$$,'23514',null,'IA nao pode registrar renomeacao');
select lives_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001',
 'ext-ai-pause-camp-key01','pause_campaign','922',now(),'IA pausando campanha delegada.')$$,'Acoes antigas da IA continuam aceitas');

-- Tipo desconhecido segue rejeitado.
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-unknown-key-000001','delete_campaign','930',now(),'Acao inexistente no contrato.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Tipo fora da lista e rejeitado');

-- Novo nome: obrigatorio so em renomear; vazio, com espacos nas pontas ou grande demais sao rejeitados.
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-noname-key-0000001','rename_campaign','940',now(),'Renomear sem informar o nome.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Renomear exige o novo nome');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-name-on-pause-0001','pause_ad','941','Nome indevido',now(),'Pausar com nome embutido.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Nome so existe em renomear');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-empty-name-0000001','rename_ad','942','',now(),'Renomear com nome vazio.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Nome vazio e rejeitado');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-space-name-0000001','rename_ad','943',' com espaco ',now(),'Renomear com espacos nas pontas.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Espacos nas pontas sao rejeitados');
select throws_ok($$insert into agent_action_jobs(agency_id,client_id,ad_account_id,delegation_id,idempotency_key,action_type,meta_entity_id,new_name,facts_collected_at,rationale,execution_origin,requested_by)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',null,
 'ext-long-name-00000001','rename_ad','944',repeat('x',401),now(),'Renomear com nome enorme.','manual','e1000000-0000-4000-8000-000000000001')$$,'23514',null,'Nome acima do limite e rejeitado');

-- O nome pedido e imutavel depois de registrado; o fluxo manual (proposto > autorizado > fila) segue valendo.
select throws_ok($$update agent_action_jobs set new_name='Outro nome' where id='e8000000-0000-4000-8000-000000000001'$$,'23514',null,'Novo nome e imutavel');
update agent_action_jobs set status='authorized' where id='e8000000-0000-4000-8000-000000000001';
update agent_action_jobs set status='queued' where id='e8000000-0000-4000-8000-000000000001';
select is((select status from agent_action_jobs where id='e8000000-0000-4000-8000-000000000001'),'queued','Renomear segue o fluxo manual ate a fila');
select throws_ok($$update agent_action_jobs set action_type='pause_ad' where id='e8000000-0000-4000-8000-000000000001'$$,'23514',null,'Tipo da acao e imutavel');

-- Constraints e registros anteriores preservados.
select is((select count(*)::int from pg_constraint where conrelid='public.agent_action_jobs'::regclass and conname in
  ('agent_action_jobs_check','agent_action_jobs_daily_budget_minor_check','agent_jobs_delegation_by_origin_check','agent_jobs_manual_initiator_check','agent_jobs_approval_pair_check')),5,
  'Constraints anteriores preservadas');
select is((select count(*)::int from agent_action_jobs where action_type in ('set_campaign_daily_budget','pause_adset')),2,'Registros antigos preservados');
select ok(exists(select 1 from pg_policies where tablename='agent_action_jobs' and policyname='agent_jobs_staff_read'),'RLS de leitura preservada');
select ok(has_table_privilege('authenticated','public.agent_action_jobs','select') and not has_table_privilege('authenticated','public.agent_action_jobs','insert'),'Permissoes preservadas');

-- Trava de uma mutacao por conta continua valendo para as novas acoes (o nome entra na fila antes; a segunda nao).
update agent_action_jobs set status='authorized' where idempotency_key='ext-rename-key-0000002';
select throws_ok($$update agent_action_jobs set status='queued' where idempotency_key='ext-rename-key-0000002'$$,'23505',null,'Segunda mutacao na conta nao entra na fila');

select * from finish();
rollback;
