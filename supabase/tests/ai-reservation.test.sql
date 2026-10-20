begin;
set local search_path=public,extensions;
select no_plan();

-- Dados sinteticos; transacao sempre revertida. Executa as migrations REAIS (inclusive 202610200001 e 202610200002) em PGlite.
-- ATENCAO: PGlite tem uma unica conexao; estes testes provam a logica SQL e a serializacao SEQUENCIAL. A concorrencia real entre
-- conexoes (pg_advisory_xact_lock) ainda precisa ser homologada em um PostgreSQL de verdade.
insert into auth.users(id,email,email_confirmed_at) values
  ('b1000000-0000-4000-8000-000000000001','res-owner@example.test',now()),
  ('b1000000-0000-4000-8000-000000000002','res-other@example.test',now());
insert into agencies(id,name) values ('b1aaaaaa-0000-4000-8000-000000000001','Reserva A'),('b1aaaaaa-0000-4000-8000-000000000002','Reserva B');
insert into agency_users(agency_id,user_id,role) values
  ('b1aaaaaa-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner'),
  ('b1aaaaaa-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','owner');
insert into clients(id,agency_id,name,created_by) values
  ('b1cccccc-0000-4000-8000-000000000001','b1aaaaaa-0000-4000-8000-000000000001','Cliente A1','b1000000-0000-4000-8000-000000000001'),
  ('b1cccccc-0000-4000-8000-000000000002','b1aaaaaa-0000-4000-8000-000000000001','Cliente A2','b1000000-0000-4000-8000-000000000001'),
  ('b1cccccc-0000-4000-8000-000000000003','b1aaaaaa-0000-4000-8000-000000000002','Cliente B1','b1000000-0000-4000-8000-000000000002');
insert into ai_settings(agency_id,monthly_budget_usd) values ('b1aaaaaa-0000-4000-8000-000000000001',1.00);

-- Papel do servidor (a camada de dados chama estas funcoes com a chave de servico).
select set_config('request.jwt.claim.role','service_role',true);

-- ---------------------------------------------------------------------------------------------------------------------------
-- Estrutura, permissoes e compatibilidade
-- ---------------------------------------------------------------------------------------------------------------------------
select ok(ai_reservations_ready(),'Estrutura de reservas completa (estados, colunas e funcoes)');
select ok(ai_usage_supports_feature('campaign_chat'),'Categoria campaign_chat aceita pela restricao');
select ok(not ai_usage_supports_feature('categoria_inexistente'),'Categoria desconhecida nao e suportada');
select ok((select pg_get_functiondef('public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval)'::regprocedure) like '%pg_advisory_xact_lock%'),'Reserva serializa por organizacao com lock transacional');
select ok((select pg_get_functiondef('public.settle_ai_usage(uuid,uuid,text,text,integer,integer,integer,integer,numeric,text,boolean,text,text)'::regprocedure) like '%pg_advisory_xact_lock%'),'Liquidacao tambem serializa por organizacao');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
  where p.proname in ('reserve_ai_usage','settle_ai_usage','sweep_stale_ai_reservations','ai_reservations_ready')),'Funcoes SECURITY DEFINER com search_path vazio');
select ok(not has_function_privilege('authenticated','public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval)','execute')
  and not has_function_privilege('anon','public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval)','execute')
  and not has_function_privilege('authenticated','public.settle_ai_usage(uuid,uuid,text,text,integer,integer,integer,integer,numeric,text,boolean,text,text)','execute')
  and not has_function_privilege('authenticated','public.sweep_stale_ai_reservations(interval)','execute')
  and has_function_privilege('service_role','public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval)','execute')
  and has_function_privilege('service_role','public.settle_ai_usage(uuid,uuid,text,text,integer,integer,integer,integer,numeric,text,boolean,text,text)','execute'),
  'Somente o servico executa reserva, liquidacao e varredura');
select throws_ok($$set local role authenticated; select * from public.reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','req-key-0001','scope-hash-0001',0.1)$$,'42501',null,'Usuario comum nao reserva');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$set local role authenticated; select * from public.settle_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1aaaaaa-0000-4000-8000-000000000001','released')$$,'42501',null,'Usuario comum nao liquida');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select * from public.reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','req-key-0001','scope-hash-0001',0.1)$$,'42501','Operação não autorizada.','Mesmo executando como dono da funcao, a funcao exige papel de servico');
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok($$set local role service_role; select * from public.reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000002',null,null,'campaign_chat','m','grant-check-1','scope-hash-grant',0.01)$$,'Papel de servico executa com a concessao real');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
delete from ai_usage where request_key='grant-check-1';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Reserva inicial e orcamento (organizacao A: orcamento mensal de US$ 1,00)
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table r1 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40);
select is((select outcome from r1),'reserved','Reserva inicial autorizada');
select is((select budget_usd from r1),1.00::numeric,'Teto vem das configuracoes da organizacao, nao do chamador');
select row_eq($$select status,cost_usd,reserved_usd,request_key,scope_hash,needs_reconciliation from ai_usage where id=(select usage_id from r1)$$,
  row('reserved'::text,0.400000::numeric,0.400000::numeric,'req-key-0001'::text,'scope-hash-0001'::text,false),'Linha reservada: valor, identificador e escopo gravados');
