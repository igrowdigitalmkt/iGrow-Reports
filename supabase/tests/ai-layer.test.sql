begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
  ('a1000000-0000-4000-8000-000000000001','ia-owner@example.test',now()),
  ('a1000000-0000-4000-8000-000000000002','ia-editor@example.test',now()),
  ('a1000000-0000-4000-8000-000000000003','ia-viewer@example.test',now()),
  ('a1000000-0000-4000-8000-000000000004','ia-outro@example.test',now());
insert into agencies(id,name) values ('a1aaaaaa-0000-4000-8000-000000000001','Espaço IA'),('a1aaaaaa-0000-4000-8000-000000000002','Outro Espaço IA');
insert into agency_users(agency_id,user_id,role) values
  ('a1aaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner'),
  ('a1aaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','editor'),
  ('a1aaaaaa-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','viewer'),
  ('a1aaaaaa-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004','owner');
insert into clients(id,agency_id,name,created_by) values
  ('a1cccccc-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001','Cliente IA','a1000000-0000-4000-8000-000000000001'),
  ('a1cccccc-0000-4000-8000-000000000002','a1aaaaaa-0000-4000-8000-000000000002','Cliente de outro espaço','a1000000-0000-4000-8000-000000000004');

set local role service_role;
insert into ai_usage(agency_id,client_id,feature,model,status,input_tokens,output_tokens,cost_usd) values
  ('a1aaaaaa-0000-4000-8000-000000000001','a1cccccc-0000-4000-8000-000000000001','report_comment','claude-sonnet-5-5','ok',2800,600,0.0116),
  ('a1aaaaaa-0000-4000-8000-000000000001','a1cccccc-0000-4000-8000-000000000001','report_comment','claude-sonnet-5-5','rejected_numbers',2800,600,0.0116),
  ('a1aaaaaa-0000-4000-8000-000000000001',null,'report_comment','claude-sonnet-5-5','blocked_budget',0,0,0);
insert into ai_usage(agency_id,feature,model,status,cost_usd,created_at) values
  ('a1aaaaaa-0000-4000-8000-000000000001','report_comment','claude-sonnet-5-5','ok',9.99,date_trunc('month',now() at time zone 'utc') at time zone 'utc' - interval '1 day');
select is((select ai_month_cost('a1aaaaaa-0000-4000-8000-000000000001')),0.0232::numeric,'Cota soma só o mês corrente, inclusive chamadas reprovadas');
select lives_ok($$insert into ai_usage(agency_id,feature,model,status) values ('a1aaaaaa-0000-4000-8000-000000000001','portfolio_summary','claude-sonnet-5-5','ok')$$,'Resumo da carteira é um tipo de uso válido');
select lives_ok($$insert into ai_usage(agency_id,feature,model,status) values ('a1aaaaaa-0000-4000-8000-000000000001','whatsapp_summary','claude-sonnet-5-5','ok')$$,'Resumo para WhatsApp é um tipo de uso válido');
select throws_ok($$insert into ai_usage(agency_id,feature,model,status) values ('a1aaaaaa-0000-4000-8000-000000000001','outra_coisa','claude-sonnet-5-5','ok')$$,'23514',null,'Tipo de uso desconhecido é recusado');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from ai_usage),6,'Dono lê o uso da própria organização');
select is((select ai_month_cost('a1aaaaaa-0000-4000-8000-000000000001')),0.0232::numeric,'Dono consulta o gasto do mês');
select lives_ok($$insert into ai_settings(agency_id,monthly_budget_usd,updated_by) values ('a1aaaaaa-0000-4000-8000-000000000001',20,'a1000000-0000-4000-8000-000000000001')$$,'Dono define o orçamento');
select throws_ok($$insert into ai_settings(agency_id,monthly_budget_usd) values ('a1aaaaaa-0000-4000-8000-000000000002',20)$$,'42501',null,'Dono não configura outra organização');
select throws_ok($$insert into ai_usage(agency_id,feature,model,status) values ('a1aaaaaa-0000-4000-8000-000000000001','report_comment','m','ok')$$,'42501',null,'Usuário não grava uso: só o servidor');
select throws_ok($$update ai_settings set monthly_budget_usd=-1 where agency_id='a1aaaaaa-0000-4000-8000-000000000001'$$,'23514',null,'Orçamento negativo é recusado');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from ai_usage),0,'Editor não lê o registro de uso');
select is((select count(*)::int from ai_settings),0,'Editor não lê a configuração da organização');
select throws_ok($$select ai_month_cost('a1aaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Editor não consulta o gasto');
select lives_ok($$insert into ai_client_settings(client_id,agency_id,enabled) values ('a1cccccc-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001',false)$$,'Editor liga ou desliga a IA de um cliente');
select throws_ok($$insert into ai_client_settings(client_id,agency_id,enabled) values ('a1cccccc-0000-4000-8000-000000000002','a1aaaaaa-0000-4000-8000-000000000001',false)$$,'42501',null,'Cliente de outro espaço não vira configuração desta organização');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from ai_client_settings),1,'Leitor vê a configuração por cliente');
select throws_ok($$insert into ai_client_settings(client_id,agency_id,enabled) values ('a1cccccc-0000-4000-8000-000000000001','a1aaaaaa-0000-4000-8000-000000000001',true) on conflict (client_id) do update set enabled=true$$,'42501',null,'Leitor não altera a configuração por cliente');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from ai_usage),0,'Outra organização não vê o uso');
select is((select count(*)::int from ai_client_settings),0,'Outra organização não vê a configuração por cliente');
select throws_ok($$select ai_month_cost('a1aaaaaa-0000-4000-8000-000000000001')$$,'42501',null,'Outra organização não consulta o gasto');
reset role;
set local role anon;
select throws_ok($$select count(*) from ai_usage$$,'42501',null,'Anônimo não acessa o uso');
reset role;
select * from finish();
rollback;