select is(ai_month_cost('b1aaaaaa-0000-4000-8000-000000000001'),0.400000::numeric,'ai_month_cost ja conta a reserva pendente');

create temp table r2 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0002','scope-hash-0002',0.40);
select is((select outcome from r2),'reserved','Segunda reserva cabe no orcamento');
create temp table r3 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0003','scope-hash-0003',0.40);
select is((select outcome from r3),'budget','Terceira reserva excede o teto com as pendentes somadas e e recusada');
select is((select usage_id from r3),null::uuid,'Reserva recusada nao cria linha');
select is((select count(*)::int from ai_usage where request_key='req-key-0003'),0,'Nenhuma linha para a solicitacao recusada');
select is(ai_month_cost('b1aaaaaa-0000-4000-8000-000000000001'),0.800000::numeric,'Gasto continua 0,80 (so reservas aceitas)');

-- ---------------------------------------------------------------------------------------------------------------------------
-- Idempotencia e escopo
-- ---------------------------------------------------------------------------------------------------------------------------
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  'duplicate_in_flight','Solicitacao repetida em andamento nao cria outra reserva');
select is((select count(*)::int from ai_usage where request_key='req-key-0001'),1,'Ainda ha uma unica linha para o identificador');
select is((select usage_id from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  (select usage_id from r1),'A repeticao devolve a reserva original');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','OUTRO-ESCOPO-9999',0.40)),
  'conflict','Mesmo identificador com outro contexto e recusado');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  'conflict','Mesmo identificador com outro cliente e recusado');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001',null,'campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  'conflict','Mesmo identificador com outro usuario e recusado');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000002','b1cccccc-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000002','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  'reserved','O mesmo identificador em OUTRA organizacao e independente');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','campaign_chat','m','req-key-0009','scope-hash-0009',0.1)),
  'invalid','Cliente de outra organizacao e recusado');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','req-key-0010','scope-hash-0010',0)),'invalid','Estimativa zero e invalida');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','req-key-0010','scope-hash-0010',-1)),'invalid','Estimativa negativa e invalida');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','req-key-0010','scope-hash-0010',101)),'invalid','Estimativa acima do limite e invalida');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'campaign_chat','m','curto','scope-hash-0010',0.1)),'invalid','Identificador curto demais e invalido');
select throws_ok($$select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001',null,null,'outra_categoria','m','req-key-0011','scope-hash-0011',0.1)$$,'23514',null,'Categoria desconhecida e recusada pela restricao');

-- ---------------------------------------------------------------------------------------------------------------------------
-- Liquidacao: consumo real, repeticao, liberacao e consumo desconhecido
-- ---------------------------------------------------------------------------------------------------------------------------
select row_eq($$select outcome,cost_usd,delta_usd from settle_ai_usage((select usage_id from r1),'b1aaaaaa-0000-4000-8000-000000000001','completed','ok',1200,80,0,0,0.0132,'req_provider_1',true,'facts-hash-1','claude-sonnet-5-5')$$,
  row('settled'::text,0.013200::numeric,-0.386800::numeric),'Liquidacao com custo real substitui o valor reservado');
select row_eq($$select status,cost_usd,input_tokens,output_tokens,request_id,verifier_passed,facts_hash,needs_reconciliation,settled_at is not null from ai_usage where id=(select usage_id from r1)$$,
  row('ok'::text,0.013200::numeric,1200,80,'req_provider_1'::text,true,'facts-hash-1'::text,false,true),'Tokens, custo e verificacao gravados');
select is(ai_month_cost('b1aaaaaa-0000-4000-8000-000000000001'),0.413200::numeric,'Gasto do mes = custo real + reserva pendente');
select row_eq($$select outcome,cost_usd from settle_ai_usage((select usage_id from r1),'b1aaaaaa-0000-4000-8000-000000000001','completed','ok',9999,9999,0,0,9.99,'outro',false,'outro','m')$$,
  row('already_settled'::text,0.013200::numeric),'Liquidacao repetida nao altera nada (idempotente)');
select is((select cost_usd from ai_usage where id=(select usage_id from r1)),0.013200::numeric,'Custo permanece o da primeira liquidacao');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0001','scope-hash-0001',0.40)),
  'duplicate_completed','Solicitacao concluida nao reserva nem autoriza nova chamada');

select is((select outcome from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000002','released')),'not_found','Outra organizacao nao liquida a reserva alheia');
select is((select status from ai_usage where id=(select usage_id from r2)),'reserved','Reserva alheia permanece intacta');
select is((select outcome from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','completed','ok',1,1,0,0,-1)),'invalid','Custo negativo e invalido');
select is((select outcome from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','completed','reserved',1,1,0,0,0.1)),'invalid','Status final invalido e recusado');
select is((select outcome from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','qualquer')),'invalid','Resultado desconhecido e invalido');
select is((select status from ai_usage where id=(select usage_id from r2)),'reserved','Liquidacoes invalidas nao alteram a reserva');

select row_eq($$select outcome,cost_usd from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','unknown')$$,
  row('settled'::text,0.400000::numeric),'Consumo desconhecido mantem a estimativa');
select row_eq($$select status,cost_usd,needs_reconciliation from ai_usage where id=(select usage_id from r2)$$,row('unknown_consumption'::text,0.400000::numeric,true),'Linha marcada para conciliacao, sem virar custo zero');
select is(ai_month_cost('b1aaaaaa-0000-4000-8000-000000000001'),0.413200::numeric,'Consumo desconhecido continua contando na cota');
select is((select outcome from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','unknown')),'already_settled','Marcar desconhecido de novo e idempotente');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0002','scope-hash-0002',0.40)),
  'duplicate_unknown','Solicitacao de resultado desconhecido nunca e executada de novo');
select row_eq($$select outcome,cost_usd from settle_ai_usage((select usage_id from r2),'b1aaaaaa-0000-4000-8000-000000000001','completed','error',500,100,0,0,0.002,'req_late',null,'facts-hash-2','claude-sonnet-5-5')$$,
  row('settled'::text,0.002000::numeric),'Conciliacao posterior com o consumo real');
select row_eq($$select status,cost_usd,needs_reconciliation from ai_usage where id=(select usage_id from r2)$$,row('error'::text,0.002000::numeric,false),'Conciliada: custo real e sem pendencia');

create temp table r4 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0004','scope-hash-0004',0.30);
select is((select outcome from r4),'reserved','Nova reserva depois da liberacao de valores');
select row_eq($$select outcome,cost_usd from settle_ai_usage((select usage_id from r4),'b1aaaaaa-0000-4000-8000-000000000001','released')$$,row('settled'::text,0::numeric),'Liberacao (recusa certa) zera o valor reservado');
select row_eq($$select status,cost_usd,input_tokens,needs_reconciliation from ai_usage where id=(select usage_id from r4)$$,row('error'::text,0::numeric,0,false),'Linha liberada: custo 0 e sem pendencia');
select is(ai_month_cost('b1aaaaaa-0000-4000-8000-000000000001'),0.015200::numeric,'Cota reflete apenas custos reais e reservas pendentes');

-- ---------------------------------------------------------------------------------------------------------------------------
-- Reservas abandonadas
-- ---------------------------------------------------------------------------------------------------------------------------
create temp table r5 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0005','scope-hash-0005',0.20);
select is((select outcome from r5),'reserved','Reserva que ficara abandonada');
update ai_usage set created_at=now()-interval '30 minutes' where id=(select usage_id from r5);
create temp table r6 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0006','scope-hash-0006',0.10);
select is((select outcome from r6),'reserved','Nova reserva dispara a varredura da organizacao');
select row_eq($$select status,cost_usd,needs_reconciliation,settled_at is not null from ai_usage where id=(select usage_id from r5)$$,row('unknown_consumption'::text,0.200000::numeric,true,true),
  'Reserva abandonada vira consumo desconhecido, mantem a estimativa e pede conciliacao');
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0005','scope-hash-0005',0.20)),
  'duplicate_unknown','A reserva abandonada nao e executada de novo');
select is((select status from ai_usage where id=(select usage_id from r6)),'reserved','Reservas recentes nao sao tocadas');
select ok(exists(select 1 from ai_usage where needs_reconciliation and agency_id='b1aaaaaa-0000-4000-8000-000000000001'),'Pendencias de conciliacao podem ser identificadas');

create temp table r7 as select * from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000002','b1cccccc-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000002','campaign_chat','claude-sonnet-5-5','req-key-0007','scope-hash-0007',0.05);
update ai_usage set created_at=now()-interval '2 hours' where id=(select usage_id from r7);
select is((select sweep_stale_ai_reservations(interval '15 minutes')),1,'Varredura global converte as reservas antigas (so a da outra organizacao) e informa quantas');
select is((select status from ai_usage where id=(select usage_id from r7)),'unknown_consumption','Varredura marcou a reserva antiga da outra organizacao');
select is((select status from ai_usage where id=(select usage_id from r6)),'reserved','Varredura nao toca a reserva recente');
select throws_ok($$select sweep_stale_ai_reservations(interval '0 seconds')$$,'22023',null,'Intervalo invalido e recusado');

-- ---------------------------------------------------------------------------------------------------------------------------
-- Interruptores, orcamento da organizacao e restricoes de integridade
-- ---------------------------------------------------------------------------------------------------------------------------
update ai_settings set enabled=false where agency_id='b1aaaaaa-0000-4000-8000-000000000001';
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0020','scope-hash-0020',0.01)),'disabled','IA desligada na organizacao bloqueia a reserva');
update ai_settings set enabled=true where agency_id='b1aaaaaa-0000-4000-8000-000000000001';
insert into ai_client_settings(client_id,agency_id,enabled) values ('b1cccccc-0000-4000-8000-000000000002','b1aaaaaa-0000-4000-8000-000000000001',false);
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0021','scope-hash-0021',0.01)),'disabled','IA desligada no cliente bloqueia a reserva');
update ai_settings set monthly_budget_usd=0.01 where agency_id='b1aaaaaa-0000-4000-8000-000000000001';
select is((select outcome from reserve_ai_usage('b1aaaaaa-0000-4000-8000-000000000001','b1cccccc-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','campaign_chat','claude-sonnet-5-5','req-key-0022','scope-hash-0022',0.01)),'budget','Orcamento reduzido vale imediatamente (configuracao lida na propria reserva)');

select throws_ok($$insert into ai_usage(agency_id,feature,model,status) values ('b1aaaaaa-0000-4000-8000-000000000001','campaign_chat','m','reserved')$$,'23514',null,'Reservada sem valor e identificador e recusada pela restricao');
select throws_ok($$insert into ai_usage(agency_id,feature,model,status,reserved_usd,request_key) values ('b1aaaaaa-0000-4000-8000-000000000001','campaign_chat','m','reserved',0.1,'req-key-0001')$$,'23505',null,'Indice unico impede o mesmo identificador na mesma organizacao e funcionalidade');
select lives_ok($$insert into ai_usage(agency_id,feature,model,status) values ('b1aaaaaa-0000-4000-8000-000000000001','report_comment','m','ok')$$,'Consumidores existentes continuam gravando sem os campos novos');
select lives_ok($$insert into ai_usage(agency_id,feature,model,status,request_key) values ('b1aaaaaa-0000-4000-8000-000000000001','report_comment','m','ok','req-key-0001')$$,'O identificador e unico por funcionalidade, nao global');
select throws_ok($$insert into ai_usage(agency_id,feature,model,status) values ('b1aaaaaa-0000-4000-8000-000000000001','report_comment','m','status_inexistente')$$,'23514',null,'Status desconhecido continua recusado');

-- ---------------------------------------------------------------------------------------------------------------------------
-- Prontidao sem falso positivo: uma restricao de estado "escondida" sob outro nome bloqueia a reserva e deve tornar o banco indisponivel
-- ---------------------------------------------------------------------------------------------------------------------------
alter table ai_usage add constraint ai_usage_status_legacy_rogue check (status in ('ok','blocked_disabled','blocked_budget','rejected_numbers','error')) not valid;
select ok(not ai_reservations_ready(),'Restricao de estado com outro nome (sem reserved) => reservas NAO estao prontas');
alter table ai_usage drop constraint ai_usage_status_legacy_rogue;
select ok(ai_reservations_ready(),'Sem a restricao divergente => prontas novamente');
-- Sondagem funcional: restricao que nao menciona a lista de estados do jeito esperado mas ainda rejeita o insert (barreira funcional)
alter table ai_usage add constraint ai_usage_probe_rogue check (status <> 'unknown_consumption' or cost_usd > 1000) not valid;
select ok(not ai_reservations_ready(),'Restricao funcional que rejeita unknown_consumption => NAO prontas (sonda funcional)');
alter table ai_usage drop constraint ai_usage_probe_rogue;
select ok(ai_reservations_ready(),'Removida a barreira funcional => prontas');
select is((select count(*)::int from ai_usage where model = 'readiness-probe'),0,'A sonda de prontidao nao deixa linhas');
-- A migration remove por definicao: simula a re-execucao do bloco de remocao com uma restricao de categoria divergente.
alter table ai_usage add constraint ai_usage_feature_legacy_rogue check (feature in ('report_comment')) not valid;
select ok(not ai_usage_supports_feature('campaign_chat'),'Restricao de categoria com outro nome bloqueia campaign_chat e e detectada');
alter table ai_usage drop constraint ai_usage_feature_legacy_rogue;
select ok(ai_usage_supports_feature('campaign_chat'),'Sem a restricao divergente a categoria volta a ser aceita');

select * from finish();
rollback;
